//! Міст до графа: інтерактивний run вузла (спека runtime.md,
//! «Інтерактивна сесія = run вузла»; git.md — claim CAS, run ref, fenced
//! publish).
//!
//! Контракт графа НЕ реімплементується: всі операції — виклики `mt-core`
//! (та сама реалізація, яку `@7n/mt` використовує через napi). Життєвий
//! цикл: attach (CAS claim + detached worktree + run ref) → комміти ходів
//! із `session.jsonl` → `done` (fenced publish) або release (пауза).
//! `.nitra/` живе лише в run ref і прибирається перед publish — інваріант
//! git.md: у `main` він не потрапляє ніколи.

use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{Duration, Utc};
use mt_core::claims::{
    acquire_claim, discover_repo_root, node_hash, release_claim, renew_or_takeover_claim,
    tasks_root_relative, ClaimFields, RUN_REF_PREFIX,
};
use mt_core::publish::{fenced_publish, PublishOutcome, PublishRequest};
use mt_core::worktree::{create_run_worktree, push_run_ref, remove_run_worktree};
use uuid::Uuid;

/// Конфігурація моста.
pub struct GraphConfig {
    /// tasks-директорія проєкту (напр. `<repo>/mt`).
    pub tasks_dir: PathBuf,
    /// Lease інтерактивного claim (спека: коротший за автономний;
    /// дефолт 0.3.0 — `interactive_claim_lease_sec: 900`).
    pub lease_sec: i64,
    /// Актор claim-а (інтерактивну сесію веде людина).
    pub actor: String,
}

impl GraphConfig {
    pub fn new(tasks_dir: PathBuf) -> Self {
        Self {
            tasks_dir,
            lease_sec: 900,
            actor: "human".into(),
        }
    }
}

/// Живий інтерактивний run: claim утримується, worktree матеріалізований.
#[derive(Debug)]
pub struct InteractiveRun {
    pub node: String,
    pub node_hash: String,
    /// = run_token сесії (ідентифікатор run ref).
    pub token: String,
    /// Поточний claim commit (renewal просуває).
    pub claim_sha: String,
    /// SHA `origin/main` на момент attach — база worktree, незмінна.
    pub base_sha: String,
    pub worktree: PathBuf,
    repo_root: PathBuf,
    generation: u64,
    lease_sec: i64,
    actor: String,
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("git {}: {e}", args.join(" ")))?;
    if !out.status.success() {
        return Err(format!(
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn iso(ts: chrono::DateTime<Utc>) -> String {
    ts.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Attach вузла: CAS claim → detached worktree від `base_sha` → run ref.
/// `accepted: false` CAS-у → явна помилка claim-lost (вузол уже зайнято).
pub fn attach(config: &GraphConfig, node: &str) -> Result<InteractiveRun, String> {
    let repo_root = discover_repo_root(&config.tasks_dir)?;
    let tasks_root_rel = tasks_root_relative(&repo_root, &config.tasks_dir)?;
    let hash = node_hash(&tasks_root_rel, node);

    git(&repo_root, &["fetch", "--quiet", "origin", "main"])?;
    let base_sha = git(&repo_root, &["rev-parse", "origin/main"])?;

    let token = Uuid::new_v4().to_string();
    let runner_id = format!("agent-server/{}", std::process::id());
    let run_ref = format!("{RUN_REF_PREFIX}/{hash}/{token}");
    let fields = ClaimFields {
        node,
        actor: &config.actor,
        runner_id: &runner_id,
        claimed_at: &iso(Utc::now()),
        lease_until: &iso(Utc::now() + Duration::seconds(config.lease_sec)),
        token: &token,
        generation: 1,
        base_sha: &base_sha,
        run_ref: &run_ref,
    };
    let claim = acquire_claim(&repo_root, &hash, &fields)?;
    if !claim.accepted {
        return Err(format!(
            "claim-lost: вузол {node} уже утримується іншим runner/сесією"
        ));
    }

    let worktrees_dir = repo_root.join(".worktrees");
    let worktree = create_run_worktree(&repo_root, &worktrees_dir, &hash, &token, &base_sha)?;
    push_run_ref(&worktree, &hash, &token)?;

    Ok(InteractiveRun {
        node: node.to_string(),
        node_hash: hash,
        token,
        claim_sha: claim.commit_sha,
        base_sha,
        worktree,
        repo_root,
        generation: 1,
        lease_sec: config.lease_sec,
        actor: config.actor.clone(),
    })
}

impl InteractiveRun {
    /// Коміт ходу: журнал сесії (`.nitra/session.jsonl`) + правки файлів →
    /// push run ref (recovery/handoff, спека git.md: «кожен хід = коміт +
    /// негайний push run ref»). Порожній хід (нічого не змінилось) — no-op.
    pub fn commit_turn(&self, session_jsonl: &str, message: &str) -> Result<(), String> {
        let nitra_dir = self.worktree.join(".nitra");
        std::fs::create_dir_all(&nitra_dir).map_err(|e| e.to_string())?;
        std::fs::write(nitra_dir.join("session.jsonl"), session_jsonl)
            .map_err(|e| e.to_string())?;

        git(&self.worktree, &["add", "-A"])?;
        let staged = git(&self.worktree, &["status", "--porcelain"])?;
        if staged.is_empty() {
            return Ok(());
        }
        git(&self.worktree, &["commit", "-q", "-m", message])?;
        push_run_ref(&self.worktree, &self.node_hash, &self.token)
    }

    /// Renewal lease: той самий token/generation, CAS від поточного claim
    /// SHA. `Ok(false)` — claim втрачено (takeover-ом), сесію слід зупинити.
    pub fn renew(&mut self) -> Result<bool, String> {
        let run_ref = format!("{RUN_REF_PREFIX}/{}/{}", self.node_hash, self.token);
        let fields = ClaimFields {
            node: &self.node,
            actor: &self.actor.clone(),
            runner_id: &format!("agent-server/{}", std::process::id()),
            claimed_at: &iso(Utc::now()),
            lease_until: &iso(Utc::now() + Duration::seconds(self.lease_sec)),
            token: &self.token.clone(),
            generation: self.generation,
            base_sha: &self.base_sha.clone(),
            run_ref: &run_ref,
        };
        let push =
            renew_or_takeover_claim(&self.repo_root, &self.node_hash, &self.claim_sha, &fields)?;
        if push.accepted {
            self.claim_sha = push.commit_sha;
        }
        Ok(push.accepted)
    }

    /// `mt done`: стрип `.nitra/` з індексу (інваріант git.md) → fenced
    /// publish (rebase на origin/main + atomic push main / видалення
    /// claim+run ref). Успіх → worktree прибирається.
    pub fn done(self, retry_max: u32, base_ms: u64) -> Result<PublishOutcome, String> {
        // Remote run ref стоїть на останньому запушеному ході (HEAD ДО
        // strip-коміту) — саме його очікує force-with-lease publish-у.
        let run_ref_sha = git(&self.worktree, &["rev-parse", "HEAD"])?;
        let tracked = git(&self.worktree, &["ls-files", ".nitra"])?;
        if !tracked.is_empty() {
            git(&self.worktree, &["rm", "-r", "-q", "--cached", ".nitra"])?;
            git(
                &self.worktree,
                &["commit", "-q", "-m", "mt: strip session artifacts"],
            )?;
        }
        let request = PublishRequest {
            worktree: &self.worktree,
            node_hash: &self.node_hash,
            claim_sha: &self.claim_sha,
            token: &self.token,
            run_ref_sha_before: &run_ref_sha,
        };
        let outcome = fenced_publish(&self.repo_root, &request, retry_max, base_ms)?;
        if outcome.published {
            let _ = remove_run_worktree(&self.repo_root, &self.worktree);
        }
        // Не published → worktree/run ref лишаються для debug (спека,
        // «Failure-сімейство»).
        Ok(outcome)
    }

    /// Пауза/відпустити: CAS-delete claim + прибрати worktree; run ref
    /// лишається (журнал сесії — база відновлення наступного attach).
    pub fn release(self) -> Result<bool, String> {
        let released = release_claim(&self.repo_root, &self.node_hash, &self.claim_sha)?;
        let _ = remove_run_worktree(&self.repo_root, &self.worktree);
        Ok(released)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Герметична фікстура: bare-репо як origin + робочий клон із tasks-
    /// директорією `mt/demo` на `main` (патерн mt-core test_support).
    struct Fixture {
        #[allow(dead_code)]
        origin: tempfile::TempDir,
        work: tempfile::TempDir,
    }

    fn sh(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "test")
            .env("GIT_AUTHOR_EMAIL", "t@t.local")
            .env("GIT_COMMITTER_NAME", "test")
            .env("GIT_COMMITTER_EMAIL", "t@t.local")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    impl Fixture {
        fn new() -> Self {
            let origin = tempfile::tempdir().unwrap();
            sh(origin.path(), &["init", "--bare", "-q", "-b", "main"]);
            let work = tempfile::tempdir().unwrap();
            sh(work.path(), &["init", "-q", "-b", "main"]);
            std::fs::create_dir_all(work.path().join("mt/demo")).unwrap();
            std::fs::write(work.path().join("mt/demo/task.md"), "## Task\n").unwrap();
            sh(work.path(), &["add", "."]);
            sh(work.path(), &["commit", "-q", "-m", "init"]);
            sh(
                work.path(),
                &["remote", "add", "origin", origin.path().to_str().unwrap()],
            );
            sh(work.path(), &["push", "-q", "origin", "main"]);
            Self { origin, work }
        }

        fn config(&self) -> GraphConfig {
            GraphConfig::new(self.work.path().join("mt"))
        }

        fn remote_refs(&self) -> String {
            super::git(self.work.path(), &["ls-remote", "origin"]).unwrap()
        }
    }

    /// attach: claim ref + run ref на remote, detached worktree від base_sha.
    #[test]
    fn attach_claims_and_materializes_worktree() {
        let fixture = Fixture::new();
        let run = attach(&fixture.config(), "demo").unwrap();

        assert!(run.worktree.exists());
        let refs = fixture.remote_refs();
        assert!(
            refs.contains(&format!("refs/mt/claims/{}", run.node_hash)),
            "{refs}"
        );
        assert!(
            refs.contains(&format!("refs/mt/runs/{}/{}", run.node_hash, run.token)),
            "{refs}"
        );
        let head = super::git(&run.worktree, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(head, run.base_sha, "worktree від base_sha (origin/main)");
    }

    /// Другий attach того самого вузла — claim-lost, не системна помилка.
    #[test]
    fn second_attach_is_claim_lost() {
        let fixture = Fixture::new();
        let _held = attach(&fixture.config(), "demo").unwrap();
        let error = attach(&fixture.config(), "demo").unwrap_err();
        assert!(error.contains("claim-lost"), "{error}");
    }

    /// commit_turn пише журнал у run ref; done стрипає .nitra/ і публікує
    /// fact у main; claim/run ref прибрані.
    #[test]
    fn turn_then_done_publishes_without_session_artifacts() {
        let fixture = Fixture::new();
        let run = attach(&fixture.config(), "demo").unwrap();

        // Хід: результатний файл + журнал сесії.
        std::fs::write(run.worktree.join("mt/demo/fact_001.md"), "## Summary\nok\n").unwrap();
        run.commit_turn("{\"seq\":0}\n", "mt: demo run 001 (хід 1)")
            .unwrap();

        // Журнал доїхав у run ref.
        let run_ref = format!("refs/mt/runs/{}/{}", run.node_hash, run.token);
        let journal = super::git(
            fixture.work.path(),
            &["show", &format!("{run_ref}:.nitra/session.jsonl")],
        );
        // ls-remote бачить ref, а show читає локальний — worktree пушить
        // напряму в origin; читаємо з origin.
        let origin_journal = super::git(
            Path::new(fixture.origin.path()),
            &["show", &format!("{run_ref}:.nitra/session.jsonl")],
        )
        .unwrap();
        assert_eq!(origin_journal, "{\"seq\":0}");
        drop(journal);

        let node_hash = run.node_hash.clone();
        let outcome = run.done(3, 10).unwrap();
        assert!(outcome.published, "{outcome:?}");

        // main просунувся, fact є, .nitra/ немає, claim/run ref прибрані.
        let main_files = super::git(
            Path::new(fixture.origin.path()),
            &["ls-tree", "-r", "--name-only", "main"],
        )
        .unwrap();
        assert!(main_files.contains("mt/demo/fact_001.md"), "{main_files}");
        assert!(
            !main_files.contains(".nitra"),
            ".nitra/ не мусить потрапити у main: {main_files}"
        );
        let refs = fixture.remote_refs();
        assert!(
            !refs.contains(&format!("refs/mt/claims/{node_hash}")),
            "{refs}"
        );
        assert!(!refs.contains("refs/mt/runs/"), "{refs}");
    }

    /// renew просуває claim SHA і лишає ownership за нами.
    #[test]
    fn renew_extends_lease() {
        let fixture = Fixture::new();
        let mut run = attach(&fixture.config(), "demo").unwrap();
        let before = run.claim_sha.clone();
        assert!(run.renew().unwrap());
        assert_ne!(run.claim_sha, before, "renewal — новий claim commit");
        // Після renewal вузол досі зайнятий.
        assert!(attach(&fixture.config(), "demo").is_err());
    }

    /// release: claim знято (вузол знову вільний), run ref лишається.
    #[test]
    fn release_frees_node_and_keeps_run_ref() {
        let fixture = Fixture::new();
        let run = attach(&fixture.config(), "demo").unwrap();
        run.commit_turn("{\"seq\":0}\n", "mt: журнал").unwrap();
        let token = run.token.clone();
        let node_hash = run.node_hash.clone();

        assert!(run.release().unwrap());

        let refs = fixture.remote_refs();
        assert!(
            !refs.contains(&format!("refs/mt/claims/{node_hash}")),
            "{refs}"
        );
        assert!(
            refs.contains(&format!("refs/mt/runs/{node_hash}/{token}")),
            "run ref — база відновлення: {refs}"
        );
        // Вузол знову можна attach-нути.
        assert!(attach(&fixture.config(), "demo").is_ok());
    }
}

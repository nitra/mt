//! Run-wrapper (спека mt.md, «Wrapper-скрипт») — git-режим за замовчуванням:
//! CAS claim → detached worktree від `origin/main` → spawn агента у worktree
//! → watchdog (hard budget → SIGKILL, progress-timeout за mtime) → підсумок
//! через [`crate::signal`] (fact є → done/audit + composite вгору, інакше
//! failed із секціями з `run-draft.md`) → коміт worktree → fenced publish.
//!
//! Вимагає git-репозиторій з `origin`, до якого є push-доступ (claims/publish
//! — реальні мутації спільного remote). Rejected claim / merge-conflict /
//! вичерпаний publish-retry → `Err` (нормальний "інший runner виграв", не
//! системний збій) — викликач (`orchestrate::run_auto`) додає вузол у
//! skip-set цього проходу й переходить до інших.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::claims::{
    acquire_claim, discover_repo_root, node_hash, tasks_root_relative, ClaimFields,
};
use crate::config::merge_config;
use crate::frontmatter::parse_front_matter;
use crate::nnn::pad_nnn;
use crate::publish::{fenced_publish, PublishRequest};
use crate::signal::{self, next_run_nnn, write_run_fm};
use crate::worktree::{create_run_worktree, push_run_ref, remove_run_worktree};
use crate::{accepted_fact_state, validate_name, FactState};

/// Дефолтний шаблон команди агента ({path} — вузол відносно project root,
/// {nnn} — номер спроби). Перекривається `agent_cmd` у `.mt.json`.
const DEFAULT_AGENT_CMD: &str = "claude --permission-mode acceptEdits -p \"Виконай mt-вузол {path}: прочитай {path}/task.md (місія і критерій ## Done when) та наявні plan_*.md. Зроби роботу. Успіх → запиши {path}/fact_{nnn}.md: YAML frontmatter (schema_version: 1, created_at) + секція ## Summary одним реченням + опційні секції з ref: на створені файли. Невдача → НЕ створюй fact, запиши {path}/run-draft.md із секціями ## Completed, ## Blockers, ## Next Attempt.\"";

/// План запуску після preflight — бюджети, NNN, щабель ретраю.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunPlan {
    pub nnn: u64,
    pub attempt: u64,
    pub budget_sec: u64,
    pub budget_hard_sec: u64,
    pub progress_timeout_sec: u64,
    pub agent_cmd: String,
}

/// Підсумок спроби (файли вже опубліковані в `origin/main`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunOutcome {
    /// success | failed | progress-timeout | budget-exceeded
    pub result: String,
    pub run_file: String,
    pub fact_file: Option<String>,
    pub wall_sec: u64,
    pub propagated: Vec<String>,
}

fn node_dir(tasks_dir: &str, node_path: &str) -> Result<PathBuf, String> {
    validate_name(node_path)?;
    let dir = Path::new(tasks_dir).join(node_path);
    if !dir.join("task.md").is_file() {
        return Err(format!("node not found: {node_path}"));
    }
    Ok(dir)
}

fn fm_u64(v: &serde_json::Value, key: &str) -> Option<u64> {
    v.get(key).and_then(serde_json::Value::as_u64)
}

/// Preflight за спекою: a.md, deps resolved, без відкритого аудиту, вузол не
/// running; бюджети — task.md > .mt.json > дефолти. Суто локальні перевірки
/// (без git) — дешевий гейт перед дорожчим claim acquisition.
pub fn preflight(tasks_dir: &str, node_path: &str) -> Result<RunPlan, String> {
    let dir = node_dir(tasks_dir, node_path)?;
    if !dir.join("a.md").is_file() {
        return Err("вузол без a.md — runner запускає лише агентські вузли".to_string());
    }
    if crate::has_running_marker(&dir) {
        return Err("вузол уже running (є running_* маркер)".to_string());
    }
    match accepted_fact_state(&dir) {
        FactState::PendingAudit => {
            return Err("відкритий аудит-цикл — retry заблоковано".to_string())
        }
        FactState::Resolved => return Err("вузол уже resolved".to_string()),
        FactState::None => {}
    }
    for dep in crate::read_deps_dir(&dir) {
        let dep_dir = Path::new(tasks_dir).join(&dep);
        if !dep_dir.join("task.md").is_file() {
            return Err(format!("blocked-invalid-dep: {dep}"));
        }
        if accepted_fact_state(&dep_dir) != FactState::Resolved {
            return Err(format!("blocked: {dep} не resolved"));
        }
    }

    let task_fm = fs::read_to_string(dir.join("task.md"))
        .map(|c| parse_front_matter(&c))
        .unwrap_or(serde_json::Value::Null);
    let project_root = Path::new(tasks_dir)
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();
    let config = fs::read_to_string(project_root.join(".mt.json"))
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .unwrap_or(serde_json::Value::Null);

    let budget_sec = fm_u64(&task_fm, "budget_sec")
        .or_else(|| fm_u64(&config, "default_budget_sec"))
        .unwrap_or(1800);
    let multiplier = fm_u64(&config, "budget_hard_sec_multiplier").unwrap_or(3);
    let budget_hard_sec = fm_u64(&task_fm, "budget_hard_sec")
        .or_else(|| fm_u64(&config, "default_budget_hard_sec"))
        .unwrap_or(budget_sec * multiplier);
    if budget_hard_sec == 0 {
        return Err(
            "budget_hard_sec: 0 → validation error (hard limit не вимикається)".to_string(),
        );
    }
    let progress_timeout_sec = fm_u64(&task_fm, "progress_timeout_sec")
        .or_else(|| fm_u64(&config, "progress_timeout_sec"))
        .unwrap_or(300);

    let nnn = next_run_nnn(&dir);
    let last_fact = crate::max_nnn(&dir, "fact_", ".md");
    let attempt = nnn.saturating_sub(last_fact).max(1);

    let agent_cmd = config
        .get("agent_cmd")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(DEFAULT_AGENT_CMD)
        .to_string();

    Ok(RunPlan {
        nnn,
        attempt,
        budget_sec,
        budget_hard_sec,
        progress_timeout_sec,
        agent_cmd,
    })
}

/// Останній mtime у піддереві (для progress-watchdog).
fn latest_mtime(dir: &Path) -> SystemTime {
    let mut latest = SystemTime::UNIX_EPOCH;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(m) = meta.modified() {
                    if m > latest {
                        latest = m;
                    }
                }
                if meta.is_dir() {
                    stack.push(entry.path());
                }
            }
        }
    }
    latest
}

/// Секція `## <name>` з markdown-тексту (для run-draft.md).
fn md_section(text: &str, name: &str) -> Option<String> {
    let header = format!("## {name}");
    let mut inside = false;
    let mut out = Vec::new();
    for line in text.lines() {
        if line.trim() == header {
            inside = true;
            continue;
        }
        if inside {
            if line.starts_with("## ") {
                break;
            }
            out.push(line);
        }
    }
    let s = out.join("\n").trim().to_string();
    (!s.is_empty()).then_some(s)
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

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn iso_plus(sec: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(sec))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Псевдо-унікальний токен спроби без залежності `uuid` (час + pid).
fn fresh_token() -> String {
    let nanos = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
    format!("{nanos:x}-{}", std::process::id())
}

fn worktrees_dir_path(repo_root: &Path, config: &serde_json::Value) -> PathBuf {
    let raw = config
        .get("worktrees_dir")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("./.worktrees");
    let rel = raw.strip_prefix("./").unwrap_or(raw);
    if Path::new(rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        repo_root.join(rel)
    }
}

/// Комітить усі зміни worktree (fact/run/plan/тощо); "нема що комітити" —
/// не помилка (агент теоретично міг не лишити diff).
fn commit_worktree(worktree: &Path, message: &str) -> Result<(), String> {
    git(worktree, &["add", "-A"])?;
    let status = git(worktree, &["status", "--porcelain"])?;
    if status.is_empty() {
        return Ok(());
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["commit", "-q", "-m", message])
        .env("GIT_AUTHOR_NAME", "mt-runner")
        .env("GIT_AUTHOR_EMAIL", "mt-runner@localhost")
        .env("GIT_COMMITTER_NAME", "mt-runner")
        .env("GIT_COMMITTER_EMAIL", "mt-runner@localhost")
        .output()
        .map_err(|e| format!("git commit: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git commit: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Запускає агента, супроводжує спробу до кінця і публікує результат через
/// fenced publish. **Блокуючий** — викликач (Tauri/CLI) сам вирішує потік.
pub fn run_node(tasks_dir: &str, node_path: &str) -> Result<RunOutcome, String> {
    let plan = preflight(tasks_dir, node_path)?;

    let repo_root = discover_repo_root(Path::new(tasks_dir))?;
    let tasks_root_rel = tasks_root_relative(&repo_root, Path::new(tasks_dir))?;
    let hash = node_hash(&tasks_root_rel, node_path);

    let raw_config = fs::read_to_string(repo_root.join(".mt.json")).ok();
    let config = merge_config(raw_config.as_deref());
    let claim_lease_sec = fm_u64(&config, "claim_lease_sec").unwrap_or(3600) as i64;
    let publish_retry_max = fm_u64(&config, "publish_retry_max").unwrap_or(8) as u32;
    let publish_retry_base_ms = fm_u64(&config, "publish_retry_base_ms").unwrap_or(250);

    git(&repo_root, &["fetch", "--quiet", "origin", "main"])?;
    let base_sha = git(&repo_root, &["rev-parse", "origin/main"])?;

    let token = fresh_token();
    let runner_id = format!("mt-runner/{}", std::process::id());
    let run_ref = format!("refs/mt/runs/{hash}/{token}");
    let claimed_at = iso_now();
    let lease_until = iso_plus(claim_lease_sec);
    let fields = ClaimFields {
        node: node_path,
        actor: "agent",
        runner_id: &runner_id,
        claimed_at: &claimed_at,
        lease_until: &lease_until,
        token: &token,
        generation: 1,
        base_sha: &base_sha,
        run_ref: &run_ref,
        interactive: false,
    };
    let claim = acquire_claim(&repo_root, &hash, &fields)?;
    if !claim.accepted {
        return Err("claim-lost: інший runner уже володіє цим вузлом".to_string());
    }

    let worktrees_dir = worktrees_dir_path(&repo_root, &config);
    let worktree = create_run_worktree(&repo_root, &worktrees_dir, &hash, &token, &base_sha)?;
    push_run_ref(&worktree, &hash, &token)?;

    let wt_tasks_dir = worktree.join(&tasks_root_rel);
    let wt_tasks_dir_str = wt_tasks_dir.to_string_lossy().into_owned();
    let dir = wt_tasks_dir.join(node_path);
    let nnn_s = pad_nnn(plan.nnn);

    let rel_path = format!("{tasks_root_rel}/{node_path}");
    let cmd = plan
        .agent_cmd
        .replace("{path}", &rel_path)
        .replace("{nnn}", &nnn_s);

    let started = Instant::now();
    let started_unix = chrono::Utc::now().timestamp();
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&worktree)
        .env("MT_BUDGET_SEC", plan.budget_sec.to_string())
        .env("MT_HARD_BUDGET_SEC", plan.budget_hard_sec.to_string())
        .env("MT_STARTED_AT", started_unix.to_string())
        .env("MT_RUN_NNN", &nnn_s)
        .env("MT_ATTEMPT", plan.attempt.to_string())
        .env("MT_CLAIM_TOKEN", &token)
        .env("MT_CLAIM_GENERATION", "1")
        .spawn()
        .map_err(|e| format!("spawn agent: {e}"))?;

    // Локальний observability-маркер у ЖИВІЙ tasks_dir (git-ignored; НЕ lock)
    // — сканер бачить running, доки claim — джерело правди щодо ownership.
    let live_dir = node_dir(tasks_dir, node_path)?;
    let marker = live_dir.join(format!(
        "running_{}_until_{}",
        child.id(),
        started_unix + plan.budget_hard_sec as i64
    ));
    let _ = fs::write(&marker, "");

    let mut kill_reason: Option<&str> = None;
    let mut baseline_mtime = latest_mtime(&dir);
    let mut baseline_at = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => break,
            None => {
                if started.elapsed().as_secs() > plan.budget_hard_sec {
                    let _ = child.kill();
                    kill_reason = Some("budget-exceeded");
                    let _ = child.wait();
                    break;
                }
                let m = latest_mtime(&dir);
                if m > baseline_mtime {
                    baseline_mtime = m;
                    baseline_at = Instant::now();
                } else if baseline_at.elapsed().as_secs() > plan.progress_timeout_sec {
                    let _ = child.kill();
                    kill_reason = Some("progress-timeout");
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    let _ = fs::remove_file(&marker);
    let wall_sec = started.elapsed().as_secs();
    let wall_fm = format!("wall_sec: {wall_sec}\n");

    let fact_file = format!("fact_{nnn_s}.md");
    let (result, run_file, out_fact_file, propagated) = if kill_reason.is_none()
        && dir.join(&fact_file).is_file()
    {
        let policy_required = fs::read_to_string(dir.join("task.md"))
            .map(|c| parse_front_matter(&c))
            .ok()
            .and_then(|fm| {
                fm.get("audit")
                    .and_then(serde_json::Value::as_str)
                    .map(|s| s == "required")
            })
            .unwrap_or(false);
        let signaled = if policy_required {
            signal::audit(&wt_tasks_dir_str, node_path, "agent")
        } else {
            signal::done(&wt_tasks_dir_str, node_path, "agent")
        };
        match signaled {
            Ok(out) => (
                "success".to_string(),
                out.run_file,
                Some(out.fact_file),
                out.propagated,
            ),
            Err(check_err) => {
                let sections = format!(
                    "\n## Completed\n\nfact записано, але ## Check не пройшов\n\n## Blockers\n\n{check_err}\n\n## Next Attempt\n\nвиправити і повторити done\n"
                );
                let run_file = write_run_fm(&dir, &nnn_s, "agent", "failed", &sections, &wall_fm)?;
                ("failed".to_string(), run_file, None, Vec::new())
            }
        }
    } else {
        let draft = fs::read_to_string(dir.join("run-draft.md")).unwrap_or_default();
        let result = kill_reason.unwrap_or("failed").to_string();
        let completed =
            md_section(&draft, "Completed").unwrap_or_else(|| "невідомо (draft відсутній)".into());
        let blockers = md_section(&draft, "Blockers")
            .unwrap_or_else(|| format!("процес завершився без fact ({result})"));
        let next = md_section(&draft, "Next Attempt")
            .unwrap_or_else(|| "діагностувати попередній ран".into());
        let sections = format!(
            "\n## Completed\n\n{completed}\n\n## Blockers\n\n{blockers}\n\n## Next Attempt\n\n{next}\n"
        );
        let run_file = write_run_fm(&dir, &nnn_s, "agent", &result, &sections, &wall_fm)?;
        (result, run_file, None, Vec::new())
    };

    commit_worktree(
        &worktree,
        &format!("mt: {node_path} run {nnn_s} ({result})"),
    )?;

    let publish_req = PublishRequest {
        worktree: &worktree,
        node_hash: &hash,
        claim_sha: &claim.commit_sha,
        token: &token,
        run_ref_sha_before: &base_sha,
    };
    let publish = fenced_publish(
        &repo_root,
        &publish_req,
        publish_retry_max,
        publish_retry_base_ms,
    )?;

    if !publish.published {
        // Worktree/run ref лишаються для debug (спека, «Failure-сімейство» /
        // «Orphan worktree») — не видаляємо, наступний runner чи людина
        // розбереться. Claim теж не чіпаємо: якщо fenced — він уже не наш.
        return Err(if publish.fenced {
            "claim-lost: втрачено ownership під час виконання, publish скасовано".to_string()
        } else {
            "publish: вичерпано retry — конкурентний publish виграв гонку, спробуйте пізніше"
                .to_string()
        });
    }

    // Успішна публікація — worktree більше не потрібен.
    let _ = remove_run_worktree(&repo_root, &worktree);

    Ok(RunOutcome {
        result,
        run_file,
        fact_file: out_fact_file,
        wall_sec,
        propagated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestRepo;

    const TASK: &str = "---\nschema_version: 1\ncreated_at: 2026-06-06T10:00:00Z\nbudget_sec: 5\nbudget_hard_sec: 2\nprogress_timeout_sec: 60\n---\n\n## Task\n\nx\n";

    /// Пише task.md/a.md на диск, без git — для тестів `preflight()`
    /// (суто файлова логіка, git-репо не потрібне).
    fn node_files_only(tmp: &Path, path: &str) {
        let dir = tmp.join(path);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("task.md"), TASK).unwrap();
        fs::write(dir.join("a.md"), "schema_version: 1\n").unwrap();
    }

    /// Як [`node_files_only`], але комітить і пушить у `origin/main` —
    /// потрібно для `run_node()`: worktree чекаутиться саме з `origin/main`.
    fn node(tmp: &Path, path: &str) {
        node_files_only(tmp, path);
        crate::test_support::run(tmp, &["add", "."]);
        crate::test_support::run(tmp, &["commit", "-q", "-m", &format!("add {path}")]);
        crate::test_support::run(tmp, &["push", "-q", "origin", "main"]);
    }

    fn with_agent_cmd(repo: &TestRepo, cmd: &str) {
        fs::write(
            repo.work.path().join(".mt.json"),
            serde_json::json!({ "agent_cmd": cmd }).to_string(),
        )
        .unwrap();
        crate::test_support::run(repo.work.path(), &["add", ".mt.json"]);
        crate::test_support::run(repo.work.path(), &["commit", "-q", "-m", "config"]);
        crate::test_support::run(repo.work.path(), &["push", "-q", "origin", "main"]);
    }

    #[test]
    fn preflight_blocks_unresolved_deps_and_running() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mt");
        node_files_only(&root, "a");
        node_files_only(&root, "b");
        fs::create_dir_all(root.join("b/deps")).unwrap();
        fs::write(root.join("b/deps/a.md"), "").unwrap();
        let r = root.to_string_lossy().into_owned();

        assert!(preflight(&r, "b").unwrap_err().contains("blocked: a"));
        fs::write(root.join("a/running_1_until_9999999999"), "").unwrap();
        assert!(preflight(&r, "a").unwrap_err().contains("running"));
    }

    #[test]
    fn run_success_writes_run_and_publishes_to_origin_main() {
        let repo = TestRepo::new();
        let root = repo.work.path().join("mt");
        node(&root, "solo");
        with_agent_cmd(
            &repo,
            "printf -- '---\\nschema_version: 1\\n---\\n\\n## Summary\\n\\nok\\n' > {path}/fact_{nnn}.md",
        );
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "solo").unwrap();
        assert_eq!(out.result, "success");
        assert_eq!(out.fact_file.as_deref(), Some("fact_001.md"));
        assert!(!crate::has_running_marker(&root.join("solo")));

        // Опубліковано в origin/main: claim/run ref прибрані, коміт на remote.
        let claims = crate::test_support::output(
            repo.work.path(),
            &["ls-remote", "origin", "refs/mt/claims/*"],
        );
        assert!(claims.is_empty());
        // Локальний main (той самий work-клон) підхопив публікацію.
        assert!(root.join("solo/fact_001.md").is_file());
        assert!(root.join("solo/run_001.md").is_file());
    }

    #[test]
    fn hard_budget_kills_and_publishes_failure_run() {
        let repo = TestRepo::new();
        let root = repo.work.path().join("mt");
        node(&root, "slow");
        with_agent_cmd(&repo, "sleep 30");
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "slow").unwrap();
        assert_eq!(out.result, "budget-exceeded");
        let run = fs::read_to_string(root.join("slow/run_001.md")).unwrap();
        assert!(run.contains("result: budget-exceeded"));
        assert!(run.contains("wall_sec:"));
        assert!(!root.join("slow/fact_001.md").exists());
    }

    #[test]
    fn failure_takes_sections_from_draft_and_publishes() {
        let repo = TestRepo::new();
        let root = repo.work.path().join("mt");
        node(&root, "fail");
        with_agent_cmd(
            &repo,
            "printf -- '## Completed\\n\\nполовина\\n\\n## Blockers\\n\\nнемає доступу\\n\\n## Next Attempt\\n\\nдати ключ\\n' > {path}/run-draft.md; exit 1",
        );
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "fail").unwrap();
        assert_eq!(out.result, "failed");
        let run = fs::read_to_string(root.join("fail/run_001.md")).unwrap();
        assert!(run.contains("немає доступу"));
        assert!(run.contains("дати ключ"));
    }

    #[test]
    fn rejected_claim_when_node_already_claimed() {
        let repo = TestRepo::new();
        let root = repo.work.path().join("mt");
        node(&root, "solo");
        with_agent_cmd(&repo, "true");
        let r = root.to_string_lossy().into_owned();

        let hash = node_hash("mt", "solo");
        let base = repo.main_sha();
        let fields = ClaimFields {
            node: "solo",
            actor: "agent",
            runner_id: "other/1",
            claimed_at: &iso_now(),
            lease_until: &iso_plus(3600),
            token: "already-there",
            generation: 1,
            base_sha: &base,
            run_ref: "refs/mt/runs/x/already-there",
            interactive: false,
        };
        acquire_claim(repo.work.path(), &hash, &fields).unwrap();

        let err = run_node(&r, "solo").unwrap_err();
        assert!(err.contains("claim-lost"));
    }
}

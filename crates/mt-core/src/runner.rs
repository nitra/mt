//! Локальний run-wrapper (спека mt.md, «Wrapper-скрипт» — файловий рівень).
//!
//! Local-режим без remote claims і worktree: preflight (deps resolved, без
//! відкритого аудиту, вузол не running) → маркер `running_<pid>_until_<ts>` →
//! spawn агента (sh -c, cwd = project root, ENV `MT_*`) → watchdog (hard
//! budget → SIGKILL, progress-timeout за mtime вузла) → підсумок через
//! [`crate::signal`]: fact є → done/audit (+composite вгору), інакше failed
//! із секціями з `run-draft.md` або телеметрії. Git-протокол (CAS claims,
//! fenced publish) — наступна фаза; цей модуль для solo-машини.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use crate::frontmatter::parse_front_matter;
use crate::nnn::pad_nnn;
use crate::signal::{self, next_run_nnn, write_run_fm};
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

/// Підсумок спроби (файли вже записано).
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
/// running; бюджети — task.md > .mt.json > дефолти.
pub fn preflight(tasks_dir: &str, node_path: &str) -> Result<RunPlan, String> {
    let dir = node_dir(tasks_dir, node_path)?;
    if !dir.join("a.md").is_file() {
        return Err("вузол без a.md — локальний runner запускає лише агентські вузли".to_string());
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

/// Останній mtime у піддереві вузла (для progress-watchdog).
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

/// Запускає агента і супроводжує спробу до кінця. **Блокуючий** — викликач
/// (Tauri/CLI) сам вирішує, в якому потоці це жити.
pub fn run_node(tasks_dir: &str, node_path: &str) -> Result<RunOutcome, String> {
    let plan = preflight(tasks_dir, node_path)?;
    let dir = node_dir(tasks_dir, node_path)?;
    let project_root = Path::new(tasks_dir)
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();
    let rel_path = Path::new(tasks_dir)
        .file_name()
        .map(|n| format!("{}/{node_path}", n.to_string_lossy()))
        .unwrap_or_else(|| node_path.to_string());
    let nnn_s = pad_nnn(plan.nnn);

    let cmd = plan
        .agent_cmd
        .replace("{path}", &rel_path)
        .replace("{nnn}", &nnn_s);

    let started = Instant::now();
    let started_unix = chrono::Utc::now().timestamp();
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&project_root)
        .env("MT_BUDGET_SEC", plan.budget_sec.to_string())
        .env("MT_HARD_BUDGET_SEC", plan.budget_hard_sec.to_string())
        .env("MT_STARTED_AT", started_unix.to_string())
        .env("MT_RUN_NNN", &nnn_s)
        .env("MT_ATTEMPT", plan.attempt.to_string())
        .spawn()
        .map_err(|e| format!("spawn agent: {e}"))?;

    // Локальний observability-маркер (git-ignored; НЕ lock) — сканер бачить running.
    let marker = dir.join(format!(
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
    if kill_reason.is_none() && dir.join(&fact_file).is_file() {
        // Агент записав fact: audit-політика вирішує done чи audit.
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
            signal::audit(tasks_dir, node_path, "agent")
        } else {
            signal::done(tasks_dir, node_path, "agent")
        };
        match signaled {
            Ok(out) => {
                return Ok(RunOutcome {
                    result: "success".to_string(),
                    run_file: out.run_file,
                    fact_file: Some(out.fact_file),
                    wall_sec,
                    propagated: out.propagated,
                });
            }
            Err(check_err) => {
                // ## Check провалився — спроба фіксується як failed (fact лишається
                // для наступної спроби як контекст, «дірку» створює відсутність
                // прийнятого run success).
                let sections = format!(
                    "\n## Completed\n\nfact записано, але ## Check не пройшов\n\n## Blockers\n\n{check_err}\n\n## Next Attempt\n\nвиправити і повторити done\n"
                );
                let run_file = write_run_fm(&dir, &nnn_s, "agent", "failed", &sections, &wall_fm)?;
                return Ok(RunOutcome {
                    result: "failed".to_string(),
                    run_file,
                    fact_file: None,
                    wall_sec,
                    propagated: Vec::new(),
                });
            }
        }
    }

    // Failure-сімейство: секції з run-draft.md, fallback — телеметрія.
    let draft = fs::read_to_string(dir.join("run-draft.md")).unwrap_or_default();
    let result = kill_reason.unwrap_or("failed").to_string();
    let completed =
        md_section(&draft, "Completed").unwrap_or_else(|| "невідомо (draft відсутній)".into());
    let blockers = md_section(&draft, "Blockers")
        .unwrap_or_else(|| format!("процес завершився без fact ({result})"));
    let next =
        md_section(&draft, "Next Attempt").unwrap_or_else(|| "діагностувати попередній ран".into());
    let sections = format!(
        "\n## Completed\n\n{completed}\n\n## Blockers\n\n{blockers}\n\n## Next Attempt\n\n{next}\n"
    );
    let run_file = write_run_fm(&dir, &nnn_s, "agent", &result, &sections, &wall_fm)?;
    Ok(RunOutcome {
        result,
        run_file,
        fact_file: None,
        wall_sec,
        propagated: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TASK: &str = "---\nschema_version: 1\ncreated_at: 2026-06-06T10:00:00Z\nbudget_sec: 5\nbudget_hard_sec: 2\nprogress_timeout_sec: 60\n---\n\n## Task\n\nx\n";

    fn node(tmp: &Path, path: &str) {
        let dir = tmp.join(path);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("task.md"), TASK).unwrap();
        fs::write(dir.join("a.md"), "schema_version: 1\n").unwrap();
    }

    fn with_agent_cmd(tmp: &Path, cmd: &str) {
        fs::write(
            tmp.join(".mt.json"),
            serde_json::json!({ "agent_cmd": cmd }).to_string(),
        )
        .unwrap();
    }

    #[test]
    fn preflight_blocks_unresolved_deps_and_running() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mt");
        node(&root, "a");
        node(&root, "b");
        fs::create_dir_all(root.join("b/deps")).unwrap();
        fs::write(root.join("b/deps/a.md"), "").unwrap();
        let r = root.to_string_lossy().into_owned();

        assert!(preflight(&r, "b").unwrap_err().contains("blocked: a"));
        fs::write(root.join("a/running_1_until_9999999999"), "").unwrap();
        assert!(preflight(&r, "a").unwrap_err().contains("running"));
    }

    #[test]
    fn run_success_writes_run_via_done() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mt");
        node(&root, "solo");
        with_agent_cmd(
            tmp.path(),
            "printf -- '---\\nschema_version: 1\\n---\\n\\n## Summary\\n\\nok\\n' > {path}/fact_{nnn}.md",
        );
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "solo").unwrap();
        assert_eq!(out.result, "success");
        assert_eq!(out.fact_file.as_deref(), Some("fact_001.md"));
        assert!(root.join("solo/run_001.md").is_file());
        assert!(!crate::has_running_marker(&root.join("solo")));
    }

    #[test]
    fn hard_budget_kills_and_writes_failure_run() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mt");
        node(&root, "slow");
        with_agent_cmd(tmp.path(), "sleep 30");
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "slow").unwrap();
        assert_eq!(out.result, "budget-exceeded");
        let run = fs::read_to_string(root.join("slow/run_001.md")).unwrap();
        assert!(run.contains("result: budget-exceeded"));
        assert!(run.contains("wall_sec:"));
        assert!(!root.join("slow/fact_001.md").exists());
    }

    #[test]
    fn failure_takes_sections_from_draft() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mt");
        node(&root, "fail");
        with_agent_cmd(
            tmp.path(),
            "printf -- '## Completed\\n\\nполовина\\n\\n## Blockers\\n\\nнемає доступу\\n\\n## Next Attempt\\n\\nдати ключ\\n' > {path}/run-draft.md; exit 1",
        );
        let r = root.to_string_lossy().into_owned();
        let out = run_node(&r, "fail").unwrap();
        assert_eq!(out.result, "failed");
        let run = fs::read_to_string(root.join("fail/run_001.md")).unwrap();
        assert!(run.contains("немає доступу"));
        assert!(run.contains("дати ключ"));
    }
}

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Unassigned,
    Pending,       // h.md exists
    Waiting,       // a.md exists, deps resolved
    Blocked,       // a.md exists, deps not resolved
    PlanReview,    // composite plan awaiting human approval
    Spawned,       // children materialized, not all resolved
    Running,       // running_<pid>_until_<ts> sentinel present
    PendingAudit,  // open audit cycle
    Resolved,      // accepted fact exists
    Failed,        // failed_streak >= agent_retry_max
    Unresolvable,  // unresolvable.md exists (terminal)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub path: String,
    pub state: TaskState,
    pub deps: Vec<String>,
    pub mode: String,
    pub budget_sec: Option<u64>,
    pub budget_hard_sec: Option<u64>,
    pub deadline: Option<String>,
    pub hint: Option<String>,
    pub created_at: Option<String>,
    pub children: Vec<TaskNode>,
    pub is_composite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub label: String,
    pub path: String,
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

struct Frontmatter {
    created_at: Option<String>,
    budget_sec: Option<u64>,
    budget_hard_sec: Option<u64>,
    deadline: Option<String>,
    hint: Option<String>,
}

impl Default for Frontmatter {
    fn default() -> Self {
        Self {
            created_at: None,
            budget_sec: None,
            budget_hard_sec: None,
            deadline: None,
            hint: None,
        }
    }
}

fn parse_frontmatter(content: &str) -> Frontmatter {
    let mut fm = Frontmatter::default();
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return fm;
    }
    let end = lines[1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|i| i + 1)
        .unwrap_or(lines.len());
    for line in &lines[1..end] {
        let t = line.trim();
        if t == "---" { break; }
        if let Some(pos) = t.find(':') {
            let key = t[..pos].trim();
            let val = t[pos + 1..].trim();
            match key {
                "created_at"      => fm.created_at      = Some(val.to_string()),
                "budget_sec"      => fm.budget_sec      = val.parse().ok(),
                "budget_hard_sec" => fm.budget_hard_sec = val.parse().ok(),
                "deadline"        => fm.deadline        = Some(val.to_string()),
                "hint"            => fm.hint            = Some(val.to_string()),
                _ => {}
            }
        }
    }
    fm
}

// ── NNN helpers ───────────────────────────────────────────────────────────────

fn max_nnn(dir: &Path, prefix: &str, suffix: &str) -> u64 {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let n = e.file_name();
            let s = n.to_string_lossy();
            if s.starts_with(prefix) && s.ends_with(suffix) {
                s[prefix.len()..s.len() - suffix.len()].parse::<u64>().ok()
            } else {
                None
            }
        })
        .max()
        .unwrap_or(0)
}

fn failed_streak(dir: &Path) -> u64 {
    max_nnn(dir, "run_", ".md").saturating_sub(max_nnn(dir, "fact_", ".md"))
}

// ── State detection ───────────────────────────────────────────────────────────

fn has_pending_audit(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    for e in entries.flatten() {
        if e.file_type().map(|t| !t.is_file()).unwrap_or(true) { continue; }
        let n = e.file_name();
        let s = n.to_string_lossy();
        if s.starts_with("pending-audit_") && s.ends_with(".md") {
            let nnn = &s["pending-audit_".len()..s.len() - 3];
            if !dir.join(format!("audit-result_{nnn}.md")).exists() {
                return true;
            }
        }
    }
    false
}

// Reads result: field from audit-result frontmatter (only exception to name-based state rule).
fn audit_result_success(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else { return false };
    let lines: Vec<&str> = content.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") { return false; }
    let end = lines[1..].iter().position(|l| l.trim() == "---").map(|i| i + 1).unwrap_or(lines.len());
    for line in &lines[1..end] {
        if let Some(val) = line.trim().strip_prefix("result:") {
            return val.trim() == "success";
        }
    }
    false
}

fn has_accepted_fact(dir: &Path) -> bool {
    let nnn = max_nnn(dir, "fact_", ".md");
    if nnn == 0 { return false; }
    let nnn_s = format!("{nnn:03}");
    let pending = dir.join(format!("pending-audit_{nnn_s}.md"));
    if !pending.exists() { return true; }
    // Audit requested — check if it completed with success.
    let result_path = dir.join(format!("audit-result_{nnn_s}.md"));
    if !result_path.exists() { return false; }
    audit_result_success(&result_path)
}

fn has_running_sentinel(dir: &Path) -> bool {
    fs::read_dir(dir).ok().is_some_and(|entries| {
        entries.flatten().any(|e| {
            e.file_type().map(|t| t.is_file()).unwrap_or(false)
                && e.file_name().to_string_lossy().starts_with("running_")
        })
    })
}

fn plan_decision(dir: &Path, nnn: u64) -> Option<String> {
    let content = fs::read_to_string(dir.join(format!("plan_{nnn:03}.md"))).ok()?;
    let lines: Vec<&str> = content.lines().collect();
    if lines.first()?.trim() != "---" { return None; }
    let end = lines[1..].iter().position(|l| l.trim() == "---").map(|i| i + 1).unwrap_or(lines.len());
    for line in &lines[1..end] {
        if let Some(val) = line.trim().strip_prefix("decision:") {
            return Some(val.trim().to_string());
        }
    }
    None
}

fn check_plan_review(dir: &Path) -> Option<TaskState> {
    let nnn = max_nnn(dir, "plan_", ".md");
    if nnn == 0 { return None; }
    if plan_decision(dir, nnn).as_deref() != Some("composite") { return None; }
    if dir.join(format!("plan-approved_{nnn:03}.md")).exists() { return None; }
    if dir.join(format!("plan-rejected_{nnn:03}.md")).exists() { return None; }
    Some(TaskState::PlanReview)
}

// Priority per spec:
// pending-audit > resolved > unresolvable > (stalled — needs remote) > running >
// plan-review > spawned > waiting/blocked > pending > unassigned > failed
fn detect_state(dir: &Path, children: &[TaskNode], agent_retry_max: u64) -> TaskState {
    if dir.join("unresolvable.md").exists() {
        return TaskState::Unresolvable;
    }
    if has_pending_audit(dir) {
        return TaskState::PendingAudit;
    }
    if has_accepted_fact(dir) {
        return TaskState::Resolved;
    }
    if has_running_sentinel(dir) {
        return TaskState::Running;
    }
    if let Some(st) = check_plan_review(dir) {
        return st;
    }
    // Spawned: children materialized (plan approved), not all resolved.
    if !children.is_empty() {
        return TaskState::Spawned;
    }
    // Atomic: failed only after streak exhausted; before that stays waiting.
    if max_nnn(dir, "run_", ".md") > 0 && failed_streak(dir) >= agent_retry_max {
        return TaskState::Failed;
    }
    if dir.join("a.md").exists() {
        return TaskState::Waiting; // may be upgraded to Blocked in post-processing
    }
    if dir.join("h.md").exists() {
        return TaskState::Pending;
    }
    TaskState::Unassigned
}

// ── Blocked post-processing ───────────────────────────────────────────────────

fn build_state_map(nodes: &[TaskNode], map: &mut HashMap<String, TaskState>) {
    for node in nodes {
        map.insert(node.path.clone(), node.state.clone());
        build_state_map(&node.children, map);
    }
}

fn apply_blocked(nodes: &mut [TaskNode], state_map: &HashMap<String, TaskState>) {
    for node in nodes.iter_mut() {
        if node.state == TaskState::Waiting && !node.deps.is_empty() {
            let blocked = node.deps.iter().any(|dep_id| {
                state_map.get(dep_id).map_or(true, |s| *s != TaskState::Resolved)
            });
            if blocked {
                node.state = TaskState::Blocked;
            }
        }
        if !node.children.is_empty() {
            apply_blocked(&mut node.children, state_map);
        }
    }
}

// ── Deps ──────────────────────────────────────────────────────────────────────

fn collect_deps(deps_root: &Path, current: &Path, result: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(current) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_deps(deps_root, &path, result);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(deps_root) {
                let dep_str = rel.to_string_lossy().replace('\\', "/");
                let dep_id = dep_str.strip_suffix(".md").unwrap_or(&dep_str).to_string();
                result.push(dep_id);
            }
        }
    }
}

fn read_deps_dir(node_dir: &Path) -> Vec<String> {
    let deps_dir = node_dir.join("deps");
    if !deps_dir.is_dir() { return vec![]; }
    let mut result = vec![];
    collect_deps(&deps_dir, &deps_dir, &mut result);
    result
}

// ── Node scanner ──────────────────────────────────────────────────────────────

fn scan_dir(dir: &Path, tasks_root: &Path, agent_retry_max: u64) -> Option<TaskNode> {
    if !dir.join("task.md").exists() { return None; }

    let content = fs::read_to_string(dir.join("task.md")).unwrap_or_default();
    let fm = parse_frontmatter(&content);

    let mode = if dir.join("a.md").exists() { "agent" }
               else if dir.join("h.md").exists() { "human" }
               else { "unassigned" };

    let deps = read_deps_dir(dir);

    // Scan children; skip history/ and other non-node dirs (no task.md = None).
    let mut children: Vec<TaskNode> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        let mut subdirs: Vec<_> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .collect();
        subdirs.sort_by_key(|e| e.file_name());
        for sub in subdirs {
            if let Some(child) = scan_dir(&sub.path(), tasks_root, agent_retry_max) {
                children.push(child);
            }
        }
    }

    let is_composite = !children.is_empty();
    let id = dir.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let path = dir
        .strip_prefix(tasks_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| id.clone());
    let state = detect_state(dir, &children, agent_retry_max);

    Some(TaskNode {
        id,
        path,
        state,
        deps,
        mode: mode.to_string(),
        budget_sec: fm.budget_sec,
        budget_hard_sec: fm.budget_hard_sec,
        deadline: fm.deadline,
        hint: fm.hint,
        created_at: fm.created_at,
        children,
        is_composite,
    })
}

// ── Workspace discovery ───────────────────────────────────────────────────────

fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if current.join(".git").exists() { return Some(current.to_path_buf()); }
        current = current.parent()?;
    }
}

fn workspace_label(git_root: &Path, workspace_dir: &Path) -> String {
    if workspace_dir == git_root {
        git_root.file_name().and_then(|n| n.to_str()).unwrap_or("root").to_string()
    } else {
        workspace_dir
            .strip_prefix(git_root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| workspace_dir.to_string_lossy().into_owned())
    }
}

fn load_gitignore(dir: &Path, inherited: &[String]) -> Vec<String> {
    let mut patterns = inherited.to_vec();
    if let Ok(content) = fs::read_to_string(dir.join(".gitignore")) {
        for line in content.lines() {
            let l = line.trim();
            if !l.is_empty() && !l.starts_with('#') && !l.starts_with('!') {
                patterns.push(l.trim_end_matches('/').trim_start_matches('/').to_string());
            }
        }
    }
    patterns
}

fn glob_match_name(pattern: &str, name: &str) -> bool {
    match pattern.split_once('*') {
        Some((prefix, suffix)) => {
            name.starts_with(prefix)
                && name.ends_with(suffix)
                && name.len() >= prefix.len() + suffix.len()
        }
        None => name == pattern,
    }
}

fn dir_is_gitignored(name: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| glob_match_name(p, name))
}

fn has_task_nodes(dir: &Path) -> bool {
    fs::read_dir(dir).ok().is_some_and(|entries| {
        entries.flatten().any(|e| {
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && e.path().join("task.md").exists()
        })
    })
}

fn scan_for_workspaces(
    current: &Path,
    git_root: &Path,
    result: &mut Vec<WorkspaceInfo>,
    depth: u8,
    inherited_ignores: &[String],
) {
    if depth > 6 { return; }

    let ignores = load_gitignore(current, inherited_ignores);

    let mt_config = current.join(".mt.json");
    if mt_config.exists() {
        let mt_dir = fs::read_to_string(&mt_config)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .and_then(|v| v.get("mt_dir").and_then(|v| v.as_str()).map(|s| current.join(s)))
            .unwrap_or_else(|| current.join("mt"));
        if mt_dir.is_dir() && has_task_nodes(&mt_dir) {
            result.push(WorkspaceInfo {
                label: workspace_label(git_root, current),
                path: mt_dir.to_string_lossy().into_owned(),
            });
            return;
        }
    }

    for dirname in &["mt", "tasks"] {
        let candidate = current.join(dirname);
        if candidate.is_dir() && has_task_nodes(&candidate) {
            result.push(WorkspaceInfo {
                label: workspace_label(git_root, current),
                path: candidate.to_string_lossy().into_owned(),
            });
            return;
        }
    }

    let Ok(entries) = fs::read_dir(current) else { return };
    let mut subdirs: Vec<_> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let n = name.to_string_lossy();
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && !n.starts_with('.')
                && !matches!(n.as_ref(), "node_modules" | "target" | "dist" | "build")
                && !dir_is_gitignored(&n, &ignores)
        })
        .collect();
    subdirs.sort_by_key(|e| e.file_name());
    for sub in subdirs {
        scan_for_workspaces(&sub.path(), git_root, result, depth + 1, &ignores);
    }
}

fn read_agent_retry_max(project_root: &Path) -> u64 {
    fs::read_to_string(project_root.join(".mt.json"))
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| v.get("agent_retry_max").and_then(|v| v.as_u64()))
        .unwrap_or(3)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Сканує `tasks_dir` і повертає дерево вузлів.
pub fn scan_tasks(tasks_dir: String) -> Result<Vec<TaskNode>, String> {
    let dir = PathBuf::from(&tasks_dir);
    if !dir.exists() {
        return Err(format!("Directory not found: {tasks_dir}"));
    }
    let project_root = dir.parent().unwrap_or(&dir).to_path_buf();
    let agent_retry_max = read_agent_retry_max(&project_root);

    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut nodes: Vec<TaskNode> = entries
        .iter()
        .filter_map(|e| scan_dir(&e.path(), &dir, agent_retry_max))
        .collect();

    // Post-processing: mark Waiting → Blocked where deps are not yet resolved.
    let mut state_map = HashMap::new();
    build_state_map(&nodes, &mut state_map);
    apply_blocked(&mut nodes, &state_map);

    Ok(nodes)
}

/// Знаходить усі mt/ директорії у репо, починаючи від `start_dir`.
pub fn find_all_tasks_dirs_from(start_dir: &Path) -> Vec<WorkspaceInfo> {
    let git_root = find_git_root(start_dir).unwrap_or_else(|| start_dir.to_path_buf());
    let mut result = vec![];
    scan_for_workspaces(&git_root, &git_root, &mut result, 0, &[]);
    result
}

/// Знаходить усі mt/ директорії у репо від поточного cwd.
pub fn find_all_tasks_dirs() -> Result<Vec<WorkspaceInfo>, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(find_all_tasks_dirs_from(&cwd))
}

/// Знаходить першу tasks-директорію, ідучи вгору від cwd.
pub fn find_tasks_dir() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut dir: &Path = &cwd;
    let mut depth = 0u8;
    loop {
        let mt_config = dir.join(".mt.json");
        if mt_config.exists() {
            if let Ok(content) = fs::read_to_string(&mt_config) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(td) = v.get("mt_dir").and_then(|v| v.as_str()) {
                        let full = dir.join(td);
                        if full.is_dir() {
                            return Ok(full.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        let config_path = dir.join(".n-cursor.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(td) = v.get("tasks_dir").and_then(|v| v.as_str()) {
                        let full = dir.join(td);
                        if full.is_dir() {
                            return Ok(full.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        for dirname in &["mt", "tasks"] {
            let candidate = dir.join(dirname);
            if candidate.is_dir() && has_task_nodes(&candidate) {
                return Ok(candidate.to_string_lossy().into_owned());
            }
        }
        depth += 1;
        if depth >= 8 { break; }
        match dir.parent() {
            Some(p) => dir = p,
            None => break,
        }
    }
    Err("Could not auto-detect tasks directory.".to_string())
}

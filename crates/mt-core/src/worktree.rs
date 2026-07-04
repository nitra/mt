//! Іменування та матчінг worktree для задач (порт чистої частини
//! `npm/lib/core/worktree.mjs`). Git-операції лишаються на боці викликача.

use crate::sanitize;

/// Префікс worktree для задачі: `sanitize(task_path.replace('/', '-'))`.
fn worktree_prefix(task_path: &str) -> String {
    sanitize(&task_path.replace('/', "-"))
}

/// Ім'я worktree для задачі: `<sanitized-path>-<epoch-сек>`.
pub fn make_worktree_name(task_path: &str, epoch_sec: u64) -> String {
    format!("{}-{epoch_sec}", worktree_prefix(task_path))
}

/// Знаходить перший запис із `entries`, що належить задачі:
/// точний збіг із префіксом або `<prefix>-...`.
pub fn find_worktree_match(entries: &[String], task_path: &str) -> Option<String> {
    let prefix = worktree_prefix(task_path);
    let dashed = format!("{prefix}-");
    entries
        .iter()
        .find(|name| name.starts_with(&dashed) || **name == prefix)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_name_sanitizes_and_appends_epoch() {
        assert_eq!(
            make_worktree_name("research/collect data", 1234567890),
            "research-collect-data-1234567890"
        );
        assert_eq!(make_worktree_name("my-task_01", 5), "my-task_01-5");
    }

    #[test]
    fn find_match_prefers_first_entry() {
        let entries = vec![
            "other-task-1".to_string(),
            "my-task-100".to_string(),
            "my-task-200".to_string(),
        ];
        assert_eq!(
            find_worktree_match(&entries, "my-task"),
            Some("my-task-100".to_string())
        );
    }

    #[test]
    fn find_match_exact_or_dashed_only() {
        let entries = vec!["my-task".to_string(), "my-taskish-1".to_string()];
        assert_eq!(
            find_worktree_match(&entries, "my-task"),
            Some("my-task".to_string())
        );
        assert_eq!(
            find_worktree_match(&["my-taskish-1".to_string()], "my-task"),
            None
        );
    }
}

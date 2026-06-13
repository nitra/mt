use std::path::PathBuf;
use std::process;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  mt-scanner scan <tasks_dir> [--worktrees a,b,c]  — scan tasks, output JSON array");
    eprintln!("      --worktrees: comma-list of active worktree names (overrides git discovery)");
    eprintln!("  mt-scanner workspaces [<dir>]                    — discover workspaces, output JSON array");
    process::exit(1);
}

/// Parses an optional `--worktrees a,b,c` flag. Returns None if the flag is absent,
/// Some(vec) (possibly empty) when present.
fn parse_worktrees_arg(args: &[String]) -> Option<Vec<String>> {
    let pos = args.iter().position(|a| a == "--worktrees")?;
    let raw = args.get(pos + 1).map(String::as_str).unwrap_or("");
    Some(
        raw.split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 { usage(); }

    match args[1].as_str() {
        "scan" => {
            if args.len() < 3 { usage(); }
            let tasks_dir = args[2].clone();
            // --worktrees overrides discovery; otherwise discover via git from tasks_dir.
            let worktrees = parse_worktrees_arg(&args)
                .unwrap_or_else(|| mt_scanner::discover_worktrees(&PathBuf::from(&tasks_dir)));
            match mt_scanner::scan_tasks(tasks_dir, worktrees) {
                Ok(nodes) => println!("{}", serde_json::to_string_pretty(&nodes).unwrap()),
                Err(e) => { eprintln!("Error: {e}"); process::exit(2); }
            }
        }
        "workspaces" => {
            let workspaces = if args.len() >= 3 {
                let dir = PathBuf::from(&args[2]);
                mt_scanner::find_all_tasks_dirs_from(&dir)
            } else {
                match mt_scanner::find_all_tasks_dirs() {
                    Ok(ws) => ws,
                    Err(e) => { eprintln!("Error: {e}"); process::exit(2); }
                }
            };
            println!("{}", serde_json::to_string_pretty(&workspaces).unwrap());
        }
        _ => usage(),
    }
}

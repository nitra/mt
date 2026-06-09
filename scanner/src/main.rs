use std::path::PathBuf;
use std::process;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  mt-scanner scan <tasks_dir>      — scan tasks in directory, output JSON array");
    eprintln!("  mt-scanner workspaces [<dir>]    — discover workspaces from dir (or cwd), output JSON array");
    process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 { usage(); }

    match args[1].as_str() {
        "scan" => {
            if args.len() < 3 { usage(); }
            let tasks_dir = args[2].clone();
            match mt_scanner::scan_tasks(tasks_dir) {
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

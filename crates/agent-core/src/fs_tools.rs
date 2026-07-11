//! Файлові тули агента, пісковані до workspace-кореня (worktree run-а).
//!
//! Sandbox-межа (спека surfaces.md: ефективний набір тулів обмежено стелею
//! вузла): шляхи — ЛИШЕ відносні від кореня; абсолютний шлях чи `..` —
//! явна відмова, не тихий clamp. Схеми аргументів — derive через schemars
//! (stack.md: «Tool-схеми — derive, не руками»). Bash-тул свідомо поза цим
//! модулем — потребує sandbox-політики `skill_profiles` (окрема задача).

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::tools::{Tool, ToolError, ToolOutput, ToolRegistry};

/// Резолвить відносний шлях у межах root; `..`, абсолютні шляхи та
/// prefix-компоненти відхиляються.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, ToolError> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(ToolError {
            message: format!("шлях мусить бути відносним від кореня workspace: {relative}"),
        });
    }
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => {
                return Err(ToolError {
                    message: format!("шлях виходить за межі workspace: {relative}"),
                })
            }
        }
    }
    Ok(root.join(path))
}

#[derive(Debug, Deserialize, JsonSchema)]
struct ReadFileArgs {
    /// Відносний шлях файлу від кореня workspace.
    path: String,
}

/// `read_file` — вміст текстового файлу workspace.
struct ReadFileTool {
    root: Arc<PathBuf>,
}

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Прочитати текстовий файл workspace (відносний шлях)"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::to_value(schemars::schema_for!(ReadFileArgs)).unwrap()
    }

    async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
        let args: ReadFileArgs = parse_args(args)?;
        let path = resolve(&self.root, &args.path)?;
        let content = std::fs::read_to_string(&path).map_err(|error| ToolError {
            message: format!("read {}: {error}", args.path),
        })?;
        Ok(ToolOutput::success(
            format!("read {} ({} байт)", args.path, content.len()),
            Value::String(content),
        ))
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
struct WriteFileArgs {
    /// Відносний шлях файлу від кореня workspace.
    path: String,
    /// Повний новий вміст файлу.
    content: String,
}

/// `write_file` — створити/перезаписати файл workspace.
struct WriteFileTool {
    root: Arc<PathBuf>,
}

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Створити або перезаписати файл workspace (відносний шлях, повний вміст)"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::to_value(schemars::schema_for!(WriteFileArgs)).unwrap()
    }

    async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
        let args: WriteFileArgs = parse_args(args)?;
        let path = resolve(&self.root, &args.path)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| ToolError {
                message: format!("mkdir для {}: {error}", args.path),
            })?;
        }
        std::fs::write(&path, &args.content).map_err(|error| ToolError {
            message: format!("write {}: {error}", args.path),
        })?;
        Ok(ToolOutput::success(
            format!("write {} ({} байт)", args.path, args.content.len()),
            Value::Null,
        ))
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
struct ListFilesArgs {
    /// Відносний шлях директорії від кореня workspace; порожній — корінь.
    #[serde(default)]
    path: Option<String>,
}

/// `list_files` — вміст директорії workspace (не рекурсивно; `/` — дирекtorії).
struct ListFilesTool {
    root: Arc<PathBuf>,
}

#[async_trait]
impl Tool for ListFilesTool {
    fn name(&self) -> &str {
        "list_files"
    }

    fn description(&self) -> &str {
        "Список файлів директорії workspace (не рекурсивно; директорії з «/»)"
    }

    fn parameters_schema(&self) -> Value {
        serde_json::to_value(schemars::schema_for!(ListFilesArgs)).unwrap()
    }

    async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
        let args: ListFilesArgs = parse_args(args)?;
        let relative = args.path.unwrap_or_default();
        let path = resolve(&self.root, &relative)?;
        let mut names: Vec<String> = std::fs::read_dir(&path)
            .map_err(|error| ToolError {
                message: format!("list {relative}: {error}"),
            })?
            .flatten()
            .map(|entry| {
                let mut name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    name.push('/');
                }
                name
            })
            .collect();
        names.sort();
        Ok(ToolOutput::success(
            format!("list {relative}: {} записів", names.len()),
            serde_json::to_value(names).unwrap(),
        ))
    }
}

fn parse_args<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, ToolError> {
    serde_json::from_value(args).map_err(|error| ToolError {
        message: error.to_string(),
    })
}

/// Реєструє файлові тули, пісковані до `root` (worktree run-а).
pub fn register_workspace_tools(registry: &mut ToolRegistry, root: PathBuf) {
    let root = Arc::new(root);
    registry.register(Arc::new(ReadFileTool {
        root: Arc::clone(&root),
    }));
    registry.register(Arc::new(WriteFileTool {
        root: Arc::clone(&root),
    }));
    registry.register(Arc::new(ListFilesTool { root }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(root: &Path) -> ToolRegistry {
        let mut registry = ToolRegistry::new();
        register_workspace_tools(&mut registry, root.to_path_buf());
        registry
    }

    /// write → read → list: базовий цикл у межах workspace.
    #[tokio::test]
    async fn write_read_list_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry(dir.path());

        let write = registry.get("write_file").unwrap();
        write
            .invoke(serde_json::json!({ "path": "sub/note.md", "content": "текст" }))
            .await
            .unwrap();

        let read = registry.get("read_file").unwrap();
        let output = read
            .invoke(serde_json::json!({ "path": "sub/note.md" }))
            .await
            .unwrap();
        assert_eq!(output.content, Value::String("текст".into()));

        let list = registry.get("list_files").unwrap();
        let output = list
            .invoke(serde_json::json!({ "path": "sub" }))
            .await
            .unwrap();
        assert_eq!(output.content, serde_json::json!(["note.md"]));
        let output = list.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(output.content, serde_json::json!(["sub/"]));
    }

    /// Sandbox-межа: `..` і абсолютний шлях — явна відмова для кожного тула.
    #[tokio::test]
    async fn escape_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry(dir.path());
        for (tool, args) in [
            ("read_file", serde_json::json!({ "path": "../secret" })),
            ("read_file", serde_json::json!({ "path": "/etc/passwd" })),
            (
                "write_file",
                serde_json::json!({ "path": "a/../../x", "content": "" }),
            ),
            ("list_files", serde_json::json!({ "path": ".." })),
        ] {
            let error = registry.get(tool).unwrap().invoke(args).await.unwrap_err();
            assert!(
                error.message.contains("workspace"),
                "{tool}: {}",
                error.message
            );
        }
    }
}

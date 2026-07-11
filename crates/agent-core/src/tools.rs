//! Tools: trait, реєстр, schemars-схеми.
//!
//! JSON-схема параметрів — derive через `schemars` (stack.md: «Tool-схеми —
//! derive, не руками»). Зовнішні тули (MCP) підключаються через
//! `register_external(...)` — власну реалізацію MCP не пишемо (stack.md);
//! транспорт постачатиме окремий шар:
//! // use rmcp; — закоментований намір, вмикається із задачею MCP-інтеграції.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::provider::ToolSpec;

/// Результат виконання tool-а — мапиться на подію `ToolResult { ok, summary }`.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutput {
    pub ok: bool,
    /// Людський підсумок для стрічки подій; повний вміст — у `content`.
    pub summary: String,
    pub content: Value,
}

impl ToolOutput {
    pub fn success(summary: impl Into<String>, content: Value) -> Self {
        Self {
            ok: true,
            summary: summary.into(),
            content,
        }
    }

    pub fn failure(summary: impl Into<String>) -> Self {
        Self {
            ok: false,
            summary: summary.into(),
            content: Value::Null,
        }
    }
}

/// Помилка виконання tool-а (аргументи не за схемою, внутрішній збій).
#[derive(Debug, Clone, PartialEq)]
pub struct ToolError {
    pub message: String,
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "tool error: {}", self.message)
    }
}

impl std::error::Error for ToolError {}

/// Внутрішній tool агента. Схему параметрів реалізації беруть derive-ом:
/// `schemars::schema_for!(Args)`.
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    /// JSON Schema аргументів (derive через schemars, не руками).
    fn parameters_schema(&self) -> Value;
    async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError>;
}

/// Реєстр tools: ефективний набір ходу — перетин профілю поверхні та
/// sandbox-стелі вузла (surfaces.md) — формує викликач, реєстр лише зберігає.
#[derive(Default)]
pub struct ToolRegistry {
    tools: BTreeMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    /// Заділ для зовнішніх MCP-тулів: зовнішній сервер уже описує name/
    /// description/schema — реєструємо як звичайний tool. Транспорт (rmcp)
    /// — окрема задача; тут лише точка підключення.
    pub fn register_external(&mut self, tool: Arc<dyn Tool>) {
        self.register(tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn Tool>> {
        self.tools.get(name)
    }

    /// Специфікації для провайдера (детермінований порядок — BTreeMap).
    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools
            .values()
            .map(|tool| ToolSpec {
                name: tool.name().to_string(),
                description: tool.description().to_string(),
                parameters: tool.parameters_schema(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use schemars::JsonSchema;
    use serde::Deserialize;

    use super::*;

    /// Тестовий tool: схема параметрів — derive, не руками.
    #[derive(Debug, Deserialize, JsonSchema)]
    struct EchoArgs {
        /// Текст, який слід повернути.
        text: String,
    }

    struct EchoTool;

    #[async_trait]
    impl Tool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }

        fn description(&self) -> &str {
            "Повертає переданий текст"
        }

        fn parameters_schema(&self) -> Value {
            serde_json::to_value(schemars::schema_for!(EchoArgs)).unwrap()
        }

        async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
            let args: EchoArgs = serde_json::from_value(args).map_err(|error| ToolError {
                message: error.to_string(),
            })?;
            Ok(ToolOutput::success("echo ok", Value::String(args.text)))
        }
    }

    #[test]
    fn derived_schema_lists_required_text_property() {
        let schema = EchoTool.parameters_schema();
        assert!(schema["properties"]["text"].is_object(), "{schema}");
        assert_eq!(schema["required"], serde_json::json!(["text"]));
    }

    #[test]
    fn registry_returns_specs_with_derived_schema() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(EchoTool));
        let specs = registry.specs();
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "echo");
        assert!(specs[0].parameters["properties"]["text"].is_object());
    }

    #[tokio::test]
    async fn invoke_validates_args_via_schema_types() {
        let error = EchoTool
            .invoke(serde_json::json!({ "text": 5 }))
            .await
            .unwrap_err();
        assert!(error.message.contains("expected a string"), "{error}");
        let output = EchoTool
            .invoke(serde_json::json!({ "text": "hi" }))
            .await
            .unwrap();
        assert_eq!(output.content, Value::String("hi".into()));
    }
}

//! Approval-гейт для тулів (спека access.md, «Mid-run tool approval»):
//! деструктивний ToolCall виконується лише після вердикту approver-а.
//!
//! `GatedTool` — декоратор `Tool`: перед `invoke` викликає асинхронний
//! requester (його постачає хост — emit `ApprovalRequest` у кімнату +
//! очікування верифікованого вердикту з таймаутом). Deny/timeout →
//! `ToolOutput::failure` БЕЗ виклику внутрішнього тула — агент бачить
//! причину в історії і адаптується, хід не падає.

use std::sync::Arc;

use async_trait::async_trait;
use futures::future::BoxFuture;
use serde_json::Value;

use crate::tools::{Tool, ToolError, ToolOutput, ToolRegistry};

/// Асинхронний запит вердикту: `(action, diff) → approved`.
/// Хост відповідає за таймаут (false після спливу).
pub type ApprovalRequester =
    Arc<dyn Fn(String, Option<String>) -> BoxFuture<'static, bool> + Send + Sync>;

/// Декоратор тула з approval-гейтом.
struct GatedTool {
    inner: Arc<dyn Tool>,
    requester: ApprovalRequester,
}

#[async_trait]
impl Tool for GatedTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters_schema(&self) -> Value {
        self.inner.parameters_schema()
    }

    async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
        let action = format!("{} {args}", self.inner.name());
        if !(self.requester)(action, None).await {
            return Ok(ToolOutput::failure(format!(
                "{}: відхилено approver-ом (або таймаут approval)",
                self.inner.name()
            )));
        }
        self.inner.invoke(args).await
    }
}

/// Обгортає тули реєстру з переліку `names` approval-гейтом (політика
/// деструктивних тулів; відсутні в реєстрі імена ігноруються).
pub fn gate_tools(registry: &mut ToolRegistry, names: &[&str], requester: ApprovalRequester) {
    for name in names {
        if let Some(inner) = registry.get(name).cloned() {
            registry.register(Arc::new(GatedTool {
                inner,
                requester: Arc::clone(&requester),
            }));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;

    /// Тестовий tool із прапором «викликано».
    struct MarkerTool {
        invoked: Arc<AtomicBool>,
    }

    #[async_trait]
    impl Tool for MarkerTool {
        fn name(&self) -> &str {
            "marker"
        }

        fn description(&self) -> &str {
            "позначає виклик"
        }

        fn parameters_schema(&self) -> Value {
            serde_json::json!({ "type": "object" })
        }

        async fn invoke(&self, _args: Value) -> Result<ToolOutput, ToolError> {
            self.invoked.store(true, Ordering::Relaxed);
            Ok(ToolOutput::success("виконано", Value::Null))
        }
    }

    fn gated(verdict: bool) -> (ToolRegistry, Arc<AtomicBool>) {
        let invoked = Arc::new(AtomicBool::new(false));
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(MarkerTool {
            invoked: Arc::clone(&invoked),
        }));
        let requester: ApprovalRequester =
            Arc::new(move |_action, _diff| Box::pin(async move { verdict }));
        gate_tools(&mut registry, &["marker"], requester);
        (registry, invoked)
    }

    /// Approve → внутрішній tool виконується.
    #[tokio::test]
    async fn approved_tool_executes() {
        let (registry, invoked) = gated(true);
        let output = registry
            .get("marker")
            .unwrap()
            .invoke(Value::Null)
            .await
            .unwrap();
        assert!(output.ok);
        assert!(invoked.load(Ordering::Relaxed));
    }

    /// Deny → failure для агента, внутрішній tool НЕ викликаний.
    #[tokio::test]
    async fn denied_tool_is_not_executed() {
        let (registry, invoked) = gated(false);
        let output = registry
            .get("marker")
            .unwrap()
            .invoke(Value::Null)
            .await
            .unwrap();
        assert!(!output.ok);
        assert!(output.summary.contains("відхилено"), "{}", output.summary);
        assert!(!invoked.load(Ordering::Relaxed));
    }
}

//! Мінімальний ACP-клієнт (Agent Client Protocol v1) — єдиний транспорт
//! AI-викликів (ADR `260713-2110`): JSON-RPC 2.0 поверх ndjson-стріму
//! (звичайно stdio дочірнього процесу ACP-адаптера підписочного CLI).
//!
//! Покрита підмножина, потрібна runner-у інтерактивних сесій:
//! `initialize` → `session/new` → `session/prompt`; нотифікації
//! `session/update` мапляться на `Event` agent-protocol
//! (`AgentTextDelta`/`ToolCall`/`ToolResult`); запит агента
//! `session/request_permission` іде у [`PermissionHandler`] — хост мапить
//! його на `ApprovalRequest` (Ed25519). Клієнт generic над потоками:
//! продакшн — stdio child-процесу, тести — `tokio::io::duplex`.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_protocol::Event;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines};

/// Помилка ACP-транспорту/протоколу.
#[derive(Debug)]
pub struct AcpError(pub String);

impl fmt::Display for AcpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AcpError {}

/// Обробник `session/request_permission`: `(action, diff) → approved`.
/// Хост підключає сюди approval-гейт (`ApprovalRequest` + підпис пристрою).
pub type PermissionHandler =
    Arc<dyn Fn(String, Option<String>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// ACP-клієнт однієї агент-сесії поверх пари потоків.
pub struct AcpClient<R, W> {
    lines: Lines<BufReader<R>>,
    writer: W,
    next_id: u64,
    permission: Option<PermissionHandler>,
}

impl<R, W> AcpClient<R, W>
where
    R: AsyncRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
{
    pub fn new(reader: R, writer: W, permission: Option<PermissionHandler>) -> Self {
        Self {
            lines: BufReader::new(reader).lines(),
            writer,
            next_id: 0,
            permission,
        }
    }

    /// `initialize`: хендшейк версії протоколу (v1). ФС-можливостей клієнт
    /// не заявляє — файли виконавець править сам у `cwd` сесії.
    pub async fn initialize(&mut self) -> Result<(), AcpError> {
        let params = json!({
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } }
        });
        self.call("initialize", params, &|_| {}).await.map(|_| ())
    }

    /// `session/new` у робочій директорії (worktree run-а) → sessionId.
    pub async fn new_session(&mut self, cwd: &str) -> Result<String, AcpError> {
        let params = json!({ "cwd": cwd, "mcpServers": [] });
        let result = self.call("session/new", params, &|_| {}).await?;
        result["sessionId"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AcpError("session/new без sessionId".into()))
    }

    /// `session/prompt`: один хід. Події ходу емітяться через `emit`;
    /// завершення → `AgentTextDone` + stopReason.
    pub async fn prompt(
        &mut self,
        session_id: &str,
        text: &str,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AcpError> {
        let params = json!({
            "sessionId": session_id,
            "prompt": [ { "type": "text", "text": text } ]
        });
        let result = self.call("session/prompt", params, emit).await?;
        emit(Event::AgentTextDone {});
        Ok(result["stopReason"]
            .as_str()
            .unwrap_or("end_turn")
            .to_string())
    }

    /// Викликає метод і читає стрічку до відповіді на свій id, обробляючи
    /// дорогою нотифікації (`session/update` → Event) і зустрічні запити
    /// агента (`session/request_permission` → PermissionHandler).
    async fn call(
        &mut self,
        method: &str,
        params: Value,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<Value, AcpError> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;

        loop {
            let line = self
                .lines
                .next_line()
                .await
                .map_err(|e| AcpError(format!("читання ACP-стріму: {e}")))?
                .ok_or_else(|| AcpError("ACP-агент закрив стрім".into()))?;
            if line.trim().is_empty() {
                continue;
            }
            let message: Value = serde_json::from_str(&line)
                .map_err(|e| AcpError(format!("не-JSON кадр ACP: {e}")))?;

            if message["method"].is_string() {
                if message["id"].is_null() {
                    self.handle_notification(&message, emit);
                } else {
                    self.handle_agent_request(&message).await?;
                }
                continue;
            }
            if message["id"] == json!(id) {
                if let Some(error) = message.get("error").filter(|e| !e.is_null()) {
                    return Err(AcpError(format!("{method}: {error}")));
                }
                return Ok(message["result"].clone());
            }
        }
    }

    /// `session/update` → Event: agent_message_chunk → AgentTextDelta;
    /// tool_call → ToolCall; tool_call_update (термінальний статус) →
    /// ToolResult. Невідомі варіанти ігноруються (forward-compat).
    fn handle_notification(&self, message: &Value, emit: &(dyn Fn(Event) + Send + Sync)) {
        if message["method"] != "session/update" {
            return;
        }
        let update = &message["params"]["update"];
        match update["sessionUpdate"].as_str() {
            Some("agent_message_chunk") => {
                if let Some(text) = update["content"]["text"].as_str() {
                    emit(Event::AgentTextDelta {
                        text: text.to_string(),
                    });
                }
            }
            Some("tool_call") => emit(Event::ToolCall {
                call_id: update["toolCallId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                name: update["title"]
                    .as_str()
                    .or(update["kind"].as_str())
                    .unwrap_or("tool")
                    .to_string(),
                args: update["rawInput"].clone(),
            }),
            Some("tool_call_update") => {
                let status = update["status"].as_str().unwrap_or_default();
                if status == "completed" || status == "failed" {
                    emit(Event::ToolResult {
                        call_id: update["toolCallId"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        ok: status == "completed",
                        summary: update["title"].as_str().unwrap_or(status).to_string(),
                    });
                }
            }
            _ => {}
        }
    }

    /// Зустрічний запит агента. `session/request_permission` → handler
    /// (без handler-а — відмова); вибирається перший option відповідного
    /// kind (`allow*`/`reject*`). Інші методи → JSON-RPC method not found.
    async fn handle_agent_request(&mut self, message: &Value) -> Result<(), AcpError> {
        let id = message["id"].clone();
        if message["method"] != "session/request_permission" {
            return self
                .send(&json!({
                    "jsonrpc": "2.0", "id": id,
                    "error": { "code": -32601, "message": "method not found" }
                }))
                .await;
        }
        let params = &message["params"];
        let action = params["toolCall"]["title"]
            .as_str()
            .or(params["toolCall"]["kind"].as_str())
            .unwrap_or("tool")
            .to_string();
        let diff = params["toolCall"]["content"].as_str().map(str::to_string);
        let approved = match &self.permission {
            Some(handler) => handler(action, diff).await,
            None => false,
        };
        let wanted = if approved { "allow" } else { "reject" };
        let option_id = params["options"]
            .as_array()
            .and_then(|options| {
                options
                    .iter()
                    .find(|o| o["kind"].as_str().unwrap_or_default().starts_with(wanted))
            })
            .and_then(|o| o["optionId"].as_str())
            .unwrap_or(wanted)
            .to_string();
        self.send(&json!({
            "jsonrpc": "2.0", "id": id,
            "result": { "outcome": { "outcome": "selected", "optionId": option_id } }
        }))
        .await
    }

    async fn send(&mut self, message: &Value) -> Result<(), AcpError> {
        let mut frame = message.to_string();
        frame.push('\n');
        self.writer
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| AcpError(format!("запис ACP-стріму: {e}")))?;
        self.writer
            .flush()
            .await
            .map_err(|e| AcpError(format!("flush ACP-стріму: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// Фейковий ACP-агент на другому кінці duplex: скриптує initialize,
    /// session/new і session/prompt (чанки + tool call + відповідь).
    async fn fake_agent(stream: tokio::io::DuplexStream, request_permission: bool) {
        let (read, mut write) = tokio::io::split(stream);
        let mut lines = BufReader::new(read).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let message: Value = serde_json::from_str(&line).unwrap();
            let id = message["id"].clone();
            match message["method"].as_str() {
                Some("initialize") => {
                    respond(
                        &mut write,
                        &json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": 1 } }),
                    )
                    .await;
                }
                Some("session/new") => {
                    respond(
                        &mut write,
                        &json!({ "jsonrpc": "2.0", "id": id, "result": { "sessionId": "s1" } }),
                    )
                    .await;
                }
                Some("session/prompt") => {
                    for text in ["при", "віт"] {
                        respond(
                            &mut write,
                            &json!({
                                "jsonrpc": "2.0", "method": "session/update",
                                "params": { "sessionId": "s1", "update": {
                                    "sessionUpdate": "agent_message_chunk",
                                    "content": { "type": "text", "text": text } } }
                            }),
                        )
                        .await;
                    }
                    if request_permission {
                        respond(
                            &mut write,
                            &json!({
                                "jsonrpc": "2.0", "id": 777, "method": "session/request_permission",
                                "params": { "sessionId": "s1",
                                    "toolCall": { "title": "write_file", "kind": "edit" },
                                    "options": [
                                        { "optionId": "ok", "kind": "allow_once" },
                                        { "optionId": "no", "kind": "reject_once" } ] }
                            }),
                        )
                        .await;
                        // Відповідь клієнта на permission приходить наступним кадром.
                        let reply = lines.next_line().await.unwrap().unwrap();
                        let reply: Value = serde_json::from_str(&reply).unwrap();
                        let picked = reply["result"]["outcome"]["optionId"].clone();
                        respond(
                            &mut write,
                            &json!({
                                "jsonrpc": "2.0", "method": "session/update",
                                "params": { "sessionId": "s1", "update": {
                                    "sessionUpdate": "tool_call_update", "toolCallId": "c1",
                                    "status": if picked == "ok" { "completed" } else { "failed" },
                                    "title": "write_file" } }
                            }),
                        )
                        .await;
                    }
                    respond(&mut write, &json!({ "jsonrpc": "2.0", "id": id, "result": { "stopReason": "end_turn" } })).await;
                }
                _ => {}
            }
        }
    }

    async fn respond(write: &mut (impl AsyncWrite + Unpin), message: &Value) {
        let mut frame = message.to_string();
        frame.push('\n');
        write.write_all(frame.as_bytes()).await.unwrap();
        write.flush().await.unwrap();
    }

    fn client_for(
        stream: tokio::io::DuplexStream,
        permission: Option<PermissionHandler>,
    ) -> AcpClient<
        tokio::io::ReadHalf<tokio::io::DuplexStream>,
        tokio::io::WriteHalf<tokio::io::DuplexStream>,
    > {
        let (read, write) = tokio::io::split(stream);
        AcpClient::new(read, write, permission)
    }

    /// Повний хід: initialize → session/new → prompt; чанки стають
    /// AgentTextDelta, завершення — AgentTextDone.
    #[tokio::test]
    async fn prompt_maps_updates_to_events() {
        let (local, remote) = tokio::io::duplex(64 * 1024);
        tokio::spawn(fake_agent(remote, false));
        let mut client = client_for(local, None);

        client.initialize().await.unwrap();
        let session = client.new_session("/tmp").await.unwrap();
        assert_eq!(session, "s1");

        let events = Mutex::new(Vec::new());
        let emit = |event: Event| events.lock().unwrap().push(event);
        let stop = client.prompt(&session, "звук", &emit).await.unwrap();

        assert_eq!(stop, "end_turn");
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                Event::AgentTextDelta {
                    text: "при".into()
                },
                Event::AgentTextDelta {
                    text: "віт".into()
                },
                Event::AgentTextDone {},
            ]
        );
    }

    /// request_permission: approve → агент отримує allow-option і шле
    /// completed; deny → reject-option і failed.
    #[tokio::test]
    async fn permission_request_routes_through_handler() {
        for (approve, expect_ok) in [(true, true), (false, false)] {
            let (local, remote) = tokio::io::duplex(64 * 1024);
            tokio::spawn(fake_agent(remote, true));
            let handler: PermissionHandler =
                Arc::new(move |_action, _diff| Box::pin(async move { approve }));
            let mut client = client_for(local, Some(handler));

            client.initialize().await.unwrap();
            let session = client.new_session("/tmp").await.unwrap();
            let events = Mutex::new(Vec::new());
            let emit = |event: Event| events.lock().unwrap().push(event);
            client.prompt(&session, "запиши", &emit).await.unwrap();

            let events = events.lock().unwrap();
            assert!(
                events.iter().any(|e| matches!(
                    e,
                    Event::ToolResult { ok, .. } if *ok == expect_ok
                )),
                "{events:?}"
            );
        }
    }
}

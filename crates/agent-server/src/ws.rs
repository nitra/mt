//! WS-транспорт: хендшейк v4, стрічка подій, capability-фільтр
//! (спека runtime.md, «Протокол подій» / «Хендшейк» / backpressure).
//!
//! Кадри — JSON: перший від клієнта `ClientHello` (несумісна версія чи
//! невірний токен → `Event::Error` + закриття), відповідь `ServerHello`,
//! далі від клієнта — `Envelope` (host ігнорує клієнтські seq/ts і
//! призначає власні), від хоста — `Envelope` стрічки. Повільний клієнт,
//! що випав із broadcast-буфера, повертається реплеєм за `want_replay_from`.

use std::io;
use std::net::SocketAddr;
use std::sync::Arc;

use agent_protocol::{ClientHello, Envelope, Event, ServerHello, PROTOCOL_VERSION};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Serialize;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::runner::TurnRunner;
use crate::session::SessionHost;

/// Стан сервера: сесії + виконавець ходів + очікуваний токен discovery.
pub struct AppState {
    pub sessions: SessionHost,
    pub runner: Arc<dyn TurnRunner>,
    /// `None` — без перевірки (embedded/in-process клієнт).
    pub token: Option<String>,
}

/// Маршрути хоста: єдина точка `/ws`.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state)
}

/// Біндить адресу (порт 0 → ефемерний) і запускає сервер у фоні.
pub async fn serve(
    state: Arc<AppState>,
    addr: SocketAddr,
) -> io::Result<(SocketAddr, JoinHandle<()>)> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    let app = router(state);
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((local_addr, handle))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| client_connection(socket, state))
}

async fn send_json<T: Serialize>(socket: &mut WebSocket, value: &T) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(serde_json::to_string(value).unwrap().into()))
        .await
}

/// Відмова на хендшейку: `Event::Error` + коректний Close-кадр.
async fn reject(socket: &mut WebSocket, message: String) {
    let _ = send_json(socket, &Event::Error { message }).await;
    let _ = socket.send(Message::Close(None)).await;
}

/// Чи можна доставити подію клієнту з такими capabilities
/// (`PreviewScreenshot` — лише клієнтам із «preview»).
fn allowed(event: &Event, capabilities: &[String]) -> bool {
    match event {
        Event::PreviewScreenshot { .. } => capabilities.iter().any(|c| c == "preview"),
        _ => true,
    }
}

async fn client_connection(mut socket: WebSocket, state: Arc<AppState>) {
    // Хендшейк: перший текстовий кадр мусить бути ClientHello.
    let hello: ClientHello = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str(text.as_str()) {
                Ok(hello) => break hello,
                Err(error) => {
                    reject(&mut socket, format!("invalid ClientHello: {error}")).await;
                    return;
                }
            },
            Some(Ok(_)) => continue,
            _ => return,
        }
    };
    if let Some(expected) = &state.token {
        if &hello.device_token != expected {
            reject(&mut socket, "invalid device token".into()).await;
            return;
        }
    }
    if let Err(error) = hello.check_compatibility() {
        reject(&mut socket, error.to_string()).await;
        return;
    }

    // Підписка ДО реплею — щоб не загубити події між ними (дублікати
    // клієнт відсіює за seq).
    let mut updates = state.sessions.subscribe();

    if send_json(
        &mut socket,
        &ServerHello {
            protocol_version: PROTOCOL_VERSION,
            session_list: state.sessions.session_list(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    if let Some(from) = hello.want_replay_from {
        for envelope in state.sessions.replay_from(from) {
            if allowed(&envelope.event, &hello.client_capabilities)
                && send_json(&mut socket, &envelope).await.is_err()
            {
                return;
            }
        }
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    handle_client_frame(&state, text.as_str(), Some(hello.device_id)).await;
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            update = updates.recv() => match update {
                Ok(envelope) => {
                    if allowed(&envelope.event, &hello.client_capabilities)
                        && send_json(&mut socket, &envelope).await.is_err()
                    {
                        break;
                    }
                }
                // Випав із буфера — журнальовані події клієнт добере реплеєм.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
}

/// Кадр клієнта: Envelope з подією. `UserMessage` запускає хід агента;
/// невідомі/непідтримувані події ігноруються (forward-compatibility).
async fn handle_client_frame(state: &Arc<AppState>, frame: &str, device_id: Option<Uuid>) {
    let Ok(envelope) = serde_json::from_str::<Envelope>(frame) else {
        return;
    };
    let Event::UserMessage { text, .. } = envelope.event else {
        return;
    };
    let Ok(session) = state.sessions.get_or_open(&envelope.node_hash) else {
        return;
    };
    state.sessions.publish(
        &session,
        Event::UserMessage {
            text: text.clone(),
            attachments: vec![],
            surface: None,
        },
        device_id,
        envelope.account_id,
    );
    let sessions = &state.sessions;
    let emit = |event: Event| {
        sessions.publish(&session, event, None, None);
    };
    if let Err(error) = state
        .runner
        .run_turn(&envelope.node_hash, &text, &emit)
        .await
    {
        sessions.publish(
            &session,
            Event::Error {
                message: error.to_string(),
            },
            None,
            None,
        );
    }
}

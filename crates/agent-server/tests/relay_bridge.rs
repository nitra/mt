//! Міст agent-server ↔ relay проти mock-relay (tungstenite-сервер у тесті,
//! кадровий протокол relay): віддалений UserMessage → хід агента →
//! host-кадри доїжджають у relay; host-ехо назад — без зациклення.

use std::sync::Arc;

use agent_server::{spawn_relay_bridge, AppState, EchoTurnRunner, RelayBridgeConfig, SessionHost};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Mock-relay: одне зʼєднання; всі отримані кадри — у канал тесту,
/// кадри з каналу тесту — мосту.
async fn mock_relay() -> (String, mpsc::Receiver<Value>, mpsc::Sender<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (received_tx, received_rx) = mpsc::channel::<Value>(64);
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel::<Value>(64);

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        loop {
            tokio::select! {
                incoming = ws.next() => match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
                        let _ = received_tx.send(frame).await;
                    }
                    Some(Ok(_)) => {}
                    _ => break,
                },
                outgoing = outgoing_rx.recv() => match outgoing {
                    Some(frame) => {
                        if ws.send(Message::text(frame.to_string())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                },
            }
        }
    });

    (format!("ws://127.0.0.1:{port}"), received_rx, outgoing_tx)
}

/// Наступний кадр від моста з таймаутом.
async fn next_frame(rx: &mut mpsc::Receiver<Value>) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout очікування кадру від моста")
        .expect("канал закрито")
}

fn remote_user_message(text: &str) -> Value {
    json!({
        "kind": "envelope",
        "envelope": {
            "seq": 0,
            "ts": "2026-07-12T00:00:00Z",
            "node_hash": "demo",
            "run_token": "00000000-0000-0000-0000-000000000001",
            "device_id": "00000000-0000-0000-0000-00000000000a",
            "event": { "type": "UserMessage", "text": text, "attachments": [] }
        }
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn remote_user_message_runs_turn_and_streams_back() {
    let state_dir = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::new(
        SessionHost::new(state_dir.path().to_path_buf()).unwrap(),
        Arc::new(EchoTurnRunner),
        None,
    ));
    let (url, mut received, outgoing) = mock_relay().await;
    let _bridge = spawn_relay_bridge(
        Arc::clone(&state),
        RelayBridgeConfig {
            url,
            device_token: "host-token".into(),
            root: "demo".into(),
        },
    );

    // Хендшейк моста: hello з device_token → subscribe кімнати.
    let hello = next_frame(&mut received).await;
    assert_eq!(hello["kind"], "hello");
    assert_eq!(hello["device_token"], "host-token");
    let subscribe = next_frame(&mut received).await;
    assert_eq!(subscribe["kind"], "subscribe");
    assert_eq!(subscribe["root"], "demo");

    // Віддалений клієнт шле UserMessage через relay.
    outgoing.send(remote_user_message("привіт")).await.unwrap();

    // Міст ретранслює host-стрічку: echo UserMessage (seq призначив хост),
    // дельта відповіді агента, AgentTextDone.
    let user_echo = next_frame(&mut received).await;
    assert_eq!(user_echo["kind"], "envelope");
    assert_eq!(user_echo["envelope"]["event"]["type"], "UserMessage");
    assert_eq!(user_echo["envelope"]["seq"], 0);
    assert_eq!(
        user_echo["envelope"]["device_id"], "00000000-0000-0000-0000-00000000000a",
        "device_id віддаленого пристрою збережено"
    );
    let delta = next_frame(&mut received).await;
    assert_eq!(delta["envelope"]["event"]["type"], "AgentTextDelta");
    assert_eq!(delta["envelope"]["event"]["text"], "echo: привіт");
    let done = next_frame(&mut received).await;
    assert_eq!(done["envelope"]["event"]["type"], "AgentTextDone");

    // Анти-цикл: relay повертає host-ехо (from_host: true) — міст ігнорує;
    // у журналі сесії рівно один UserMessage.
    let mut echoed = user_echo.clone();
    echoed["from_host"] = json!(true);
    outgoing.send(echoed).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let session = state.sessions.get_or_open("demo").unwrap();
    let user_messages = session
        .replay_from(0)
        .iter()
        .filter(|envelope| matches!(envelope.event, agent_protocol::Event::UserMessage { .. }))
        .count();
    assert_eq!(user_messages, 1, "host-ехо не мусить оброблятись повторно");
}

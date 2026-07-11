//! Інтеграція WS-сесій із graph-мостом: attach на першому UserMessage,
//! журнал у run ref, DoneSession → fenced publish, ReleaseSession → пауза.
//! Все герметично: bare-репо як origin, MockProvider-агент, реальний WS.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use agent_core::provider::{Completion, MockProvider};
use agent_core::{Agent, ToolRegistry};
use agent_protocol::{ClientHello, Envelope, Event, ServerHello, PROTOCOL_VERSION};
use agent_server::{serve, AgentTurnRunner, AppState, GraphConfig, SessionHost};
use chrono::Utc;
use futures::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn sh(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "t@t.local")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "t@t.local")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn sh_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct Fixture {
    #[allow(dead_code)]
    origin: tempfile::TempDir,
    work: tempfile::TempDir,
    #[allow(dead_code)]
    state_dir: tempfile::TempDir,
    url: String,
}

impl Fixture {
    /// bare-origin + робочий клон із вузлом `mt/demo` + WS-сервер із
    /// graph-мостом і MockProvider-агентом (по одній відповіді на хід).
    async fn start(responses: Vec<&str>) -> Self {
        let origin = tempfile::tempdir().unwrap();
        sh(origin.path(), &["init", "--bare", "-q", "-b", "main"]);
        let work = tempfile::tempdir().unwrap();
        sh(work.path(), &["init", "-q", "-b", "main"]);
        std::fs::create_dir_all(work.path().join("mt/demo")).unwrap();
        std::fs::write(work.path().join("mt/demo/task.md"), "## Task\n").unwrap();
        sh(work.path(), &["add", "."]);
        sh(work.path(), &["commit", "-q", "-m", "init"]);
        sh(
            work.path(),
            &["remote", "add", "origin", origin.path().to_str().unwrap()],
        );
        sh(work.path(), &["push", "-q", "origin", "main"]);

        let responses: Vec<String> = responses.into_iter().map(String::from).collect();
        let runner = AgentTurnRunner::new(move || {
            Agent::new(
                MockProvider::scripted(responses.iter().map(|text| Completion {
                    text: text.clone(),
                    tool_calls: vec![],
                })),
                ToolRegistry::new(),
                "mock",
                "system",
            )
        });
        let state_dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            AppState::new(
                SessionHost::new(state_dir.path().to_path_buf()).unwrap(),
                Arc::new(runner),
                None,
            )
            .with_graph(GraphConfig::new(work.path().join("mt"))),
        );
        let (addr, _handle) = serve(state, "127.0.0.1:0".parse().unwrap()).await.unwrap();
        Self {
            origin,
            work,
            state_dir,
            url: format!("ws://{addr}/ws"),
        }
    }

    fn remote_refs(&self) -> String {
        sh_out(self.work.path(), &["ls-remote", "origin"])
    }
}

async fn connect(url: &str) -> WsStream {
    let hello = ClientHello {
        protocol_version: PROTOCOL_VERSION,
        device_id: Uuid::from_u128(7),
        device_token: String::new(),
        client_kind: "cli".into(),
        client_capabilities: vec![],
        lang: "uk".into(),
        want_replay_from: None,
    };
    let (mut stream, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    stream
        .send(Message::text(serde_json::to_string(&hello).unwrap()))
        .await
        .unwrap();
    let _: ServerHello = next_json(&mut stream).await;
    stream
}

async fn next_json<T: serde::de::DeserializeOwned>(stream: &mut WsStream) -> T {
    loop {
        let message = tokio::time::timeout(std::time::Duration::from_secs(10), stream.next())
            .await
            .expect("timeout очікування кадру")
            .expect("стрім закрито")
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

fn client_event(node: &str, event: Event) -> Message {
    let envelope = Envelope {
        seq: 0,
        ts: Utc::now(),
        node_hash: node.into(),
        run_token: Uuid::from_u128(1),
        device_id: None,
        account_id: None,
        event,
    };
    Message::text(serde_json::to_string(&envelope).unwrap())
}

fn user_message(node: &str, text: &str) -> Message {
    client_event(
        node,
        Event::UserMessage {
            text: text.into(),
            attachments: vec![],
            surface: None,
        },
    )
}

/// Повний M1-цикл: UserMessage → attach (claim ref) → хід → журнал у run
/// ref → DoneSession → fenced publish (main без .nitra/, refs прибрані).
#[tokio::test(flavor = "multi_thread")]
async fn user_message_attaches_and_done_publishes() {
    let fixture = Fixture::start(vec!["зроблено"]).await;
    let mut stream = connect(&fixture.url).await;

    stream.send(user_message("demo", "почни")).await.unwrap();
    let _user: Envelope = next_json(&mut stream).await;
    let _delta: Envelope = next_json(&mut stream).await;
    let done_event: Envelope = next_json(&mut stream).await;
    assert_eq!(done_event.event, Event::AgentTextDone {});

    // Attach відбувся: claim ref і run ref на remote, журнал у run ref.
    let refs = fixture.remote_refs();
    assert!(refs.contains("refs/mt/claims/"), "{refs}");
    assert!(refs.contains("refs/mt/runs/"), "{refs}");
    let run_ref = refs
        .lines()
        .find(|line| line.contains("refs/mt/runs/"))
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .to_string();
    let journal = sh_out(
        fixture.origin.path(),
        &["show", &format!("{run_ref}:.nitra/session.jsonl")],
    );
    assert!(
        journal.contains("почни"),
        "журнал сесії у run ref: {journal}"
    );

    // Done: publish у main, refs прибрані, .nitra/ не протік.
    stream
        .send(client_event("demo", Event::DoneSession {}))
        .await
        .unwrap();
    let committed: Envelope = next_json(&mut stream).await;
    assert!(
        matches!(committed.event, Event::Committed { ref message, .. } if message.contains("done")),
        "{committed:?}"
    );
    let refs = fixture.remote_refs();
    assert!(!refs.contains("refs/mt/claims/"), "{refs}");
    assert!(!refs.contains("refs/mt/runs/"), "{refs}");
    let main_files = sh_out(
        fixture.origin.path(),
        &["ls-tree", "-r", "--name-only", "main"],
    );
    assert!(!main_files.contains(".nitra"), "{main_files}");
}

/// ReleaseSession: пауза — claim знято (ClaimChanged без holder-а),
/// run ref лишається; вузол можна attach-нути знову.
#[tokio::test(flavor = "multi_thread")]
async fn release_frees_claim_and_keeps_journal() {
    let fixture = Fixture::start(vec!["перший", "після паузи"]).await;
    let mut stream = connect(&fixture.url).await;

    stream.send(user_message("demo", "почни")).await.unwrap();
    let _user: Envelope = next_json(&mut stream).await;
    let _delta: Envelope = next_json(&mut stream).await;
    let _done: Envelope = next_json(&mut stream).await;

    stream
        .send(client_event("demo", Event::ReleaseSession {}))
        .await
        .unwrap();
    let changed: Envelope = next_json(&mut stream).await;
    assert!(
        matches!(
            changed.event,
            Event::ClaimChanged {
                holder_device_id: None,
                ..
            }
        ),
        "{changed:?}"
    );
    let refs = fixture.remote_refs();
    assert!(!refs.contains("refs/mt/claims/"), "{refs}");
    assert!(refs.contains("refs/mt/runs/"), "журнал лишився: {refs}");

    // Повторний UserMessage — новий attach проходить (вузол вільний).
    stream.send(user_message("demo", "продовж")).await.unwrap();
    let _user: Envelope = next_json(&mut stream).await;
    let delta: Envelope = next_json(&mut stream).await;
    assert_eq!(
        delta.event,
        Event::AgentTextDelta {
            text: "після паузи".into()
        }
    );
    assert!(fixture.remote_refs().contains("refs/mt/claims/"));
}

/// Вузол, зайнятий іншим тримачем, → Error claim-lost; хід не виконується.
#[tokio::test(flavor = "multi_thread")]
async fn busy_node_yields_claim_lost_error() {
    let fixture = Fixture::start(vec!["не має статись"]).await;
    // Хтось інший уже тримає claim.
    let foreign =
        agent_server::graph::attach(&GraphConfig::new(fixture.work.path().join("mt")), "demo")
            .unwrap();

    let mut stream = connect(&fixture.url).await;
    stream.send(user_message("demo", "почни")).await.unwrap();
    let _user: Envelope = next_json(&mut stream).await;
    let error: Envelope = next_json(&mut stream).await;
    assert!(
        matches!(error.event, Event::Error { ref message } if message.contains("claim-lost")),
        "{error:?}"
    );
    drop(foreign);
}

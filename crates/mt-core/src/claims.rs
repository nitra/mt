//! Remote execution claims (спека mt.md, «Authoritative execution claim»).
//!
//! Ownership вузла живе у GitHub custom refs `refs/mt/claims/<node-hash>`;
//! claim ref вказує на commit із `.mt-claim.yml`. Модуль дає read-модель:
//! node-hash, читання remote claims через git CLI і зіставлення з вузлами.

use std::path::Path;
use std::process::Command;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::frontmatter::parse_yaml;

/// Префікс claim refs (дефолт `.mt.json` → `claim_ref_prefix`).
pub const CLAIM_REF_PREFIX: &str = "refs/mt/claims";

/// `node-hash` = перші 20 hex символів SHA-256 від `<tasks-root>\0<node-path>`.
/// `tasks_root` — канонічний шлях tasks-директорії відносно git root (напр.
/// `mt` або `packages/api/mt`), `node_path` — вузол відносно tasks root.
pub fn node_hash(tasks_root: &str, node_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(tasks_root.as_bytes());
    hasher.update([0u8]);
    hasher.update(node_path.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(20);
    for byte in digest.iter() {
        if hex.len() >= 20 {
            break;
        }
        hex.push_str(&format!("{byte:02x}"));
    }
    hex.truncate(20);
    hex
}

/// Один запис `git ls-remote origin 'refs/mt/claims/*'`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteClaimRef {
    pub node_hash: String,
    pub sha: String,
}

/// Парсить вивід `git ls-remote` (рядки `<sha>\t<ref>`), лишаючи claim refs.
pub fn parse_ls_remote(output: &str, prefix: &str) -> Vec<RemoteClaimRef> {
    let mut refs = Vec::new();
    for line in output.lines() {
        let Some((sha, name)) = line.split_once('\t') else {
            continue;
        };
        let Some(hash) = name.strip_prefix(prefix).and_then(|r| r.strip_prefix('/')) else {
            continue;
        };
        if !sha.is_empty() && !hash.is_empty() && !hash.contains('/') {
            refs.push(RemoteClaimRef {
                node_hash: hash.to_string(),
                sha: sha.to_string(),
            });
        }
    }
    refs
}

/// Розібраний `.mt-claim.yml` claim-коміта.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimInfo {
    pub node_hash: String,
    /// `node:` з claim-файлу (шлях відносно tasks root; інформативний).
    pub node: Option<String>,
    pub actor: Option<String>,
    pub runner_id: Option<String>,
    pub lease_until: Option<String>,
    /// Lease прострочений (з урахуванням grace) → derived-стан `stalled`.
    pub expired: bool,
}

fn yaml_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

/// Чи прострочений lease: `lease_until + grace_sec ≤ now`. Непарсибельний
/// або відсутній `lease_until` вважаємо простроченим (консервативно).
pub fn lease_expired(lease_until: Option<&str>, grace_sec: i64, now: DateTime<Utc>) -> bool {
    let Some(until) = lease_until.and_then(|s| DateTime::parse_from_rfc3339(s).ok()) else {
        return true;
    };
    until.with_timezone(&Utc) + chrono::Duration::seconds(grace_sec) <= now
}

/// Будує [`ClaimInfo`] з YAML-вмісту `.mt-claim.yml`.
pub fn parse_claim(node_hash: &str, yaml: &str, grace_sec: i64, now: DateTime<Utc>) -> ClaimInfo {
    let v = parse_yaml(yaml);
    let lease_until = yaml_str(&v, "lease_until");
    ClaimInfo {
        node_hash: node_hash.to_string(),
        node: yaml_str(&v, "node"),
        actor: yaml_str(&v, "actor"),
        runner_id: yaml_str(&v, "runner_id"),
        expired: lease_expired(lease_until.as_deref(), grace_sec, now),
        lease_until,
    }
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git {}: {e}", args.join(" ")))?;
    if !out.status.success() {
        return Err(format!(
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Читає remote claims: `ls-remote` → fetch claim refs → `.mt-claim.yml` з
/// кожного claim-коміта. `grace_sec` — буфер перед takeover (`claim_grace_sec`).
pub fn fetch_remote_claims(repo_root: &Path, grace_sec: i64) -> Result<Vec<ClaimInfo>, String> {
    let ls = git(
        repo_root,
        &["ls-remote", "origin", &format!("{CLAIM_REF_PREFIX}/*")],
    )?;
    let refs = parse_ls_remote(&ls, CLAIM_REF_PREFIX);
    if refs.is_empty() {
        return Ok(Vec::new());
    }
    // Custom refs не fetch-яться стандартним refspec — тягнемо явно (спека).
    git(
        repo_root,
        &[
            "fetch",
            "--quiet",
            "origin",
            &format!("+{CLAIM_REF_PREFIX}/*:{CLAIM_REF_PREFIX}/*"),
        ],
    )?;
    let now = Utc::now();
    let mut claims = Vec::new();
    for r in refs {
        let yaml = git(repo_root, &["show", &format!("{}:.mt-claim.yml", r.sha)])?;
        claims.push(parse_claim(&r.node_hash, &yaml, grace_sec, now));
    }
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn node_hash_is_20_hex_and_stable() {
        let h = node_hash("mt", "research/analyze");
        assert_eq!(h.len(), 20);
        assert!(h.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(h, node_hash("mt", "research/analyze"));
        assert_ne!(h, node_hash("mt", "research"));
        // Роздільник \0 розрізняє межу root/path.
        assert_ne!(node_hash("mt/a", "b"), node_hash("mt", "a/b"));
    }

    #[test]
    fn parses_ls_remote_output() {
        let out = "abc123\trefs/mt/claims/deadbeefdeadbeefdead\n\
                   ffff00\trefs/mt/runs/x/y\n\
                   012345\trefs/heads/main\n";
        let refs = parse_ls_remote(out, CLAIM_REF_PREFIX);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].node_hash, "deadbeefdeadbeefdead");
        assert_eq!(refs[0].sha, "abc123");
    }

    #[test]
    fn claim_expiry_uses_grace() {
        let now = Utc.with_ymd_and_hms(2026, 6, 9, 11, 0, 0).unwrap();
        assert!(!lease_expired(Some("2026-06-09T11:00:30Z"), 60, now));
        assert!(lease_expired(Some("2026-06-09T10:58:00Z"), 60, now));
        assert!(lease_expired(Some("not-a-date"), 60, now));
        assert!(lease_expired(None, 60, now));
    }

    #[test]
    fn parses_claim_yaml() {
        let yaml = "schema_version: 1\nnode: research/analyze\nactor: agent\n\
                    runner_id: server-1/4821\nclaimed_at: 2026-06-09T10:00:00Z\n\
                    lease_until: 2026-06-09T11:00:00Z\ntoken: t\ngeneration: 1\n";
        let now = Utc.with_ymd_and_hms(2026, 6, 9, 10, 30, 0).unwrap();
        let c = parse_claim("deadbeef", yaml, 60, now);
        assert_eq!(c.node.as_deref(), Some("research/analyze"));
        assert_eq!(c.actor.as_deref(), Some("agent"));
        assert_eq!(c.runner_id.as_deref(), Some("server-1/4821"));
        assert!(!c.expired);
    }
}

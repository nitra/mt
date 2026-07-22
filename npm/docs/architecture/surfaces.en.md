---
type: layered-translation
source: architecture/surfaces.md
lang: en
sourceFileCrc: 7dec8cab
authored: false
translated: 2026-07-22
model: openai-codex/gpt-5.5
---

# Specialized surfaces

> Part of the target architecture **0.3.0-draft** — [contents](index.md) · [overview](overview.en.md). Implements the cross-app dimension of the [vision](../vision.en.md): not one universal agent, but specialized tools that operate within a specific task/process.

## Essence

This document describes the concept of specialized "surfaces" (`surfaces`) that define the AI agent's operating mode in the target architecture. Instead of one universal agent, the system uses different profiles for different tasks, such as design, content writing, or command line. Each surface configures the context, allowed tools, and prompt systems for optimal implementation of a specific process. This approach provides flexibility and reduces context load, because tools are loaded only when they are needed for the given operating mode.

## Concept

**A Surface is a named agent specialization profile**, not a separate application. One agent-server serves any surface; the client only names the mode in which it conducts the conversation (`surface`-hint in `UserMessage`), and the host assembles the corresponding configuration. The "designer" desktop app and the "writer" desktop app are the same thin protocol client with a different default-surface.

Distinguishing the concepts:

| Concept | What it describes | Where it lives |
| --- | --- | --- |
| `client_kind` | **who** connected (client type: cli, mobile, mt-dashboard) | `ClientHello` |
| `client_capabilities` | **what the client can display** (preview, diff_view, self-translate) | `ClientHello` |
| `surface` | **in which mode the agent operates** (designer, writer, cli) | `UserMessage.surface`, config |

## Surface profile

`surface_profiles` in `.mt.json` is extended from a "string → executor" map to an object:

```jsonc
// .mt.json
{
  "surface_profiles": {
    "designer": {
      "agent_cli": "pi",                   // виконавець surface (ACP; pi = локальні omlx-моделі)
      "system_prompt": ".mt/prompts/designer.md",
      "skills": ["read-files", "write-files", "preview"],
      "tools": ["mcp:figma", "mcp:browser"],   // MCP-сервери (нижче)
      "context_kinds": ["dom_element", "file_region"]
    },
    "writer": {"agent_cli":"codex","system_prompt":".mt/prompts/writer.md","skills":["read-files","write-files"],"tools":[],"context_kinds":["text_range"]},
    "cli": { "agent_cli": "claude", "skills": ["bash", "read-files", "write-files"] }
  }
}
```

- All fields except `agent_cli` are optional; missing profile → default session executor (env `MT_AGENT_CLI`). The tier model is the same `MT_AGENT_CLI_MODEL_MAP`, transport is ACP ([runtime.md](runtime.en.md#підписочні-cli-виконавці-agent_cli)).
- `context_kinds` — which `ContextSelected.kind` this mode can interpret; events with other kinds are rejected by the host with `Error` (rather than silently dropped).
- Per-turn resolution: `UserMessage.surface` → profile → executor (agent_cli)/prompt/tools for this turn. Without a hint — the previous turn's profile; at start — default by `client_kind`.

## Tools: MCP — the normative extension mechanism

- **Every external tool is an MCP server**, declared in the config (`mcp_servers`) and referenced in the surface profile's `tools` as `mcp:<name>`. No custom tool protocol is introduced; MCP servers are passed to the surface executor (CLIs have their own standard MCP mechanism) when the ACP session starts.
- **Lifecycle:** the MCP server starts lazily on the first turn of a surface that needs it; it dies together with the session or after an idle-TTL. The MCP server's tool schemas enter the agent context only for turns of this surface — specialization is the context economy.
- **Trust boundary:** an MCP tool is executed on the host side — destructive calls go through the same mid-run approval gate ([access.md](access.en.md)) as native ones.

Declaration schema:

```jsonc
// .mt.json
{
  "mcp_servers": {
    "figma": {
      "command": "npx",
      "args": ["figma-mcp"],
      "env": { "FIGMA_TOKEN": "secret:figma-token" },  // secret: → OS keychain, як secrets в a.md
      "idle_ttl_sec": 600                                // default 600; 0 → жити до кінця сесії
    }
  }
}
```

The value `secret:<key>` is resolved by the secrets broker ([operations.md](operations.en.md)) — tokens are not stored in config as plaintext.

## Link with sandbox

A profile's `tools` and `skills` are **constrained** by the node's sandbox policy: effective set = intersection of the surface profile and the node's `skill_profiles` allowlist ([operations.md](operations.en.md), security model). A surface cannot give the agent more than the task allows: the node's `a.md.skills` is the ceiling, the surface is specialization within its limits.

## Reference surfaces

| Surface | Specifics | `context_kinds` | Key client capabilities |
| --- | --- | --- | --- |
| **designer** | preview module (HtmlPreview), element picker, screenshots | `dom_element`, `file_region` | `preview` |
| **writer** | work with long text, range edits | `text_range` | `diff_view` |
| **cli** | headless/terminal, no preview | `file_region` | — |

The list is open: new surfaces are added by config without changing the protocol — the protocol knows only the `surface` string and the general `ContextSelected`.

## Nodes and surface

Autonomous runs do not have a surface — their configuration comes from `a.md` (`model_tier`, `skills`). Surface is a property of **interactive** turns. A node picked up in chat ([runtime.md](runtime.en.md)) inherits the `a.md.skills` ceiling, while different turns of one session can go through different surfaces (clicked an element in preview → turn in designer; asked to rewrite a paragraph → writer).

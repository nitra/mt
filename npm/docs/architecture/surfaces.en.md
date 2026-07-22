---
type: layered-translation
source: architecture/surfaces.md
lang: en
sourceFileCrc: 15a2ec02
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Specialized Surfaces

> A part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md). Implements the cross-program dimension [vision](../vision.en.md): not one universal agent, but specialized tools that work within a specific task/process.

## Essence

This document describes the concept of specialized "surfaces" that define the operating mode of the AI agent in the target architecture. Instead of one universal agent, the system uses different profiles for different tasks, such as design, content writing, or command line. Each surface configures the context, allowed tools, and prompt systems for optimal implementation of a specific process. This approach ensures flexibility and reduces context load, as tools are loaded only when needed for a given operating mode.

## Concept

**A Surface is a named profile of agent specialization**, not a separate application. One agent-server serves any surface; the client only names the mode of conversation (`surface`-hint in `UserMessage`), and the host collects the corresponding configuration. The "designer" desktop application and the "writer" desktop application are the same thin protocol client with a different `default-surface`.

Distinction of concepts:

| Concept | What it describes | Where it lives |
| --- | --- | --- |
| `client_kind` | **who** connected (client type: cli, mobile, mt-dashboard) | `ClientHello` |
| `client_capabilities` | **what the client can display** (preview, diff_view, self-translate) | `ClientHello` |
| `surface` | **in what mode the agent operates** (designer, writer, cli) | `UserMessage.surface`, config |

## Surface Profile

`surface_profiles` in `.mt.json` expands from a "string $\to$ provider" map to an object:

```jsonc
// .mt.json
{
  "surface_profiles": {
    "designer": {
      "provider": "local-omlx",            // key from provider_profiles
      "system_prompt": ".mt/prompts/designer.md",
      "skills": ["read-files", "write-files", "preview"],
      "tools": ["mcp:figma", "mcp:browser"],   // MCP servers (below)
      "context_kinds": ["dom_element", "file_region"]
    },
    "writer": {"provider":"litellm","system_prompt":".mt/prompts/writer.md","skills":["read-files","write-files"],"tools":[],"context_kinds":["text_range"]},
    "cli": { "provider": "litellm", "skills": ["bash", "read-files", "write-files"] }
  }
}
```

- All fields except `provider` are optional; a missing profile $\to$ default session profile (degradation like in 0.2.x).
- `context_kinds` $\to$ which `ContextSelected.kind` this mode can interpret; events with other kinds are rejected by the host with `Error` (instead of silently being lost).
- Per-turn resolution: `UserMessage.surface` $\to$ profile $\to$ provider/prompt/tools for this turn. Without a hint $\to$ profile from the previous turn; at startup $\to$ default based on `client_kind`.

## Tools: MCP — Normalization Mechanism for Extension

The `register_external(...)` section from [stack.md](stack.en.md) becomes the norm:

- **Every external tool is an MCP server**, declared in the configuration (`mcp_servers`) and mentioned in the `tools` surface profile as `mcp:<name>`. Custom tool protocols are not introduced; built-in skills (bash, read/write-files, preview) remain native.
- **Lifecycle:** The agent-server starts the MCP server lazily when the first surface requiring it is encountered; it dies with the session or after an idle-TTL. MCP server tool schemas enter the agent's context only for the turns of that surface — specialization is context economy.
- **Trust Boundary:** The MCP tool is executed by the host — destructive calls pass through the same mid-run approval gate ([access.md](access.en.md)) as native ones.

Declaration scheme:

```jsonc
// .mt.json
{
  "mcp_servers": {
    "figma": {
      "command": "npx",
      "args": ["figma-mcp"],
      "env": { "FIGMA_TOKEN": "secret:figma-token" },  // secret: $\to$ OS keychain, like secrets in a.md
      "idle_ttl_sec": 600                                // default 600; 0 $\to$ live until end of session
    }
  }
}
```

The value `secret:<key>` is resolved by the secrets broker ([operations.md](operations.en.md)) — tokens are not left in the config in plain text.

## Link to Sandbox

The `tools` and `skills` of the profile **are limited** by the node's sandbox policy: the effective set = intersection of the surface profile and the node's `skill_profiles`-allowlist ([operations.md](operations.en.md), security model). The Surface cannot give the agent more than the task allows: the node's `a.md.skills` is the ceiling, the surface is specialization within its boundaries.

## Reference Surfaces

| Surface | Specificity | `context_kinds` | Key client capabilities |
| --- | --- | --- | --- |
| **designer** | preview module (HtmlPreview), element picker, screenshots | `dom_element`, `file_region` | `preview` |
| **writer** | working with long text, range edits | `text_range` | `diff_view` |
| **cli** | headless/terminal, without preview | `file_region` | — |

The list is open: new surfaces are added via configuration without changing the protocol — the protocol only knows the `surface` string and the general `ContextSelected`.

## Nodes and Surfaces

Autonomous surface runs do not exist — their configuration comes from `a.md` (`model_tier`, `skills`). The Surface is a property of **interactive** turns. A node picked up in chat ([runtime.md](runtime.en.md)) inherits the ceiling of `a.md.skills`, and different turns in one session can go into different surfaces (clicked an element in preview $\to$ turn in designer; asked to rewrite a paragraph $\to$ writer).

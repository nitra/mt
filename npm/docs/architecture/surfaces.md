---
type: architecture
description: 'Спеціалізовані поверхні: surface-профіль як обʼєкт, MCP як нормативний механізм тулів, звʼязка з sandbox, референсні surface'
tags: [surfaces, tools, mcp, profiles]
timestamp: 2026-07-07
---

# Спеціалізовані поверхні (surfaces)

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md). Реалізує крос-програмковий вимір [мети](../vision.md): не один універсальний агент, а спеціалізовані тули, які працюють у рамках певної задачі/процесу.

## Суть

Цей документ описує концепцію спеціалізованих "поверхень" (`surfaces`), які визначають режим роботи AI-агента у цільовій архітектурі. Замість одного універсального агента, система використовує різні профілі для різних завдань, як-от дизайн, написання контенту чи командний рядок. Кожна поверхня налаштовує контекст, дозволені інструменти та системи промптів для оптимальної реалізації конкретного процесу. Такий підхід забезпечує гнучкість та знижує навантаження на контекст, оскільки інструменти завантажуються лише тоді, коли вони потрібні для даного режиму роботи.

## Концепція

**Surface — це іменований профіль спеціалізації агента**, а не окремий додаток. Один agent-server обслуговує будь-які surface; клієнт лише називає, в якому режимі веде розмову (`surface`-hint у `UserMessage`), і хост збирає відповідну конфігурацію. Десктоп-додаток «designer» і десктоп-додаток «writer» — це той самий тонкий клієнт протоколу з різним default-surface.

Розмежування понять:

| Поняття | Що описує | Де живе |
| --- | --- | --- |
| `client_kind` | **хто** підключився (тип клієнта: cli, mobile, mt-dashboard) | `ClientHello` |
| `client_capabilities` | **що клієнт вміє відобразити** (preview, diff_view, self-translate) | `ClientHello` |
| `surface` | **у якому режимі працює агент** (designer, writer, cli) | `UserMessage.surface`, конфіг |

## Surface-профіль

`surface_profiles` у `.mt.json` розширюється з мапи «рядок → провайдер» до обʼєкта:

```jsonc
// .mt.json
{
  "surface_profiles": {
    "designer": {
      "provider": "local-omlx",            // ключ із provider_profiles
      "system_prompt": ".mt/prompts/designer.md",
      "skills": ["read-files", "write-files", "preview"],
      "tools": ["mcp:figma", "mcp:browser"],   // MCP-сервери (нижче)
      "context_kinds": ["dom_element", "file_region"]
    },
    "writer": {
      "provider": "litellm",
      "system_prompt": ".mt/prompts/writer.md",
      "skills": ["read-files", "write-files"],
      "tools": [],
      "context_kinds": ["text_range"]
    },
    "cli": { "provider": "litellm", "skills": ["bash", "read-files", "write-files"] }
  }
}
```

- Усі поля, крім `provider`, опціональні; відсутній профіль → профіль сесії за замовчуванням (деградація як у 0.2.x).
- `context_kinds` — які `ContextSelected.kind` цей режим уміє інтерпретувати; події з іншими kind хост відхиляє з `Error` (а не мовчки губить).
- Резолюція per-turn: `UserMessage.surface` → профіль → провайдер/промпт/tools цього ходу. Без hint — профіль попереднього ходу; на старті — default за `client_kind`.

## Tools: MCP — нормативний механізм розширення

Заділ `register_external(...)` зі [stack.md](stack.md) стає нормою:

- **Кожен зовнішній тул — MCP-сервер**, задекларований у конфігу (`mcp_servers`) і згаданий у `tools` surface-профілю як `mcp:<name>`. Власний тул-протокол не вводиться; вбудовані skills (bash, read/write-files, preview) лишаються нативними.
- **Життєвий цикл:** agent-server стартує MCP-сервер ліниво при першому ході surface, що його потребує; помирає разом із сесією або за idle-TTL. Схеми тулів MCP-сервера потрапляють у контекст агента лише для ходів цього surface — спеціалізація і є економія контексту.
- **Межа довіри:** MCP-тул виконується з боку хоста — деструктивні виклики проходять той самий mid-run approval-гейт ([access.md](access.md)), що й нативні.

Схема декларації:

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

Значення `secret:<key>` резолвиться secrets-брокером ([operations.md](operations.md)) — токени не лежать у конфігу відкритим текстом.

## Звʼязка з sandbox

`tools` і `skills` профілю **обмежуються** sandbox-політикою вузла: ефективний набір = перетин профілю surface і `skill_profiles`-allowlist вузла ([operations.md](operations.md), security model). Surface не може дати агенту більше, ніж дозволяє задача: `a.md.skills` вузла — стеля, surface — спеціалізація в її межах.

## Референсні surface

| Surface | Специфіка | `context_kinds` | Ключові capabilities клієнта |
| --- | --- | --- | --- |
| **designer** | preview-модуль (HtmlPreview), picker елементів, скріншоти | `dom_element`, `file_region` | `preview` |
| **writer** | робота з довгим текстом, правки діапазонів | `text_range` | `diff_view` |
| **cli** | headless/термінал, без preview | `file_region` | — |

Список відкритий: нові surface додаються конфігом без зміни протоколу — протокол знає лише рядок `surface` і загальний `ContextSelected`.

## Вузли і surface

Автономні runs surface не мають — їхня конфігурація йде з `a.md` (`model_tier`, `skills`). Surface — властивість **інтерактивних** ходів. Вузол, підхоплений у чат ([runtime.md](runtime.md)), успадковує стелю `a.md.skills`, а різні ходи однієї сесії можуть іти в різних surface (тицьнув елемент у preview → хід у designer; попросив переписати абзац → writer).

---
type: architecture
description: 'agent-server як єдиний хост-процес, протокол подій v3, інтерактивні сесії, міграція між хостами, preview'
tags: [runtime, agent-server, protocol, sessions]
timestamp: 2026-07-07
---

# Runtime: хости, сесії, поверхні

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md)

## agent-server — один хост-процес на машину

Уся логіка виконання живе в довгоживучому процесі `agent-server`. ВСІ поверхні — тонкі клієнти одного протоколу подій; жоден клієнт не викликає ядро агента напряму.

**Discovery / single-instance:** при старті сервер пише port-file (`~/.nitra/server.port`: port + pid + токен-хеш) і тримає lock-файл. Додаток перед запуском власного сервера читає port-file і пробує `ClientHello`; живий → підключається клієнтом; stale lock → перезаписує і стартує свій. Скільки б додатків не було запущено — agent-server один.

agent-server поєднує три ролі (колишні окремі процеси MT):

| Роль | Обов'язки |
| --- | --- |
| **Orchestrator** (колишній `mt watch`) | скан графа, ready-вузли, dispatch runners/аудитів, composite-агрегація, cleanup |
| **Runner** (колишній `mt run` wrapper) | claim → worktree → агент → publish → release; бюджети, watchdog, телеметрія |
| **Session host** (НОВЕ) | інтерактивні сесії: broadcast Envelope клієнтам, реплей, approvals, preview |

**Транспорти клієнтів:** (а) локальний WS `ws://127.0.0.1:{port}` з одноразовим токеном; (б) in-process канал (вбудовування в десктоп-додаток); (в) relay-клієнт — вихідне wss:// до relay для віддалених клієнтів. Reconnect з backoff.

### ACP-міст (агент-сторона)

ACP (Agent Client Protocol; JSON-RPC поверх stdio, клієнт спавнить агента підпроцесом) — зовнішня межа сумісності з редакторами: Zed, JetBrains, Neovim, Toad і будь-який інший ACP-клієнт отримують MT без кастомних інтеграцій. Протокол v4 ACP **не замінює** — у v4 є те, чого в ACP немає: Ed25519-підписи гейтів, кімнати за `node_hash`, реплей за `seq`, capability-фільтр, `lang`/live-переклад. Натомість редактор спавнить **acp-shim** (режим `agent-cli`): до редактора shim говорить ACP, до agent-server — тонким клієнтом протоколу v4 (транспорт (а); discovery — штатний port-file, agent-server лишається один).

| ACP (редактор ↔ shim) | Протокол v4 (shim ↔ agent-server) |
| --- | --- |
| `initialize` (protocolVersion, capabilities) | `ClientHello { client_kind: "acp", client_capabilities, lang }` (lang — з локалі shim) |
| `session/new { cwd, mcpServers }` | attach вузла: CAS claim + worktree; вузол — за `cwd` у межах `mt/`-дерева, інакше shim пропонує вибір першим ходом |
| `session/prompt { prompt }` | `UserMessage { text }` |
| ← `session/update` | `AgentTextDelta`/`AgentTextDone`/`ToolCall`/`ToolResult`/`PlanReview` |
| ← `session/request_permission` | `ApprovalRequest` → `ApprovalResponse`: вердикт дає редактор, Ed25519-підпис ставить пристрій shim-а |
| `session/cancel` | `CancelTurn` |

Чесні межі: capabilities `preview` і `self-translate` відсутні — скріншоти не шляться, текст приходить уже перекладеним хостом (загальне правило хендшейку). Реєстрація shim-а в ACP Registry — канал дистрибуції «MT з будь-якого редактора».

### Зовнішній екзекутор вузла (`node_executor`)

Runner виконує agent-вузол одним із двох шляхів:

- **Вбудований Claude-agent-шлях** (дефолт) — спавн `claude` з моделлю за `model_tier` (`.mt.json` `model_map`);
- **Зовнішній екзекутор** — якщо `.mt.json` має `node_executor` (рядок-команда, напр. `npx n-cursor mt-run-node`), runner замість Claude спавнить цю команду. Мотивація: зовнішній консюмер виконує вузли **власним** harness-ом (свої моделі/тири, власна телеметрія), а не Claude-моделями `model_map` — тир-канон лишається обов'язковим і для fix-вузлів.

MT лишає за собою **всю оркестрацію**: claim/lease, worktree-ізоляція, budget/timeout (hard-timeout = `budget_hard_sec`), `## Check`, fenced publish. Екзекутор — **лише «застосуй зміни у worktree»**; контракт-артефакт `fact_NNN.md` синтезує runner (екзекутор його не пише).

**Контракт команди-екзекутора:**

| Канал | Вміст |
| --- | --- |
| argv | `<node_executor...> <node-dir>` — абсолютний шлях директорії вузла у worktree (= cwd) |
| env | `MT_NODE_DIR`, `MT_WORKTREE`, `MT_RUN_TOKEN`, `MT_MODEL_TIER` (MIM/AVG/MAX — консюмер мапить на свій пул), `MT_TASK_PATH`, `MT_RUN_NNN`, `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT` |
| stdout | остання непорожня лінія = JSON `{ applied: bool, touchedFiles: string[] }` (best-effort; не-JSON → applied=false) |
| exit | `0` → runner ганяє `## Check` (якщо є) і за успіху синтезує `fact_NNN.md` → штатний merge/publish; ненульовий → failed-run штатно (worktree лишається для діагностики) |

Застосовується лише до actor `agent`; `human` та інші actor-и — без змін. **Зворотна сумісність:** `node_executor` відсутній → поточний Claude-шлях без змін. Гранулярність — глобальна (на репо/`.mt.json`): консюмер, що володіє всім `mt/`-графом, виконує ВСІ agent-вузли своїм harness-ом; це унеможливлює «тихий» відкат окремого вузла на Claude-шлях (свідомо відхилений проміжний стан).

#### ACP-екзекутор — цільовий контракт зовнішнього екзекутора

Argv-контракт вище структурно сліпий: `spawnSync` із захопленим stdout — нуль подій до exit, permission-рішення зашиваються прапорцями заздалегідь. Експеримент 2026-07-13 (argv vs ACP на еталонному вузлі) зафіксував бінарні переваги ACP: живий стрім (90 подій проти 0) і mid-run approval (11 відпрацьованих гейтів проти неможливих у принципі). Тому в цільовій картині runner agent-server говорить із зовнішнім екзекутором **лише за ACP** (клієнт-сторона; та сама межа, що ACP-міст вище, але з боку клієнта):

- runner = ACP-клієнт: спавнить екзекутор (`claude-code-acp`, Gemini CLI, будь-який ACP-агент) підпроцесом; `session/new` (cwd = node-dir у worktree) → `session/prompt` (інструкція з task.md); env `MT_*` передається при spawn, як в argv-контракті;
- `session/update` транслюється в Envelope-події run-а (`ToolCall`/`ToolResult`/`AgentTextDelta`) — автономний run зовнішнім harness-ом стає спостережуваним у dashboard нарівні з інтерактивною сесією;
- `session/request_permission` → політика runner-а: дії в межах worktree — авто-allow (`allow_always`, інакше запит летить на кожну write/execute-дію), деструктивне — штатний mid-run approval-гейт ([access.md](access.md));
- інваріанти незмінні: MT володіє claim/lease, worktree-ізоляцією, бюджетами (hard-timeout = kill підпроцесу), `## Check`, fenced publish; `fact_NNN.md` синтезує runner, `{applied, touchedFiles}` runner рахує сам із git-стану worktree;
- argv-контракт у Rust **не реімплементується**: сумісність із не-ACP екзекуторами (кастомний harness, shell-скрипт) — generic **argv→ACP shim** (окрема обгортка ~50 рядків: агент-сторона ACP, всередині — команда за argv-контрактом). Escape hatch живе як shim, а не як другий контракт у runner-і. JS-runner (`@7n/mt`) зберігає argv-шлях без змін до міграції runner-а в agent-server.

## Wake: push замість polling

Базовий MT прокидався cron-ом кожні 5 хв. У цільовій архітектурі:

1. **Relay push «є нові події у задачі X»** → agent-server негайно ресканить відповідний вузол;
2. `post-merge` git hook → `mt run --auto` + `touch .mt/wake` (локальні мерджі);
3. **Cron/periodic rescan — fallback** (relay недоступний → система працює як базовий MT).

`mt watch`-логіка (dispatch, unresolvable-алерти, GC) виконується при кожному wake. Сортування черги `waiting`: leaf nodes → `deadline` → `created_at`.

## Протокол подій

Контракт клієнт↔хост. `PROTOCOL_VERSION = 4` (v1/v2 — історія scaffold-spec; v3 — проміжний draft без `lang`; несумісні версії → явна помилка з підказкою оновитись).

### Envelope

```
Envelope {
  seq: u64                    // монотонний у межах run; призначає тримач claim
  ts: DateTime<Utc>
  node_hash: string           // кімната/адреса вузла
  run_token: uuid             // = token claim-а; ідентифікатор сесії
  device_id: uuid?            // хто ініціював (для подій від клієнтів)
  account_id: uuid?           // у спільних задачах учасників кілька
  event: Event
}
```

`session.jsonl` — це append-only список Envelope-ів (крім ефемерних: `PreviewScreenshot`, `AgentTextDelta` можна не журналити — журналиться `AgentTextDone`-агрегат).

### Events

```
// клієнт → хост
UserMessage      { text, attachments[], surface?: string }
                 // surface-hint: "designer" | "writer" | "cli" | … —
                 // агент може підставити відповідний профіль провайдера/промпт
ContextSelected  { kind: string, payload: json, bounding_box?: Rect }
                 // "dom_element" | "text_range" | "file_region" | … —
                 // контекст, у який «тицьнув» користувач, незалежно від додатку
ApprovalResponse { request_id, approved, signature: bytes }
                 // Ed25519-підпис пристрою над (request_id, approved, node_hash, run_token);
                 // пристрій може належати ІНШОМУ акаунту з роллю approver+
CancelTurn       {}
DoneSession      {}   // завершити run: хост виконує mt done-семантику —
                      // fenced publish fact у main (v4-мінор)
ReleaseSession   {}   // пауза/відпустити: CAS-delete claim; журнал лишається
                      // в run ref базою відновлення (v4-мінор)

// хост → клієнти
AgentTextDelta   { text }
AgentTextDone    {}
ToolCall         { call_id, name, args }
ToolResult       { call_id, ok, summary }
ApprovalRequest  { request_id, action, diff? }
PreviewScreenshot{ ref_id, mime }     // ЕФЕМЕРНА: лише relay/WS, ніколи в git;
                                      // лише клієнтам з capability "preview"
FileChanged      { path }
Committed        { commit_hash, message }
NodeState        { path, state, claim?: {holder_device, lease_until, generation} }
                 // derived-стан вузла — і для сесії, і для mt-dashboard
ClaimChanged     { node_hash, holder_device_id?, lease_until?, generation }
                 // транслюється relay-ем; джерело істини — git ref
MemberChanged    { account_id, role? }   // None = видалено
PlanReview       { plan_ref }            // composite-план чекає approve
AuditPending     { fact_ref }            // fact чекає вердикту людини-аудитора
Error            { message }
```

### Хендшейк

```
ClientHello {
  protocol_version, device_id, device_token,
  client_kind: "designer" | "writer" | "cli" | "mobile" | "mt-dashboard" | …,
  client_capabilities: ["preview", "approvals", "diff_view", "self-translate", …],
  lang: string,                       // ОБОВ'ЯЗКОВЕ (v4): BCP-47 мова учасника
  want_replay_from: Option<seq>,
}
→ ServerHello { protocol_version, session_list }
```

Сервер **фільтрує події за capabilities** (PreviewScreenshot → лише "preview"). `lang` керує live-перекладом: клієнт без capability `self-translate` отримує текстові події вже перекладені його мовою; із `self-translate` — оригінал (перекладає сам). Деталі — [i18n.md](i18n.md). Реплей: live-хвіст з пам'яті (буфер), глибше — з `session.jsonl` run ref-а.

### Помилкові гілки і backpressure

- **Reconnect:** клієнт зберігає останній оброблений `seq` і реконектиться з `want_replay_from`; `seq` монотонний — розривів у журнальованих подіях не буває. Глибина поза буфером → хост дочитує з `session.jsonl` run ref-а.
- **Backpressure:** для повільного клієнта хост **скидає лише ефемерні** події (`AgentTextDelta`, `PreviewScreenshot`) — журнальовані доставляються завжди; переповнення черги надсилання → примусовий disconnect з `Error`, клієнт повертається реплеєм. Ліміт кадру — 2 MB (спільний з relay).
- **`PreviewScreenshot` байти:** подія несе лише `ref_id`; байти клієнт тягне окремим запитом до хоста (локальний HTTP preview-модуля або бінарний WS-кадр за `ref_id`) — великі бінарі не проходять крізь стрічку подій і relay-буфер.
- **Невідомий `Event`-варіант** у межах сумісної мажорної версії клієнт **ігнорує** (forward-compatibility мінорних розширень); несумісна `protocol_version` → відмова на хендшейку.

### `mt-dashboard`

Спеціалізований `client_kind`: підписується не на один run, а на **піддерево вузлів** (кімнати за node_hash); отримує `NodeState`/`ClaimChanged`/`PlanReview`/`AuditPending`/`Committed` без чат-стріму. Це відповідь на «бачити весь граф як одну картину»: агрегація на клієнті, а не окремий тип сесії.

## Інтерактивна сесія = run вузла

Життєвий цикл:

```
mt attach <node>  (або UI «відкрити задачу»)
  → хост: CAS claim (interactive: true) → worktree від base_sha
  → клієнти підключаються (локально/через relay), отримують реплей
  → кожен хід: UserMessage → агент → ToolCall/ApprovalRequest/…
      → коміт (файли + session.jsonl) → push run ref
  → завершення:
      mt done  → ## Check → fenced publish fact у main (+ archive ref)
      пауза    → renewal припиняється → claim спливає → вузол waiting/stalled
      handoff  → міграція на інший хост (нижче)
```

Інтерактивний режим впливає на політики: `progress_timeout_sec` не діє (людина думає), бюджети радше soft-alert ніж kill; `run_NNN.md` пишеться так само (телеметрія wall_sec/tokens/cost — з ходів).

**Вузол у два режими:** та сама задача може почати як автономна (класичний MT) і бути «підхопленою» в чат (людина відкриває failed-вузол інтерактивно — це новий run з тим самим контрактом), і навпаки: інтерактивно розпочату задачу можна лишити автономному retry.

## Міграція сесії між хостами («перенести сюди»)

```
1. Новий хост (роль host+, git-доступ): шле через relay HandoffRequest{node_hash}
2. Тримач claim: завершує поточний хід → коміт + push run ref
   → пише run_NNN.md (result: handoff) → CAS-delete claim → ack
3. Новий хост: CAS-create claim (новий token, generation+1)
   → fetch старого run ref → worktree checkout з його tip
   → реплей session.jsonl → продовжує розмову (run N+1, журнал успадковано)
4. Relay недоступний / тримач мертвий → шлях MT: чекати lease expiry + grace
   → takeover; журнал відновлюється з останнього запушеного run ref
   (втрачається щонайбільше незавершений хід)
```

Клієнти при цьому не перепідключаються нікуди вручну: relay транслює `ClaimChanged`, клієнти продовжують у тій самій кімнаті з новим активним хостом.

## Preview — capability-based модуль

Прев'ю — опційний модуль інтерактивного run, вмикається за типом проєкту:

- `PreviewBackend { start(worktree) → PreviewHandle }`; референс — `HtmlPreview`: статичний HTTP-сервер над worktree + інжект picker-скрипта + WebSocket live reload (watcher) + ендпоінт, що транслює вибір елемента як `ContextSelected { kind: "dom_element" }`;
- `PreviewScreenshot` шириться лише клієнтам із capability `"preview"`; ніколи не персиститься;
- Інші поверхні шлють свої `ContextSelected` (text_range, file_region) напряму через транспорт.

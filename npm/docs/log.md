# Журнал змін документації

## 2026-07-11

* **Update**: підготовка до видалення frozen-контракту [mt.md](mt.md) (аудит покриття: майже все поглинуто главами) — останній унікальний нормативний зміст перенесено в канон:
  * [architecture/git.md](architecture/git.md) — розділ «Wrapper: запуск агента»: pipeline wrapper-а та ENV-контракт wrapper → агент (`MT_BUDGET_SEC` … `MT_CLAIM_GENERATION`, generation як fencing token);
  * [architecture/graph.md](architecture/graph.md) — розділ «Контекст агента»: композиція контексту run-а і дворівневе «Prior attempts резюме» (compact + `run-summary.md`);
  * [architecture/operations.md](architecture/operations.md) — канон baseline-дефолтів `.mt.json` явно закріплено за кодом (`CONFIG_DEFAULTS` у `mt-core`), глави лишаються довідником семантики.
  * Після цього видалення mt.md на M1 — механічне: прибрати файл і посилання (index.md, architecture/index.md, overview.md, `npm/lib/tests/docs.test.mjs`).
* **Update**: започатковано **M1** — перший Rust-крейт [`crates/agent-protocol`](architecture/stack.md): типи `Envelope`/`Event` протоколу v4 (serde, forward-compat `Unknown`-варіант), хендшейк `ClientHello` (обовʼязкове `lang`) з перевіркою версії, Ed25519-підписи approvals (`ed25519-dalek`, доменний префікс + NUL-роздільник); без tokio/tauri (фізична межа зі stack.md).

## 2026-07-08

* **Update**: [architecture/retro.md](architecture/retro.md) — цикл замкнено третьою ланкою «застосування → вимірювання → визнання»: прийнята оптимізація матеріалізується immutable-файлом `innovation_NNN.md` із зафіксованим baseline (зріз ledger по скоупу на момент прийняття); impact-зрізи — другий режим retro-прогону (Δwall/Δcost/Δfailed_streak з порогом confidence `impact_min_runs`); заохочення: людям — видимий профіль вкладу з доказами (платформа дає вимірювання, не компенсацію), агентам — відбір (підтверджені патерни стають default і отримують більше задач свого класу); межа приватності — «пропозиції приватні, впровадження публічне»; anti-gaming: клас задач + поріг runs + штатний аудит. Roadmap M5 отримав другий demo-критерій (impact).
* **Creation**: [architecture/retro.md](architecture/retro.md) — глава мета-циклу (закриває прогалину з мапінгу [vision.md](vision.md)): audit trail графа як готовий датасет ретроспективи; чотири нормативні принципи (працює на виконавця / не нагляд / пропозиція ≠ дія / дані не покидають периметр); системний фоновий прогін agent-server поза графом (патерн i18n-черги); suggestion-обʼєкти з evidence-посиланнями на run-файли; зберігання у приватному просторі виконавця, доставка push тип 3; застосування — штатні правки `a.md`/конфігів. Roadmap отримав **M5 — Мета-цикл** (MVP одразу після M0, без relay і сесій).
* **Update**: започатковано **M0 dogfood** — корінь `mt/` у репозиторії, перша задача ведеться через `@7n/mt`.

## 2026-07-07

* **Update**: курування корпусу — мінус половина legacy, плюс точкові розкриття:
  * видалено [review-response.md] (історичний артефакт: усі зауваження «Вирішено» і вшиті в mt.md) та [mt-impl.md] (реалізаційні деталі 0.2.x дублюються кодом і главами; наскрізний приклад перенесено);
  * [mt.md](mt.md) — 🧊 frozen: не редагується, канон розвитку — architecture/; видалення — на M1;
  * [architecture/graph.md](architecture/graph.md) — «Наскрізний приклад» у двох частинах: автономний граф (перенесено з mt-impl) + продовження в цільовій картині (attach failed-вузла, матеріалізація мовою, handoff, підпис із телефона);
  * [architecture/overview.md](architecture/overview.md) — глосарій (13 термінів → глави);
  * [architecture/operations.md](architecture/operations.md) — довідник ключів конфігурації (група → ключі → глава);
  * [architecture/access.md](architecture/access.md) — trust-матриця (хто що бачить/перевіряє; чесна межа: без E2E у 0.3.0);
  * [architecture/runtime.md](architecture/runtime.md) — помилкові гілки протоколу: reconnect за seq, backpressure (скидаються лише ефемерні), байти PreviewScreenshot поза стрічкою, ігнорування невідомих Event-варіантів;
  * [architecture/surfaces.md](architecture/surfaces.md) — схема `mcp_servers` (secret:-резолв через брокер, idle_ttl);
  * [vision.md](vision.md) — розділ «Ніша»: відбудова від Jira/Trello, Linear/Agent HQ, LangGraph/CrewAI.
* **Update**: пакет рішень по відкритих питаннях архітектури (12 пунктів, brainstorm-цикл):
  * [architecture/surfaces.md](architecture/surfaces.md) (нова глава) — крос-програмковий вимір: surface-профіль як обʼєкт конфігурації (provider/prompt/skills/tools/context_kinds), MCP — нормативний механізм зовнішніх тулів, ефективний набір = перетин профілю і sandbox-стелі вузла; референсні designer/writer/cli;
  * [roadmap.md](roadmap.md) (новий) — M0 dogfood ядра → M1 agent-server локально → M2 mission control (relay + телефон-approver) → M3 dashboard/поверхні → M4 файловий i18n; milestone = demo-критерій; критерій готовності i18n живе тут (у DoD не додається — рішення);
  * [architecture/runtime.md](architecture/runtime.md) — протокол v4: обовʼязкове `lang` (BCP-47) у ClientHello, capability `self-translate`;
  * [architecture/i18n.md](architecture/i18n.md) — live-шар став гібридом за capability (default — хост, `self-translate` — клієнт сам; relay не бере участі); правило запису `refs/mt/i18n` лише разом із fenced publish (без окремого «пера»); триступенева класифікація файлів (default `**/*.md` → include/exclude → frontmatter opt-out); фонова регенерація — системна черга agent-server поза графом задач, вартість поза ledger (замінює auto-spawn MT-вузлів);
  * [architecture/git.md](architecture/git.md) — handover-TODO закрито дизайном checkpoint-handoff (свіжий run ref зі станом + summary, журнал лишається в archive автора);
  * [architecture/access.md](architecture/access.md) — життєвий цикл ключів: rotation з історією pubkey, recovery через email-flow, succession через co-owner + адмін-процедуру (без кворумної криптографії);
  * [architecture/operations.md](architecture/operations.md) — design envelope (~5–10k вузлів на `mt/`-корінь, ріст refs обмежений GC) і self-hosted-first хостинг relay.
* **Creation**: [architecture/i18n.md](architecture/i18n.md) — глава багатомовності (закриває прогалину крос-мовного виміру [vision.md](vision.md)): base-мова — єдиний канон (scanner/`## Check` читають лише base), переклади — derived-дані у `refs/mt/i18n/<lang>` зі staleness за `source_hash`; read path — overlay мови учасника при матеріалізації worktree; write path — contract-aware компіляція правки в base перед fenced publish, authored-захист від round-trip churn; eager-переклад лише для мов учасників, lazy для решти; фонова регенерація — auto-spawn MT-вузлів-перекладачів; live-шар (чат) — переклад на поверхні.
* **Creation**: [vision.md](vision.md) — мета проєкту зафіксована як нормативний документ: платформа задач, де виконавці — і люди, і ШІ (здебільшого ШІ); пʼять крос-вимірів (виконавці, девайси, спеціалізовані тули, люди, мови) з мапінгом на глави архітектури 0.3.0-draft; крос-мовність позначена відкритою прогалиною; git — субстрат, не інтерфейс.
* **Update**: документацію реструктуризовано — архітектуру 0.3.0-draft розбито на глави в [architecture/](architecture/index.md), додано індекси та цей журнал.
* **Creation**: цільова архітектура **0.3.0-draft** — обʼєднання `mt.md` 0.2.0 (граф задач) і scaffold-spec v4 (пристрої/сесії):
  * git CAS claim — єдине «перо» для автономних та інтерактивних режимів; relay lease видалено з протоколу (relay лише нотифікує `ClaimChanged`) — [git.md](architecture/git.md);
  * інтерактивна сесія = run вузла: `session.jsonl` у run ref із push-ом кожен хід; archive refs; `result: handoff`; протокол міграції між хостами — [runtime.md](architecture/runtime.md);
  * agent-server: один хост-процес на машину (orchestrator + runner + session host), discovery через port-file; relay push замість cron-polling (cron — fallback);
  * протокол подій v3: Envelope/Event, ClientHello з `client_kind`/`client_capabilities`, `ContextSelected`, `surface`-hint, `mt-dashboard`;
  * Ed25519-підписи пристроїв на трьох гейтах (mid-run approvals → `## Approvals` у `run_NNN.md`; plan-review і аудит-вердикти → блок `approved_by`); pubkey-кеш через relay — [access.md](architecture/access.md);
  * membership-модель (owner/host/approver/viewer) на кореневому вузлі задачі, ACL у relay; precondition git-доступу для host+; push-нотифікації трьох типів;
  * `interactive: true` у claim/`a.md`; `surface_profiles`/`provider_profiles` у конфігу; нові CLI: `mt serve/attach/handoff/login/sessions/invite/members` — [operations.md](architecture/operations.md);
  * стек винесено в окремий документ [stack.md](architecture/stack.md).

## 2026-06-13

* **Update**: контракт 0.2.x — scanner делеговано Rust-бінарнику `mt-scanner` (див. [CHANGELOG](../CHANGELOG.md) `@7n/mt@0.3.0`).

## 2026-06-11

* **Creation**: початкова версійована редакція контракту **0.2.0** — [mt.md](mt.md): файловий контракт, derived-стани, CLI, fenced publish + CAS claims, retry ladder, аудит, security model.

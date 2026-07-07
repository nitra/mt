# Журнал змін документації

## 2026-07-07

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

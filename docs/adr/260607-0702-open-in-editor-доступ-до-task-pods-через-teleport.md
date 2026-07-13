---
type: ADR
title: Open in Editor доступ до task pods через Teleport
description: UI nitra/task відкриває task-вузли в dev pods через on-demand Kubernetes provisioning, Teleport SSH gateway і editor-specific підключення.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Потрібен UI для перегляду й редагування task-графу, де вузли зберігаються у `tasks/<name>/task.md`. Розробники мають підключатися до dev pod-ів у Kubernetes, де змонтовано `tasks-pvc`, але не мають отримувати `kubectl` доступ. Бекенд `nitra/task` повинен контролювати, хто і до якого task-node може підключитися, та надавати UX на кшталт "Open in Editor".

## Considered Options

- `kubectl port-forward` + SSH у pod.
- Teleport Auth+Proxy з node-agent у dev pod.
- Власний SSH gateway з кастомною авторизаційною логікою.
- Tailscale або WireGuard у pod.
- Постійно запущені dev pods для task-node.
- On-demand spawn dev pod через бекенд `nitra/task`.
- Підтримка лише Zed.
- Підтримка VS Code, Cursor і Zed.

## Decision Outcome

Chosen option: "On-demand dev pods через `nitra/task` з доступом через Teleport і Open in Editor UX", because transcript фіксує, що `kubectl port-forward` не підходить для розробників без kubectl-прав, Teleport дає SSO/RBAC/audit і короткоживучі SSH-сертифікати, а backend може створювати pod з labels `task=<node>`, `owner=<email>` після перевірки прав.

### Consequences

- Good, because розробник не отримує Kubernetes credentials; доступ контролюється бекендом і Teleport RBAC через labels.
- Good, because dev pod створюється лише за запитом і може автоматично видалятися після grace period, timeout або переходу task у `resolved`.
- Good, because VS Code і Cursor можуть відкриватися одним кліком через URI deep link, а Zed працює через стандартний SSH hostname і `ProxyCommand`.
- Bad, because transcript фіксує додаткову операційну складність: потрібно задеплоїти Teleport Auth Server + Proxy Server і node-agent/sidecar.
- Bad, because Zed не має підтвердженого URI deep link у transcript, тому його UX гірший за VS Code/Cursor.
- Neutral, because transcript не містить підтвердження негативного впливу cold start, окрім згадки про очікування Ready/реєстрації pod.

## More Information

Факти з transcript:

- Проєкт названо `nitra/task` і розміщено в `/Users/vitaliytv/www/nitra/task`.
- Task-вузли зберігаються як `tasks/<name>/task.md` із frontmatter `created_at`, `budget_sec` і секціями `## Task`, `## Done when`, `## Inputs`.
- Backend flow: UI-запит → перевірка прав → `kubectl apply dev-pod.yaml` → labels `task=<name>`, `owner=<email>` → очікування `pod Ready` → Teleport реєстрація → повернення connection string.
- Pod монтує `tasks-pvc`, де лежать `task.md`, `run_NNN.md`, `outputs_NNN.md`.
- Teleport Role використовує label `owner: "{{internal.logins}}"`.
- SSH config для розробника: `Host *.teleport.nitra.com`, `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p`, `User dev`.
- VS Code URI: `vscode://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks`.
- Cursor URI: `cursor://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks`.
- Для Zed transcript фіксує copy hostname/manual SSH path.
- Lifecycle: spawn при відкритті сесії, grace period після закриття SSH, auto-delete після timeout, delete при `resolved`.

## Update 2026-06-07

Додатково transcript фіксує, що task-вузли зберігаються у `tasks/<name>/task.md` за схемою `npm/docs/mt.md`: YAML-frontmatter із `created_at` та `budget_sec`, секції `## Task`, `## Done when`, `## Inputs`. Приклади створених вузлів: `tasks/ui-task-view/task.md`, `tasks/coverage-skill-test/task.md`, `tasks/skills-orchestrator-migration/task.md`, `tasks/open-in-editor/task.md`. Ці факти уточнюють файловий контекст, до якого підключається dev pod.

## Update 2026-06-07

Transcript додатково фіксує назву UI-проєкту: `nitra/task`, розташування `/Users/vitaliytv/www/nitra/task`. Розглянуті назви `n-graph`, `graphwatch`, `taskflow`; обрано `nitra/task`, бо користувач явно визначив цю назву та шлях. У проєкті вже були `app/`, `package.json`, `bun.lock`, `eslint.config.js`.

## Update 2026-06-07

Додатково transcript фіксує підтримку кількох редакторів у UI: VS Code та Cursor відкриваються через URI deep link `vscode://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks` і `cursor://vscode-remote/ssh-remote+<hostname>.teleport.nitra.com/tasks`; Zed не має підтвердженого URI-протоколу, тому для нього UI має показати hostname для копіювання. Усі редактори використовують однаковий SSH-конфіг із `ProxyCommand tsh proxy ssh`.

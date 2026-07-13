---
type: ADR
title: Teleport як SSH gateway для task-нод у Kubernetes
description: Розробники підключаються до dev pods через Teleport без прямого kubectl-доступу, а backend керує доступом через labels.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Система `mt` запускатиме task-вузли у Kubernetes. Розробникам потрібен доступ до dev pods, зокрема через Zed remote SSH, для інспекції та патчингу конкретних task-нод. Водночас розробники не мають і не повинні мати прямого `kubectl`-доступу до кластера. Авторизацію того, хто до якого вузла може підключитись, має контролювати backend-застосунок, а не Kubernetes RBAC напряму.

## Considered Options

- Teleport як identity-aware SSH gateway з label-based RBAC.
- `kubectl port-forward` для прямого SSH-доступу до pod.

## Decision Outcome

Chosen option: "Teleport як identity-aware SSH gateway", because `kubectl port-forward` вимагає наявного `kubectl`-доступу у розробника, що явно відхилено в transcript. Teleport дозволяє backend-застосунку контролювати права через labels без видачі kubectl-прав, а Zed підключається як до звичайного SSH через `~/.ssh/config` і `ProxyCommand tsh proxy ssh`.

### Consequences

- Good, because backend при створенні dev pod ставить labels `owner`, `task`, `project`, а Teleport надає доступ лише відповідному користувачу.
- Good, because Teleport видає short-lived SSH certificates замість статичних ключів.
- Good, because Zed не потребує патчів і працює через стандартний SSH config.
- Bad, because потрібно задеплоїти Teleport Auth Server і Proxy як додаткову операційну залежність у кластері.
- Neutral, because transcript не містить підтвердження конкретного production rollout.

## More Information

UI-застосунок для задач: `nitra/task` (`/Users/vitaliytv/www/nitra/task`). Структура вузлів: `tasks/ui-task-view/task.md`, `tasks/coverage-skill-test/task.md`, `tasks/skills-orchestrator-migration/task.md`.

Dev pod label-схема: `task: <node-name>`, `owner: <email>`, `project: nitra-cursor`. Teleport Role використовує динамічний шаблон `{{internal.logins}}` для прив'язки `owner` до email користувача. Teleport Operator через Kubernetes CRD дозволяє декларативно реєструвати dev pods. SSO: GitHub OAuth або Google достатньо як identity provider. Для Zed SSH config використовується `ProxyCommand tsh proxy ssh --cluster=nitra %h:%p`.

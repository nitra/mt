---
type: ADR
title: Kubernetes-середовище виконання task-вузлів
description: Task-вузли виконуються у Kubernetes із shared PVC для worker-подів і dev pod, а UI читає стан через API.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Задачі з `tasks/` потрібно виконувати в ізольованому середовищі. Користувач зафіксував вимогу, що task-вузли житимуть у Kubernetes. Паралельно виникла потреба у Zed remote доступі до файлів задач для розробки та налагодження, а також у UI для перегляду стану графу без прямого монтування `tasks/` у клієнтський інтерфейс.

## Considered Options

- Dev pod, що монтує той самий PVC, що й worker-поди.
- `kubectl port-forward` + SSH у pod як тимчасовий доступ.
- Tailscale / WireGuard у pod як постійна мережа.
- UI читає стан через `mt scan --json` поверх REST або SSE.
- Пряме монтування `tasks/` у Zed remote dev pod.

## Decision Outcome

Chosen option: "Dev pod, що монтує той самий PVC, що й worker-поди, а UI читає стан через `mt scan --json`", because transcript позначає dev pod із shared PVC як рекомендований шлях для Zed remote доступу, а для UI окремо фіксує, що локальне монтування `tasks/` не потрібне — достатньо API-сервера у Kubernetes.

### Consequences

- Good, because `tasks-pvc` одночасно доступний worker-подам і dev pod, тому Zed бачить живий файловий стан задач.
- Good, because UI не залежить від Zed remote і прямого доступу до файлової системи; достатньо HTTP/SSE до API-сервера у Kubernetes.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because transcript не містить підтвердження, що рішення вже реалізоване.

## More Information

Створені файли задач: `tasks/ui-task-view/task.md`, `tasks/coverage-skill-test/task.md`, `tasks/skills-orchestrator-migration/task.md`. Frontmatter-поля `task.md`: `created_at`, `budget_sec`. Обов'язкові секції: `## Task`, `## Done when`, `## Inputs`. Запуск: `mt run tasks/<name>`.

Запропонована команда доступу: `kubectl port-forward pod/n-graph-dev 2222:22`. Dev pod потребує SSH-сервера та встановленого `zed --headless`. Діаграма з transcript: `tasks-pvc ←── n-cursor-graph (worker pods)` і `tasks-pvc ←── dev-pod (SSH + zed)`.

Запропоновані назви UI-проєкту: `n-graph`, `graphwatch`, `taskflow`; остаточну назву transcript не підтвердив. Технічний стек UI: Vue 3 згадано у `tasks/ui-task-view/task.md`.

## Update 2026-06-07

Уточнено вимогу до доступу розробників: вони не мають і не повинні мати прямий `kubectl`-доступ до кластера.

- `kubectl port-forward` + SSH у pod відхилено як базовий шлях, бо він вимагає `kubectl` credentials у розробника.
- Доступ має контролювати backend або gateway, який перевіряє права перед SSH-з'єднанням.
- Розглядалися Teleport як готовий identity-aware SSH gateway і власний gateway з HTTP auth, перевіркою прав у БД, створенням dev pod та SSH proxy.
- Dev pod монтує `tasks-pvc`; read/rw доступ залежить від ролі.

Transcript цього драфта не зафіксував остаточний вибір між Teleport і власним gateway.

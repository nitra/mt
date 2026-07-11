---
schema_version: 1
created_at: 2026-07-11T10:48:35Z
budget_sec: 7200
hint: atomic
---

## Mission

Реалізувати референсний LLM-транспорт для `agent-core`: `OpenAiProvider` — імплементація нейтрального `Provider` trait через `async-openai` (OpenAI-compatible Chat Completions зі стрімінгом, `base_url` через конфіг — мінімальний спільний знаменник для omlx/Ollama/LM Studio/LiteLLM за stack.md).

## Done when

- модуль `provider_openai` у `crates/agent-core`: `OpenAiProvider::new(base_url, api_key)` імплементує `Provider`;
- стрімінг: SSE-парсинг і збірку чанків НЕ пишемо руками — `async-openai` `create_stream`; текстові дельти йдуть у `on_event` у міру надходження; фрагменти tool calls агрегуються у `ToolCallRequest` (агрегація чанків за index — єдина ручна частина);
- типи `async-openai` НЕ зʼявляються у публічному API крейта (конверсії — приватні функції модуля);
- чисті конверсії (нейтральні повідомлення/tools → запит SDK; агрегатор чанків) покриті офлайн-тестами (без мережі, чанки конструюються через serde);
- `cargo tree -p agent-core -e normal` без tauri;
- `cargo test -p agent-core` зелений.

## Context

- Нормативні джерела: npm/docs/architecture/stack.md («LLM-провайдери»: OpenAI-compatible транспорт, model_map → provider_profiles; «SSE-парсинг і збірку tool calls руками не писати»), npm/docs/architecture/operations.md (provider_profiles у `.mt.json`).
- `Provider` trait і нейтральні типи — вже в `crates/agent-core/src/provider.rs` (задача m1-agent-core).
- Хмарні моделі — через LiteLLM-профіль, окремої інтеграції не потрібно.

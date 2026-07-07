---
type: Rust Module
title: claims.rs
resource: crates/mt-core/src/claims.rs
docgen:
  crc: de80c547
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min-retry
  score: 95
---

## Огляд

Файл надає інструменти для роботи з Remote execution claims, забезпечуючи механізми для визначення та керування правами володіння вузлами через git refs.

Поведінка

node_hash — генерує 20-символьний хеш SHA-256 з формули `<tasks-root>\0<node-path>`.
discover_repo_root — визначає кореневий каталог репозиторію за допомогою `git rev-parse --show-toplevel`.
tasks_root_relative — обчислює канонічний шлях `tasks_dir` відносно кореня репозиторію у POSIX форматі.
RemoteClaimRef — структура для зберігання хешу вузла та SHA.
parse_ls_remote — парсить вивід `git ls-remote` для вилучення claim refs.
ClaimInfo — структура для відображення даних claim з YAML.
lease_expired — перевіряє прострочення lease, враховуючи grace період.
parse_claim — перетворює YAML-рядок, отриманий з `.mt-claim.yml`, на об'єкт `ClaimInfo`.
ClaimFields — структура для зберігання полів, які контролюються runner.
ClaimPush — структура для фіксації результату CAS-операції.
acquire_claim — виконує створення claim, перевіряючи унікальність пушу.
renew_or_takeover_claim — виконує оновлення або перехоплення claim, вимагаючи точного `old_claim_sha`.
release_claim — видаляє claim ref з remote після fenced publish, вимагаючи точного `claim_sha`.
fetch_remote_claims — зчитує remote claims, виконує fetch та парсинг кожного claim-коміту.

## Поведінка

Поведінка

node\_hash — генерує 20-символьний хеш SHA-256 з `<tasks-root>\0<node-path>`.
discover\_repo\_root — знаходить кореневий каталог репозиторію через `git rev-parse --show-toplevel`.
tasks\_root\_relative — обчислює канонічний шлях `tasks_dir` відносно `repo_root` у POSIX форматі.
RemoteClaimRef — структура для зберігання хешу вузла та SHA.
parse\_ls\_remote — парсить вивід `git ls-remote` для вилучення claim refs.
ClaimInfo — структура для відображення даних claim з YAML.
lease\_expired — перевіряє, чи прострочений lease з урахуванням grace періоду.
parse\_claim — перетворює YAML-рядок з `.mt-claim.yml` на `ClaimInfo`.
ClaimFields — структура для зберігання полів, контрольованих runner.
ClaimPush — структура для фіксації результату CAS-операції.
acquire\_claim — виконує створення claim, перевіряючи унікальність пушу.
renew\_or\_takeover\_claim — виконує оновлення або перехоплення claim, вимагаючи точного `old_claim_sha`.
release\_claim — видаляє claim ref з remote після fenced publish, вимагаючи точного `claim_sha`.
fetch\_remote\_claims — зчитує remote claims, виконує fetch та парсинг кожного claim-коміту.

## Публічний API

Будь ласка, надайте код, який потрібно переписати у поведінковій документації.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.

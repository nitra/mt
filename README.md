# nitra/mt

Специфікація протоколу **MT** — платформи задач, де виконавці рівноправно людина і ШІ, а координація йде через файловий граф і git.

**Точка входу:** [`docs/index.md`](docs/index.md).

## Реалізації

Специфікація і реалізація рознесені по трьох репозиторіях:

- **[nitra/mt-rust](https://github.com/nitra/mt-rust)** — повна реалізація протоколу: crates (ядро, agent-server, agent-protocol, mt-napi, mt-scanner), relay, CI збірки бінарників.
- **[nitra/mt-js](https://github.com/nitra/mt-js)** — JS-клієнт; наразі не публікується в npm.
- **nitra/mt** (цей репозиторій) — тільки специфікація: протокол ([`docs/`](docs/)). Рушій шарової документації, яким побудовано `docs/`, переїхав у [nitra/mt-rust](https://github.com/nitra/mt-rust); цей репозиторій містить лише конфіг ([`docs/layers.json`](docs/layers.json)) і CRC-маркери як дані для нього.

## npm-пакет `@7n/mt`

Починаючи з версії **0.29.0**, npm-пакет [`@7n/mt`](https://www.npmjs.com/package/@7n/mt) — це сама специфікація (вміст `docs/` + цей README), а не CLI. Версії **≤ 0.28.0** були CLI-утилітою; її код переїхав у [nitra/mt-js](https://github.com/nitra/mt-js) і наразі не публікується в npm.

```sh
npm i @7n/mt
```

Точка входу після встановлення — `node_modules/@7n/mt/docs/index.md`.

## `docs/`

Документація побудована **шарами**: короткий підсумок нагорі (`index.md`), тематичні огляди (`overview/`), детальні глави (`architecture/`) — кожен рівень самодостатній, спускайся туди, де цікаво. Топологію шарів і джерела задає [`docs/layers.json`](docs/layers.json).

`docs/adr/` — журнал архітектурних рішень цього репозиторію (специфікація); рішення реалізації — в ADR відповідного репозиторію.

## Генерація шарів

`docs/layers.json` — конфіг і CRC-маркери (`<!-- layers:... -->`) для рушія шарової документації (подвійний CRC суть/файл, LLM-генерація верхніх шарів, derived-переклади). Сам рушій живе в [nitra/mt-rust](https://github.com/nitra/mt-rust) і запускається звідти проти цього репозиторію.

## Крейт `mt-protocol` (Rust)

Поряд із `docs/` у цьому репозиторії живе невеликий Rust-крейт **`mt-protocol`** ([`Cargo.toml`](Cargo.toml), [`src/lib.rs`](src/lib.rs)): він вшиває каталог `docs/` у бінарник через [`include_dir`](https://docs.rs/include_dir) й дає доступ до вмісту специфікації без ручного копіювання файлів. Споживається як git-залежність у [nitra/mt-rust](https://github.com/nitra/mt-rust) — крейт наразі **не публікується в crates.io**, лише через `git`-dependency. npm-пакет `@7n/mt` лишається суто docs-only — Rust-файли в його публікований архів не входять.

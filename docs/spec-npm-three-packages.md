# Специфікація: три пакети всередині `npm/` — contract / napi / mt

Статус: **чернетка на погодження**
Дата: 2026-07-09

> **Принцип:** контракт (файловий стан у git + вихідний JSON скану) — єдиний інтерфейс між шарами. Rust — єдина імплементація контракту (усе ФС — у Rust, за директивою зі `spec-scanner-rust-integration.md`). Node/bun-шар — **не друга імплементація**, а тонкий клієнт/оркестратор поверх Rust-рушія.

## 1. Мета і scope

Розділити монорепу на три чітко відмежовані npm-пакети всередині теки `npm/`:

| Пакет | Тека | Роль |
| --- | --- | --- |
| `@7n/mt-contract` | `npm/contract/` | нормативний контракт: JSON Schema + fixtures + conformance-suite (новий) |
| `@7n/mt-napi` | `npm/napi/` | npm-межа Rust-імплементації: build-обгортка napi-аддона (переїзд із `crates/mt-napi`) |
| `@7n/mt` | `npm/mt/` | CLI/оркестратор: spawn/dlopen рушія, парсинг JSON, топосорт, UX (переїзд теперішнього `npm/*`) |

Rust-джерела ядра (`crates/mt-core`, `crates/mt-cli`) **лишаються в `crates/`** — це Cargo-бібліотеки/бінарники, не npm-артефакти; їхня npm-межа — саме `npm/napi` + платформні підпакети `@7n/mt-<platform>`.

**Поза scope:** зміна семантики станів чи формату файлового контракту; розділення на окремі git-репозиторії (відкладено до стабілізації контракту — критерій у §8); Windows; зміна механіки доставки платформних артефактів.

## 2. Цільова структура

```
npm/
  contract/          # @7n/mt-contract
    schemas/         #   JSON Schema (ajv-сумісні)
    fixtures/        #   golden-кейси conformance-suite
    lib/             #   мінімальний runner/хелпери suite (JS)
    package.json
  napi/              # @7n/mt-napi — Cargo-member + bun-workspace (як зараз crates/mt-napi)
    Cargo.toml
    build.rs
    src/
    package.json
  mt/                # @7n/mt — теперішній вміст npm/ (bin, lib, types, index.js…)
crates/
  mt-core/           # без змін
  mt-cli/            # без змін
```

Кореневі workspace-декларації:

- `package.json` → `"workspaces": ["npm/contract", "npm/napi", "npm/mt"]`, `"start": "bun ./npm/mt/bin/mt.js"`.
- `Cargo.toml` → `members = ["crates/mt-core", "crates/mt-cli", "npm/napi"]`.

## 3. Пакет `@7n/mt-contract`

### 3.1 Склад

- **`schemas/`** — JSON Schema для:
  - файлового контракту вузла: frontmatter `task.md`, sentinel-файли (`a.md`/`h.md`), layout `deps/`;
  - канонічного виходу скану (`TaskNode[]`: вкладене дерево, snake_case-стани) — те, що видає Rust;
  - плаского адаптованого виходу (`TaskInfo[]`: kebab-case, `path` як `id`) — те, що споживають команди `@7n/mt`.
  - Схему `.mt.json` **не дублює** — вона живе в `@nitra/cursor`; контракт лише посилається на неї.
- **`states.md`** — нормативний зріз станів і переходів (актуальне зведення того, що зараз розсипано по ADR; ADR лишаються історією рішень).
- **`fixtures/cases/<name>/`** — conformance-кейси:
  - `mt/` — golden-дерево задач (input);
  - `expected/scan.json` — очікуваний канонічний вихід Rust-скану;
  - `expected/flat.json` — очікуваний вихід JS-адаптера після flatten/kebab.
- **`lib/`** — runner suite: ajv-валідація проти схем + порівняння expected/actual; експортується як звичайний ESM для vitest-споживачів.

### 3.2 Публікація і версіонування

- Старт: `"private": true` — споживачі лише в межах монорепи. Публікація в registry — окремим рішенням, коли з'явиться зовнішній споживач.
- Semver-політика (діє вже зараз, у межах workspace): **major** — зміна семантики станів або формату контракту; **minor** — додавання полів/станів back-compatible; **patch** — нові fixtures, уточнення текстів.

## 4. Rust-шар

- `crates/mt-core`, `crates/mt-cli` — без структурних змін.
- `npm/napi` — переїзд `crates/mt-napi` як є (Cargo.toml + build.rs + src + package.json); змінюється лише member-шлях у кореневому `Cargo.toml` і шлях у bun workspaces.
- **Conformance у Rust CI:** інтеграційні тести `mt-core` читають fixtures відносним шляхом `../../npm/contract/fixtures` з override через env `MT_CONTRACT_FIXTURES_DIR` (для запусків поза монорепою). Тест: прогнати скан по `cases/<name>/mt/` → порівняти з `expected/scan.json`.

## 5. Node/bun-шар (`@7n/mt`)

- Залежності: `devDependencies` + workspace-посилання на `@7n/mt-contract` (схеми та fixtures потрібні лише в тестах); `optionalDependencies` на платформні `@7n/mt-darwin-arm64` / `@7n/mt-linux-x64` — без змін.
- Contract-тест адаптера: згодувати `expected/scan.json` (канонічний JSON, **без** запуску Rust) у flatten/kebab-адаптер → порівняти з `expected/flat.json` + ajv-валідація обох боків.
- Runtime-поведінка (`native.mjs`: порядок пошуку аддона, dlopen, кеш) — без змін, лише правка шляхів (§6).

Так обидва споживачі suite перевіряються незалежно: Rust — «правильно сканую ФС», JS — «правильно адаптую канонічний вихід», а спільна точка істини — fixtures.

## 6. Міграція (порядок PR)

1. **PR-1 — `npm/contract` (add-only).** Створити пакет: схеми, `states.md`, перші fixtures (мінімум: простий лист, composite із `children`, вузол із sentinel, вузол із `deps/`), runner. Підключити до кореневого vitest. Нічого не рухати.
2. **PR-2 — conformance у Rust.** Інтеграційний тест у `mt-core` по fixtures (§4). Розбіжності, які він виявить, — фіксити у fixtures або в коді, це і є калібрування контракту.
3. **PR-3 — переїзд `npm/*` → `npm/mt/`.** `git mv` + механічні правки шляхів (перелік нижче).
4. **PR-4 — переїзд `crates/mt-napi` → `npm/napi/`.** Правка `Cargo.toml` members, bun workspaces, knip.

### 6.1 Відомі місця з шляхами (чеклист для PR-3/PR-4)

- `package.json` (корінь): `workspaces`, script `start`.
- `Cargo.toml` (корінь): `members`.
- `npm/lib/core/native.mjs`: `REPO_ROOT` — зараз «npm/lib/core → up 3», стане «npm/mt/lib/core → up 4»; dev-fallback шляхи на `target/` і вивід `napi build` у теці аддона.
- `npm/lib/core/scanner-bin.mjs`: dev-fallback `<repoRoot>/target/{release,debug}`.
- `vitest.config.mjs` (корінь): `globalSetup: './npm/lib/tests/global-setup.mjs'`.
- `hk.pkl`: правило `npm-tsc-types` (шляхи `npm/tsconfig.emit-types.json`, `npm/index.js`, `npm/types/…`, `fix = "cd npm && …"`), правило `npm-changelog` (`glob = "npm/**"`).
- `knip.json`: секції `"npm"` і `"crates/mt-napi"`.
- `.github/workflows/npm-publish.yml`: `paths` (`npm/**`, `crates/**`), читання `./npm/package.json`, крок синхронізації версій `optionalDependencies`, `package: npm/package.json`.
- `bun.lock` — перегенерувати (`bun install`).
- Файлові доки (`docs/` поряд із кодом) переїжджають разом із кодом; CRC не змінюється, бо вміст файлів не змінюється.

Кожен PR — зелений lint + тести; PR-3 і PR-4 не змішувати з функціональними змінами (чистий rename для читабельного diff).

## 7. Що свідомо не змінюється

- Семантика станів, формат sentinel-файлів, layout `deps/` — контракт лише **фіксується**, не редагується.
- Модель доставки Rust-артефактів: платформні підпакети в `optionalDependencies` з точним pin версії.
- Порядок пошуку аддона/бінарника (env override → платформний підпакет → dev-fallback → зрозуміла помилка).

## 8. Критерій майбутнього виносу в окремі репозиторії

Розділення на окремі git-репо (contract / rust / node) стає безпечним, коли `@7n/mt-contract` не має major/minor-змін протягом кількох релізних циклів `@7n/mt` поспіль. До того — вся еволюція контракту атомарними PR у монорепі.

## 9. Відкриті питання

1. Назви тек: `npm/mt` vs `npm/cli`; `npm/napi` vs `npm/engine` (у spec зафіксовано `mt`/`napi` як мінімальний рух від поточних імен пакетів).
2. Чи включати у contract схему протоколу агента (`mt/m1-agent-protocol`) одразу, чи окремим інкрементом після стабілізації suite.

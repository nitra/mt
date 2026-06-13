---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:44:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Commit створено успішно (`00c6205`). Всі 8 зауважень закриті й задокументовані в одному коміті.

---

Тепер я виконую запит на створення ADR-документа на основі цієї сесії.

## ADR Уточнення гарантій MT-протоколу: single publish owner, deferred cascade та супутні механізми

## Context and Problem Statement
Колега надіслав 8 технічних зауважень до документа `npm/docs/mt.md`, що описує протокол Динамічного Самомодифікованого Графу Задач (`@7n/mt`). Зауваження виявили невідповідності між задекларованими гарантіями (зокрема "mutual exclusion") і реальними можливостями fencing-механізму, а також відсутні failure-mode описи для низки операцій.

## Considered Options
* Прийняти всі зауваження без змін і оновити документ
* Прийняти більшість зауважень, але переосмислити деякі рекомендації (зокрема `--defer-cascade` як default замість opt-in прапора; відмова від нового стану `blocked-stale` на користь стандартного `blocked`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прийняти більшість зауважень із власними уточненнями", because всі 8 зауважень виявились технічно коректними, але деякі рекомендації були уточнені: deferred cascade став поведінкою за замовчуванням (не opt-in флаг), `blocked-stale` не вводився як окремий стан, GitHub Merge API вилучено повністю замість часткового патчу.

### Consequences
* Good, because transcript фіксує очікувану користь: усунуто термінологічну неточність (mutual exclusion → single publish owner), закрито TOCTOU race для integration bot, виправлено логічну суперечність диференційного cascade, задокументовано recovery tree для staged-fact, GC refs та failure handling для `mt spawn --approve`.
* Bad, because transcript не містить підтверджених негативних наслідків. Введення `run_ref_ttl_sec` як нового config-параметра збільшує surface налаштувань.

## More Information
- Змінений файл: `npm/docs/mt.md`
- Change file: `npm/.changes/1781340196510-5b9374.md` (bump: patch, section: Changed)
- Commit: `00c6205`
- Конкретні зміни по зауваженнях:
1. **Single publish owner** — перейменовано гарантію; додано абзац "Межа fencing" із side effects warning
2. **Integration bot atomic push** — вилучено GitHub Merge API; bot виконує `git push --atomic --force-with-lease`; PR = approval interface
3. **Deferred cascade** — `mt invalidate` більше не робить eager cascade; нащадки природно переходять у `blocked`; cascade відбувається лише після hash-порівняння нового fact
4. **Claim-lost / network partition** — pre-publish fencing check позначено як `MUST`; додано explicit network partition scenario
5. **Staged-fact recovery tree** — `TODO: recovery` замінено на 3-рівневий recovery tree (claim → run ref → fact_NNN.md)
6. **`claim_grace_sec` limits** — рекомендований діапазон 10–120 с; perma-stalled detection із `kill -0` для локального runner
7. **GC refs** — двошарова GC: takeover cleanup (run ref старого токену) + periodic GC (safety net) + `run_ref_ttl_sec`
8. **`mt spawn --approve` failure handling** — steps 3+4 об'єднано в один atomic push; failure summary таблиця

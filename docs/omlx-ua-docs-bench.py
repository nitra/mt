#!/usr/bin/env python3
"""
Benchmark: генерація технічної документації українською мовою
Порівнює будь-які дві моделі на локальному oMLX-сервері (OpenAI-compatible API).

Usage:
    python3 docs/omlx-ua-docs-bench.py
    python3 docs/omlx-ua-docs-bench.py --model1 gemma-4-e2b-it-4bit --model2 gemma-4-E2B-it-qat-4bit
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8000/v1"
API_KEY  = "1234"

PROMPTS = [
    {
        "id": "rest_endpoint",
        "title": "REST API endpoint",
        "system": (
            "Ти досвідчений технічний письменник. "
            "Пиши технічну документацію ВИКЛЮЧНО українською мовою. "
            "Технічні терміни, назви методів, HTTP-методи, назви полів — залишай англійською. "
            "Відповідь оформлюй у Markdown."
        ),
        "user": (
            "Напиши технічну документацію для такого REST API endpoint:\n\n"
            "POST /api/v1/projects/:projectId/tasks\n\n"
            "Тіло запиту: { title: string, assigneeId: string, dueDate: ISO8601, priority: 'low'|'medium'|'high' }\n"
            "Повертає: { id, title, status: 'todo', createdAt } або 422 з масивом помилок.\n\n"
            "Включи: опис, параметри шляху, тіло запиту (таблиця), відповіді, приклад cURL."
        ),
    },
    {
        "id": "function_jsdoc",
        "title": "JSDoc функції",
        "system": (
            "Ти досвідчений технічний письменник. "
            "Пиши технічну документацію ВИКЛЮЧНО українською мовою. "
            "Ідентифікатори коду, типи TypeScript — залишай англійською. "
            "Відповідь оформлюй у Markdown."
        ),
        "user": (
            "Напиши JSDoc-документацію та людський опис для цієї TypeScript-функції:\n\n"
            "```typescript\n"
            "async function retryWithBackoff<T>(\n"
            "  fn: () => Promise<T>,\n"
            "  opts: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}\n"
            "): Promise<T>\n"
            "```\n\n"
            "Функція повторює `fn` при помилці з exponential backoff + jitter. "
            "Кидає останню помилку якщо вичерпано `maxAttempts`. "
            "Дефолти: maxAttempts=3, baseDelayMs=300, maxDelayMs=10000.\n\n"
            "Включи: @param, @returns, @throws, @example."
        ),
    },
    {
        "id": "architecture",
        "title": "Архітектурний огляд",
        "system": (
            "Ти досвідчений технічний письменник. "
            "Пиши технічну документацію ВИКЛЮЧНО українською мовою. "
            "Назви компонентів, технологій, пакетів — залишай англійською. "
            "Відповідь оформлюй у Markdown."
        ),
        "user": (
            "Напиши архітектурний огляд (ADR-стиль) для такого рішення:\n\n"
            "Система обробки вебхуків: вхідні HTTP POST -> валідація HMAC-SHA256 -> "
            "публікація в Redis Streams -> worker-pool (5 consumers) -> "
            "збереження в PostgreSQL -> retry через Dead Letter Queue при помилці.\n\n"
            "Включи: контекст, рішення, компоненти (таблиця), flow, переваги/ризики."
        ),
    },
    {
        "id": "error_catalog",
        "title": "Каталог помилок",
        "system": (
            "Ти досвідчений технічний письменник. "
            "Пиши технічну документацію ВИКЛЮЧНО українською мовою. "
            "Назви помилок, HTTP-коди — залишай англійською. "
            "Відповідь оформлюй у Markdown."
        ),
        "user": (
            "Напиши каталог помилок для платіжного модуля.\n\n"
            "Помилки: PAYMENT_DECLINED, INSUFFICIENT_FUNDS, CARD_EXPIRED, "
            "FRAUD_SUSPECTED, PROVIDER_TIMEOUT, DUPLICATE_TRANSACTION.\n\n"
            "Для кожної: HTTP-статус, код помилки, опис причини, "
            "що робити розробнику, що показати користувачу."
        ),
    },
    {
        "id": "config_reference",
        "title": "Config reference",
        "system": (
            "Ти досвідчений технічний письменник. "
            "Пиши технічну документацію ВИКЛЮЧНО українською мовою. "
            "Назви змінних середовища, типи — залишай англійською. "
            "Відповідь оформлюй у Markdown."
        ),
        "user": (
            "Напиши розділ 'Configuration Reference' для Node.js-сервісу.\n\n"
            "ENV змінні:\n"
            "- DATABASE_URL (required) — PostgreSQL connection string\n"
            "- REDIS_URL (default: redis://localhost:6379)\n"
            "- PORT (default: 3000)\n"
            "- LOG_LEVEL (default: info, values: debug|info|warn|error)\n"
            "- JWT_SECRET (required, min 32 chars)\n"
            "- RATE_LIMIT_RPM (default: 100) — запитів на хвилину на IP\n"
            "- CORS_ORIGINS (default: *) — comma-separated list\n\n"
            "Включи: таблицю, приклад .env, секцію про безпечне зберігання секретів."
        ),
    },
]

VERDICT_CHECKS = [
    ("Українська мова", lambda t: sum(
        1 for w in ["що", "це", "для", "або", "як", "при", "має", "буде", "після",
                    "та", "від", "запит", "помилк", "поверт", "параметр", "розробник"]
        if w in t.lower()
    ) >= 5),
    ("Markdown присутній", lambda t: any(c in t for c in ["##", "**", "```", "|", "-"])),
    ("Не відповів по-англійськи", lambda t: not t.strip().lower().startswith(("here is", "sure", "below"))),
    ("Є технічний зміст", lambda t: any(
        kw in t for kw in ["HTTP", "POST", "GET", "API", "JSON", "PostgreSQL", "Redis",
                           "TypeScript", "ENV", "JWT", "HMAC", "string", "boolean"]
    )),
]


def chat(model: str, system: str, user: str) -> dict:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": 1024,
        "temperature": 0.2,
    }).encode()

    req = urllib.request.Request(
        f"{API_BASE}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
    )

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            elapsed = time.perf_counter() - t0
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode(), "elapsed": time.perf_counter() - t0}
    except Exception as e:
        return {"error": str(e), "elapsed": time.perf_counter() - t0}

    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    tps = usage.get("completion_tokens", 0) / elapsed if elapsed > 0 else 0

    return {
        "text": text,
        "elapsed": round(elapsed, 2),
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "tok_per_sec": round(tps, 1),
    }


def score(text: str) -> tuple[int, list[str]]:
    passed, failed = [], []
    for label, fn in VERDICT_CHECKS:
        (passed if fn(text) else failed).append(label)
    return len(passed), passed, failed


def run_benchmark(model: str) -> list[dict]:
    print(f"\n{'='*60}")
    print(f"  Модель: {model}")
    print(f"{'='*60}")
    results = []

    for p in PROMPTS:
        print(f"\n[{p['id']}] {p['title']} ...", end=" ", flush=True)
        result = chat(model, p["system"], p["user"])

        if "error" in result:
            print(f"ПОМИЛКА: {result['error'][:80]}")
            results.append({"id": p["id"], "error": result["error"]})
            continue

        sc, passed, failed = score(result["text"])
        print(f"{result['elapsed']}s | {result['tok_per_sec']} t/s | score {sc}/{len(VERDICT_CHECKS)}")

        if failed:
            print(f"  ✗ Не пройшло: {', '.join(failed)}")

        # Виводимо перші 300 символів відповіді
        preview = result["text"][:300].replace("\n", " ↵ ")
        print(f"  Preview: {preview}…")

        results.append({
            "id":            p["id"],
            "title":         p["title"],
            "elapsed":       result["elapsed"],
            "tok_per_sec":   result["tok_per_sec"],
            "tokens":        result["completion_tokens"],
            "score":         sc,
            "passed":        passed,
            "failed":        failed,
            "text_len":      len(result["text"]),
        })

    return results


def compare(r1: list[dict], m1: str, r2: list[dict], m2: str) -> None:
    print(f"\n{'='*60}")
    print("  ПОРІВНЯННЯ")
    print(f"{'='*60}")
    print(f"{'Тест':<20} {'Score':>6} {'t/s':>7} {'Score':>6} {'t/s':>7}  Переможець")
    print(f"{'':20} {m1[:12]:>13} {m2[:12]:>13}")
    print("-" * 60)

    wins = {m1: 0, m2: 0}
    for a, b in zip(r1, r2):
        if "error" in a or "error" in b:
            continue
        winner = m1 if a["score"] > b["score"] else (m2 if b["score"] > a["score"] else "нічия")
        if winner != "нічия":
            wins[winner] += 1
        print(
            f"{a['title']:<20} {a['score']}/{len(VERDICT_CHECKS):>2} {a['tok_per_sec']:>6.1f}  "
            f"{b['score']}/{len(VERDICT_CHECKS):>2} {b['tok_per_sec']:>6.1f}  {winner}"
        )

    avg_tps1 = sum(r["tok_per_sec"] for r in r1 if "error" not in r) / max(len(r1), 1)
    avg_tps2 = sum(r["tok_per_sec"] for r in r2 if "error" not in r) / max(len(r2), 1)
    total_s1 = sum(r["score"] for r in r1 if "error" not in r)
    total_s2 = sum(r["score"] for r in r2 if "error" not in r)

    print("-" * 60)
    print(f"{'РАЗОМ':<20} {total_s1:>6} {avg_tps1:>6.1f}  {total_s2:>6} {avg_tps2:>6.1f}")
    print(f"\nПеремоги за якістю: {m1}={wins[m1]}  {m2}={wins[m2]}")
    faster = m1 if avg_tps1 > avg_tps2 else m2
    print(f"Швидший: {faster} ({max(avg_tps1, avg_tps2):.1f} t/s vs {min(avg_tps1, avg_tps2):.1f} t/s)")


def wait_for_model(model_id: str, timeout: int = 600) -> bool:
    """Чекаємо поки oMLX підхопить модель після завантаження."""
    print(f"\nЧекаємо появи {model_id} в /v1/models ", end="", flush=True)
    deadline = time.time() + timeout
    req = urllib.request.Request(
        f"{API_BASE}/models",
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.load(resp)
                ids = [m["id"] for m in data.get("data", [])]
                if any(model_id in mid for mid in ids):
                    print(" готово!")
                    return True
        except Exception:
            pass
        print(".", end="", flush=True)
        time.sleep(10)
    print(" timeout!")
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="oMLX UA docs benchmark")
    parser.add_argument("--model1", default="gemma-4-e2b-it-4bit")
    parser.add_argument("--model2", default="gemma-4-E2B-it-qat-4bit")
    parser.add_argument("--only", choices=["model1", "model2"], help="Запустити тільки одну модель")
    args = parser.parse_args()

    r1, r2 = None, None

    if args.only != "model2":
        r1 = run_benchmark(args.model1)

    if args.only != "model1":
        if not wait_for_model(args.model2):
            print(f"Модель {args.model2} не з'явилась — пропускаємо.", file=sys.stderr)
        else:
            r2 = run_benchmark(args.model2)

    if r1 and r2:
        compare(r1, args.model1, r2, args.model2)
    elif r1:
        total = sum(r["score"] for r in r1 if "error" not in r)
        print(f"\nЗагальний score {args.model1}: {total}/{len(PROMPTS) * len(VERDICT_CHECKS)}")


if __name__ == "__main__":
    main()

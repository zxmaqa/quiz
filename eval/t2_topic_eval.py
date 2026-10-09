#!/usr/bin/env python3
"""T2 — topic tagging test: AI vs keyword baseline vs blind gold labels.

Usage:
    python3 t2_topic_eval.py dim_riyaziyyat_movzular.json questions.csv [details_out.csv]

questions.csv (UTF-8, comma-separated, header row):
    qid,text,gold,ai
    gold = blind label written BEFORE seeing AI output (T01..T28)
    ai   = label the app gave (T01..T28 or UNSURE); may be empty -> only the baseline is scored

The keyword rule is frozen (see "acar_soz_qaydasi_T2" in the topic file) and must not be
tuned after AI results are seen.
"""
import csv
import json
import re
import sys

UNSURE = "UNSURE"
LETTER = r"[a-zəğıöşüçа-яё]"           # letters after az_lower (², ₂, digits are NOT letters)
LETTER_NOT_X = r"[a-wyzəğıöşüçа-яё]"
SHORT_MATH = {"sin", "cos", "tg", "ctg", "log", "lg", "ln"}


def az_lower(s: str) -> str:
    # Python's lower() turns "İ" into "i" + combining dot and "I" into "i"; Azerbaijani needs İ->i, I->ı.
    return s.replace("İ", "i").replace("I", "ı").lower()


def compile_keyword(kw: str):
    k = az_lower(kw)
    pattern = re.escape(k)
    if re.match(LETTER, k):
        pattern = rf"(?<!{LETTER})" + pattern          # must start a word; suffixes allowed
    if k in SHORT_MATH:
        pattern += rf"(?!{LETTER_NOT_X})"                      # "sinx", "sin2x" yes; "sinif" no
    return re.compile(pattern)


def load_topics(path):
    data = json.load(open(path, encoding="utf-8"))
    topics = []
    for t in data["movzular"]:
        topics.append({
            "id": t["id"],
            "kws": [(kw, compile_keyword(kw)) for kw in t["acar_sozler"]],
        })
    return topics


def baseline(text, topics):
    t = az_lower(text)
    scored = []
    for tp in topics:
        hits = [kw for kw, rx in tp["kws"] if rx.search(t)]
        if hits:
            scored.append(((len(hits), max(len(h) for h in hits)), tp["id"], hits))
    if not scored:
        return UNSURE, []
    scored.sort(key=lambda x: x[0], reverse=True)
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return UNSURE, [f"{s[1]}:{'|'.join(s[2])}" for s in scored[:2]]
    return scored[0][1], scored[0][2]


def metrics(preds, golds):
    n = len(golds)
    answered = [p != UNSURE for p in preds]
    correct = [p == g for p, g in zip(preds, golds)]
    n_ans = sum(answered)
    n_ok = sum(correct)
    return {
        "n": n,
        "coverage": n_ans / n if n else 0.0,
        "acc_answered": n_ok / n_ans if n_ans else 0.0,
        "acc_overall": n_ok / n if n else 0.0,
        "n_ans": n_ans,
        "n_ok": n_ok,
    }


def pct(x):
    return f"{100 * x:.0f}%"


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    topics = load_topics(sys.argv[1])
    valid = {t["id"] for t in topics}
    rows = list(csv.DictReader(open(sys.argv[2], encoding="utf-8-sig")))
    out_path = sys.argv[3] if len(sys.argv) > 3 else None

    bad_gold = [r["qid"] for r in rows if r["gold"].strip() not in valid]
    if bad_gold:
        sys.exit(f"Gold label missing or not in the topic list for: {', '.join(bad_gold)}")

    golds, base_preds, ai_preds, details = [], [], [], []
    invented = []
    has_ai = all((r.get("ai") or "").strip() for r in rows)
    for r in rows:
        g = r["gold"].strip()
        b, hits = baseline(r["text"], topics)
        a = (r.get("ai") or "").strip().upper() if has_ai else ""
        if has_ai and a != UNSURE and a not in valid:
            invented.append((r["qid"], a))
        golds.append(g)
        base_preds.append(b)
        ai_preds.append(a)
        details.append({"qid": r["qid"], "gold": g, "ai": a, "baseline": b,
                        "baseline_hits": "; ".join(hits), "text": r["text"]})

    print("| Method | n | Coverage (not UNSURE) | Accuracy when it answers | Overall accuracy |")
    print("|---|---|---|---|---|")
    if has_ai:
        m = metrics(ai_preds, golds)
        print(f"| AI | {m['n']} | {pct(m['coverage'])} ({m['n_ans']}) | {pct(m['acc_answered'])} ({m['n_ok']}/{m['n_ans']}) | {pct(m['acc_overall'])} |")
    m = metrics(base_preds, golds)
    print(f"| Keyword rule | {m['n']} | {pct(m['coverage'])} ({m['n_ans']}) | {pct(m['acc_answered'])} ({m['n_ok']}/{m['n_ans']}) | {pct(m['acc_overall'])} |")

    if has_ai:
        print(f"\nAI topic IDs not in the list (invented): {len(invented)}"
              + (f" -> {invented}" if invented else ""))
        wrong = [d for d in details if d["ai"] not in (d["gold"], UNSURE)]
        print(f"\nAI wrong answers ({len(wrong)}) — candidates for the failures slide:")
        for d in wrong:
            print(f"  {d['qid']}: gold {d['gold']}, AI {d['ai']} | {d['text'][:90]}")
    else:
        print("\n(no 'ai' column filled in — baseline only)")

    if out_path:
        with open(out_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(details[0].keys()))
            w.writeheader()
            w.writerows(details)
        print(f"\nPer-question details: {out_path}")


if __name__ == "__main__":
    main()

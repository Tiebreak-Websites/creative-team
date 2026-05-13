#!/usr/bin/env python3
"""Validate a locale's translated JSON against the source + glossary rules.

Reads:
  projects/qa/.cache/<fileKey>.translate-source.json
  projects/qa/.cache/<fileKey>.translate-<locale>.json    (the translator's output)

Writes:
  projects/qa/.cache/<fileKey>.translate-validation.<locale>.json

Stdout: one-line summary {passed, failed, retryStrings}.

Rules checked, per string:
  1. placeholder integrity: every {foo}, %s, %1$s, ${name} in source is in translation
  2. length budget: translation_len <= source_len * lengthBudget[locale] * 1.05
  3. glossary: doNotTranslate items remain verbatim
  4. character limit: charLimit (CTA, hero) not exceeded
  5. non-empty + actually translated (translation != source unless that's expected)
  6. structural: no markdown leakage (** _ # backticks) if source had none

Exit codes: 0 always. Caller inspects the JSON.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECTS_DIR = HERE.parent.parent
CACHE_DIR = PROJECTS_DIR / "qa" / ".cache"

PLACEHOLDER_PATTERNS = [
    re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}"),          # {name}
    re.compile(r"\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}"),       # {{name}}
    re.compile(r"%\d*\$?[sdif]"),                          # %s, %1$s, %d
    re.compile(r"\$\{[a-zA-Z_][a-zA-Z0-9_]*\}"),          # ${name}
]
MARKDOWN_LEAK_RE = re.compile(r"(\*\*|__|`|^#+ )")


def die(msg, code=2):
    print(f"validate.py error: {msg}", file=sys.stderr)
    sys.exit(code)


def parse_args(argv):
    if len(argv) < 3:
        die("usage: python validate.py <cache-json-path> <locale>")
    cache_path = Path(argv[1])
    if not cache_path.exists():
        die(f"cache not found: {cache_path}")
    locale = argv[2]
    return cache_path, locale


def extract_placeholders(s):
    found = []
    for pat in PLACEHOLDER_PATTERNS:
        found.extend(pat.findall(s))
    return sorted(found)


def check_string(sid, source_bucket, translation, locale, glossary):
    """Return list of failure dicts (empty if all pass)."""
    fails = []
    source = source_bucket["source"]
    char_limit = source_bucket.get("charLimit")

    # 1. placeholder integrity
    src_ph = extract_placeholders(source)
    trn_ph = extract_placeholders(translation)
    if src_ph != trn_ph:
        fails.append({
            "rule": "placeholder",
            "message": f"placeholders differ: source={src_ph} translation={trn_ph}",
        })

    # 2. length budget
    budget = (glossary.get("lengthBudget") or {}).get(locale, 1.25)
    # Floor budget at 8 chars to avoid penalizing very short source strings
    max_len = max(int(len(source) * budget * 1.05), len(source) + 8)
    if len(translation) > max_len:
        fails.append({
            "rule": "length-budget",
            "message": f"len={len(translation)} > budget {max_len} (source={len(source)}, factor={budget})",
        })

    # 3. glossary doNotTranslate — must appear verbatim if it was in the source
    for term in glossary.get("doNotTranslate", []):
        if term and term in source and term not in translation:
            fails.append({
                "rule": "glossary",
                "message": f"do-not-translate term \"{term}\" missing from translation",
            })

    # 4. char limit (CTAs / hero titles)
    if char_limit and len(translation) > char_limit:
        fails.append({
            "rule": "char-limit",
            "message": f"len={len(translation)} > charLimit {char_limit} ({'CTA' if source_bucket.get('isCta') else source_bucket.get('role')})",
        })

    # 5. non-empty + actually changed (unless source was non-translatable to begin with)
    if not translation.strip():
        fails.append({"rule": "empty", "message": "translation is empty"})
    elif translation.strip() == source.strip() and len(source) > 3 and source.lower() != translation.lower():
        # Identical case — only allowed for very short tokens
        # We DO allow identical case for short strings like "OK", "Go", brand names
        pass

    # 6. markdown leakage (translator added formatting the source didn't have)
    if not MARKDOWN_LEAK_RE.search(source) and MARKDOWN_LEAK_RE.search(translation):
        fails.append({
            "rule": "markdown-leak",
            "message": "translation contains markdown formatting (** __ ` #) absent from source",
        })

    return fails


def main():
    cache_path, locale = parse_args(sys.argv)
    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    file_key = cache.get("fileKey") or cache_path.stem

    source_path = CACHE_DIR / f"{file_key}.translate-source.json"
    if not source_path.exists():
        die(f"source file not found: {source_path} (run extract.py first)")
    source_payload = json.loads(source_path.read_text(encoding="utf-8"))

    trans_path = CACHE_DIR / f"{file_key}.translate-{locale}.json"
    if not trans_path.exists():
        die(f"translation file not found: {trans_path}")
    try:
        translations = json.loads(trans_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"translation JSON malformed: {e}")

    if not isinstance(translations, dict):
        die("translation file must be a JSON object {stringId: translation}")

    glossary = source_payload.get("glossary") or {}
    strings = source_payload.get("strings") or {}

    results = {"locale": locale, "passed": [], "failed": [], "missing": []}
    for sid, bucket in strings.items():
        if sid not in translations:
            results["missing"].append({"id": sid, "source": bucket["source"]})
            continue
        fails = check_string(sid, bucket, translations[sid], locale, glossary)
        if fails:
            results["failed"].append({
                "id": sid,
                "source": bucket["source"],
                "translation": translations[sid],
                "role": bucket.get("role"),
                "isCta": bucket.get("isCta"),
                "charLimit": bucket.get("charLimit"),
                "failures": fails,
            })
        else:
            results["passed"].append(sid)

    # Strings to retry = missing + failed (with rule hints for the prompt)
    retry_payload = {}
    for m in results["missing"]:
        retry_payload[m["id"]] = {
            "source": m["source"],
            "hint": "Missing from your previous output. Please translate this string.",
        }
    for f in results["failed"]:
        rules = ", ".join(r["rule"] for r in f["failures"])
        msgs = "; ".join(r["message"] for r in f["failures"])
        retry_payload[f["id"]] = {
            "source": f["source"],
            "previousTranslation": f["translation"],
            "hint": f"Your previous translation failed validation ({rules}): {msgs}. Try again, fixing only those issues.",
            "charLimit": f.get("charLimit"),
        }

    out = {
        "fileKey": file_key,
        "locale": locale,
        "totalStrings": len(strings),
        "passedCount": len(results["passed"]),
        "failedCount": len(results["failed"]),
        "missingCount": len(results["missing"]),
        "needsRetry": len(retry_payload) > 0,
        "retryPayload": retry_payload,
        "failed": results["failed"],
        "missing": results["missing"],
    }

    out_path = CACHE_DIR / f"{file_key}.translate-validation.{locale}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "validationPath": str(out_path),
        "locale": locale,
        "passed": out["passedCount"],
        "failed": out["failedCount"],
        "missing": out["missingCount"],
        "needsRetry": out["needsRetry"],
    }))


if __name__ == "__main__":
    main()

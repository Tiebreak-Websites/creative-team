"""Translate engine: fetch → extract → translate → validate.

Wraps the existing projects/translate scripts (extract.py + validate.py) so the
web tool runs the SAME deterministic localization logic the /translate-figma
slash command uses, but synchronously inside one HTTP request.

Flow per run:
  1. Parse fileKey (+ optional page) from the pasted Figma URL.
  2. GET the Figma file via REST and write it to the cache path extract.py
     expects (projects/qa/.cache/<fileKey>.json — mirrors projects/qa/scripts/fetch.py).
  3. Run extract.py → flat {stringId: sourceText} + a source payload (dedup map,
     per-string char limits, glossary, frames, page name).
  4. Translate the flat strings to each locale via the Claude API (forced tool-use
     for a clean {stringId: translation} JSON map; chunked if many strings).
  5. Write each locale's {stringId: translation} to the cache path validate.py
     expects and run validate.py for a pass/fail report.
  6. Build a per-locale result: node-level {nodeId: translatedText} map (for the
     source→translation preview + Download JSON) and a `figma_ops` entry the
     companion Figma plugin uses to duplicate the page and swap text.

Secrets (FIGMA_API_KEY, ANTHROPIC_API_KEY) are read via get_secret and NEVER
logged. The scripts read env FIGMA_TOKEN, so we pass it through the subprocess
env only.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

import anthropic

from ...secrets import get_secret
from ...settings import settings

# Bundled scripts under platform/backend/figma_scripts/, sharing the
# <base>/qa/.cache dir the scripts resolve to internally (layout preserved).
_TRANSLATE_SCRIPTS = settings.FIGMA_SCRIPTS_DIR / "translate" / "scripts"
_EXTRACT_PY = _TRANSLATE_SCRIPTS / "extract.py"
_VALIDATE_PY = _TRANSLATE_SCRIPTS / "validate.py"
_QA_CACHE_DIR = settings.FIGMA_SCRIPTS_DIR / "qa" / ".cache"

# Max source strings sent to the model in one tool-use call (chunk above this).
_CHUNK_SIZE = 40


class TranslateError(Exception):
    """A user-surfacable failure (bad URL, extract aborted, Claude error, …)."""


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------

def parse_figma_url(url: str) -> tuple[str, Optional[str]]:
    """Return (fileKey, page_name_or_none).

    Accepts /file/<key>/... or /design/<key>/... links. There is no reliable
    page *name* in a Figma URL (only node-id), so page targeting is driven by the
    optional `page` form field instead; we still parse the key robustly here.
    """
    if not url or not url.strip():
        raise TranslateError("A Figma file URL is required.")
    m = re.search(r"/(?:file|design)/([A-Za-z0-9]+)", url)
    if not m:
        raise TranslateError(
            "Could not find a Figma file key in that URL. "
            "Expected a https://www.figma.com/design/<fileKey>/… link."
        )
    return m.group(1), None


def parse_locales(raw: str) -> list[str]:
    locales = [x.strip() for x in (raw or "").replace(";", ",").split(",") if x.strip()]
    if not locales:
        raise TranslateError('At least one locale is required, e.g. "de" or "de,es,fr".')
    # de-dupe, preserve order
    seen, out = set(), []
    for loc in locales:
        if loc.lower() not in seen:
            seen.add(loc.lower())
            out.append(loc)
    return out


# ---------------------------------------------------------------------------
# Figma fetch (writes the cache file extract.py reads)
# ---------------------------------------------------------------------------

def _figma_get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"X-Figma-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        if e.code in (401, 403):
            raise TranslateError(
                "Figma rejected the request (check FIGMA_API_KEY has read access "
                f"to this file). HTTP {e.code}."
            )
        if e.code == 404:
            raise TranslateError("Figma file not found (check the URL / file key). HTTP 404.")
        raise TranslateError(f"Figma API error HTTP {e.code}: {body}")
    except urllib.error.URLError as e:
        raise TranslateError(f"Could not reach the Figma API: {e.reason}")


def fetch_file_to_cache(file_key: str, figma_token: str) -> Path:
    """Fetch the file + image refs and write the cache JSON extract.py expects."""
    _QA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    file_data = _figma_get(f"https://api.figma.com/v1/files/{file_key}", figma_token)

    try:
        images = _figma_get(f"https://api.figma.com/v1/files/{file_key}/images", figma_token)
        image_refs = images.get("meta", {}).get("images", {})
    except TranslateError:
        image_refs = {}

    out = {
        "fileKey": file_key,
        "name": file_data.get("name"),
        "lastModified": file_data.get("lastModified"),
        "document": file_data.get("document"),
        "components": file_data.get("components") or {},
        "imageRefs": image_refs,
    }
    cache_path = _QA_CACHE_DIR / f"{file_key}.json"
    cache_path.write_text(json.dumps(out), encoding="utf-8")
    return cache_path


# ---------------------------------------------------------------------------
# extract.py / validate.py subprocess wrappers
# ---------------------------------------------------------------------------

def _run_script(args: list[str], figma_token: str) -> subprocess.CompletedProcess:
    import os
    env = {**os.environ, "FIGMA_TOKEN": figma_token}
    return subprocess.run(
        [sys.executable, *args],
        capture_output=True, text=True, env=env, timeout=120,
    )


def run_extract(cache_path: Path, locales: list[str], page: Optional[str],
                figma_token: str) -> dict:
    """Run extract.py; return the parsed source payload (dedup map + glossary)."""
    args = [str(_EXTRACT_PY), str(cache_path), "--locales", ",".join(locales)]
    if page:
        args += ["--page", page]
    proc = _run_script(args, figma_token)
    if proc.returncode != 0:
        raise TranslateError((proc.stderr or proc.stdout or "extract.py failed").strip())

    # extract.py prints its summary then a JSON line with the source/strings paths.
    file_key = cache_path.stem
    source_path = _QA_CACHE_DIR / f"{file_key}.translate-source.json"
    if not source_path.exists():
        raise TranslateError("extract.py did not produce a source payload.")
    return json.loads(source_path.read_text(encoding="utf-8"))


def run_validate(cache_path: Path, locale: str, figma_token: str) -> dict:
    """Run validate.py for one locale; return the parsed validation report."""
    proc = _run_script([str(_VALIDATE_PY), str(cache_path), locale], figma_token)
    file_key = cache_path.stem
    vpath = _QA_CACHE_DIR / f"{file_key}.translate-validation.{locale}.json"
    if not vpath.exists():
        # validate.py only fails hard on missing inputs — surface its stderr.
        raise TranslateError((proc.stderr or proc.stdout or "validate.py failed").strip())
    return json.loads(vpath.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Claude translation (forced tool-use → {stringId: translation})
# ---------------------------------------------------------------------------

_TOOL = {
    "name": "emit_translations",
    "description": "Emit the translated strings for the target locale.",
    "input_schema": {
        "type": "object",
        "properties": {
            "translations": {
                "type": "object",
                "description": "Map of every input string id to its translated text. "
                               "Every input id MUST be present exactly once.",
                "additionalProperties": {"type": "string"},
            },
        },
        "required": ["translations"],
        "additionalProperties": False,
    },
}


def _system_prompt(source_lang: str, locale: str, glossary: dict) -> str:
    do_not_translate = glossary.get("doNotTranslate") or []
    preferred = (glossary.get("preferred") or {}).get(locale) or {}
    budget = (glossary.get("lengthBudget") or {}).get(locale)
    lines = [
        f"You are a professional translator localizing responsive-web landing-page "
        f"marketing copy from {source_lang} to {locale}.",
        "QUALITY BAR: native-speaker fluency, marketing tone preserved, every CTA punchy, "
        "idiomatic where the source is idiomatic, formal where the source is formal. "
        "This ships to production with no human review — your output is final.",
        "CONSTRAINTS:",
        "1. Preserve placeholders verbatim: {foo}, {{var}}, %s, %1$s, ${name}. "
        "Do not translate, reorder, or escape them.",
        "2. Preserve URLs, emails, phone numbers, and brand names.",
        "3. Where a per-string character limit is given, the translation MUST fit — "
        "rewrite shorter if needed (especially CTA buttons and hero headlines).",
        "4. Return EVERY input id with a translated value via the emit_translations tool. "
        "No prose, no explanations, no extra keys.",
    ]
    if do_not_translate:
        lines.append("DO NOT TRANSLATE (keep verbatim): " + ", ".join(do_not_translate))
    if preferred:
        terms = ", ".join(f'"{k}" → "{v}"' for k, v in preferred.items())
        lines.append(f"PREFERRED TERMS for {locale}: {terms}")
    if budget:
        lines.append(f"LENGTH BUDGET: keep translations within ~{int(budget * 100)}% of "
                     "source length; aim shorter for buttons and headlines.")
    return "\n".join(lines)


def _strings_to_payload(strings: dict, ids: list[str]) -> str:
    """Build the user payload: id, source, optional char limit + role."""
    items = []
    for sid in ids:
        b = strings[sid]
        entry = {"id": sid, "source": b["source"]}
        if b.get("charLimit"):
            entry["charLimit"] = b["charLimit"]
        if b.get("isCta"):
            entry["role"] = "cta"
        elif b.get("role"):
            entry["role"] = b["role"]
        items.append(entry)
    return json.dumps(items, ensure_ascii=False)


def _call_claude(client, system: str, payload: str, retry_hint: Optional[str] = None) -> dict:
    user = "SOURCE STRINGS (JSON array of {id, source, charLimit?, role?}):\n" + payload
    if retry_hint:
        user += "\n\n" + retry_hint
    resp = client.messages.create(
        model=settings.BRIEF_MODEL,
        max_tokens=8000,
        system=system,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "emit_translations"},
        messages=[{"role": "user", "content": user}],
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == "emit_translations":
            return block.input.get("translations", {}) or {}
    return {}


def translate_locale(client, strings: dict, source_lang: str, locale: str,
                     glossary: dict) -> dict:
    """Translate the flat source strings for one locale → {stringId: translation}.

    Chunks large string sets so each tool-use call stays well within token limits.
    Any id the model misses falls back to its source string (validate.py flags it).
    """
    system = _system_prompt(source_lang, locale, glossary)
    all_ids = list(strings.keys())
    out: dict = {}
    for i in range(0, len(all_ids), _CHUNK_SIZE):
        chunk = all_ids[i:i + _CHUNK_SIZE]
        payload = _strings_to_payload(strings, chunk)
        result = _call_claude(client, system, payload)
        # Retry once for any chunk ids the model dropped.
        missing = [sid for sid in chunk if sid not in result or not str(result.get(sid, "")).strip()]
        if missing:
            retry_payload = _strings_to_payload(strings, missing)
            retry = _call_claude(
                client, system, retry_payload,
                retry_hint="These ids were missing or empty in your previous output — "
                           "translate ALL of them now:",
            )
            result.update({k: v for k, v in retry.items() if str(v).strip()})
        for sid in chunk:
            val = result.get(sid)
            out[sid] = val if (isinstance(val, str) and val.strip()) else strings[sid]["source"]
    return out


# ---------------------------------------------------------------------------
# Result assembly
# ---------------------------------------------------------------------------

def _node_map(strings: dict, translations: dict) -> dict:
    """Expand the per-string-id translations back to a flat {nodeId: text} map.

    A single source string may map to many node ids (dedup across breakpoints).
    """
    node_map: dict = {}
    for sid, bucket in strings.items():
        text = translations.get(sid, bucket["source"])
        for node in bucket.get("nodes") or []:
            node_map[node["nodeId"]] = text
    return node_map


def run_translation(figma_url: str, locales_csv: str, page: Optional[str]) -> dict:
    """End-to-end synchronous run. Returns the result dict for the API/frontend."""
    figma_token = get_secret("FIGMA_API_KEY")
    anthropic_key = get_secret("ANTHROPIC_API_KEY")
    # (Secret presence is preflighted in the router; assert here defensively.)
    if not figma_token or not anthropic_key:
        raise TranslateError("Required secrets are not configured.")

    file_key, _ = parse_figma_url(figma_url)
    locales = parse_locales(locales_csv)

    cache_path = fetch_file_to_cache(file_key, figma_token)
    source_payload = run_extract(cache_path, locales, page, figma_token)

    strings = source_payload.get("strings") or {}
    glossary = source_payload.get("glossary") or {}
    source_lang = source_payload.get("sourceLang") or "en"
    page_name = source_payload.get("pageName") or ""

    if not strings:
        raise TranslateError("No translatable text found on the page after do-not-translate rules.")

    client = anthropic.Anthropic(api_key=anthropic_key)

    locale_results = []
    for locale in locales:
        try:
            translations = translate_locale(client, strings, source_lang, locale, glossary)
        except anthropic.AuthenticationError:
            raise TranslateError("ANTHROPIC_API_KEY was rejected by Anthropic.")
        except anthropic.APIStatusError as e:
            raise TranslateError(f"Claude API error (HTTP {e.status_code}).")

        # Persist the {stringId: translation} where validate.py expects it.
        trans_path = _QA_CACHE_DIR / f"{file_key}.translate-{locale}.json"
        trans_path.write_text(json.dumps(translations, ensure_ascii=False, indent=2),
                              encoding="utf-8")
        try:
            validation = run_validate(cache_path, locale, figma_token)
        except TranslateError as e:
            validation = {"error": str(e), "passedCount": 0, "failedCount": 0,
                          "missingCount": 0, "totalStrings": len(strings)}

        node_map = _node_map(strings, translations)
        new_page_name = f"{page_name} — {locale}" if page_name else locale
        figma_ops = {
            "op": "duplicate_page",
            "sourcePageName": page_name,
            "newPageName": new_page_name,
            "replacements": node_map,
        }
        # source→translation preview table (per unique string).
        pairs = [
            {
                "id": sid,
                "source": bucket["source"],
                "translation": translations.get(sid, bucket["source"]),
                "role": bucket.get("role"),
                "isCta": bucket.get("isCta"),
                "charLimit": bucket.get("charLimit"),
            }
            for sid, bucket in strings.items()
        ]
        locale_results.append({
            "locale": locale,
            "strings": node_map,            # {nodeId: translatedText} — Download JSON payload
            "pairs": pairs,                 # source→translation rows for the preview table
            "validation": {
                "passed": validation.get("passedCount", 0),
                "failed": validation.get("failedCount", 0),
                "missing": validation.get("missingCount", 0),
                "total": validation.get("totalStrings", len(strings)),
                "failures": validation.get("failed", []),
                "error": validation.get("error"),
            },
            "figma_ops": figma_ops,
        })

    skipped = source_payload.get("skipped") or []
    return {
        "status": "ok",
        "source": {
            "count": len(strings),
            "lang": source_lang,
            "pageName": page_name,
            "fileName": source_payload.get("fileName"),
            "fileKey": file_key,
            "frames": source_payload.get("frames") or {},
            "skippedCount": len(skipped),
            "strings": [
                {"id": sid, "source": bucket["source"], "nodeCount": len(bucket.get("nodes") or [])}
                for sid, bucket in strings.items()
            ],
        },
        "locales": locale_results,
    }

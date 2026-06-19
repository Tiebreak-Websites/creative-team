#!/usr/bin/env python3
"""Extract translatable text from a cached Figma file.

Reads the cache produced by projects/qa/scripts/fetch.py, finds the page with
exactly 3 responsive frames (desktop/tablet/mobile), walks every TEXT node,
applies do-not-translate rules, deduplicates by exact string match, and writes
two outputs into projects/qa/.cache/:

  <fileKey>.translate-source.json     full extracted tree + dedup map
  <fileKey>.translate-strings.<lang>.json
                                       flat {string-id: source-text} for the translator

Usage:
  python extract.py <cache-json-path> --locales <l1,l2,...> [--page <name>]
                                       [--brand <name>] [--source-lang <code>]

Stdout: one-line summary on success; non-zero exit on strict-mode failure.
"""
import json
import re
import sys
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRANSLATE_DIR = HERE.parent
PROJECTS_DIR = TRANSLATE_DIR.parent
REPO_ROOT = PROJECTS_DIR.parent
CACHE_DIR = PROJECTS_DIR / "qa" / ".cache"

DESKTOP_MIN = 1200
TABLET_MIN = 600

# Layer-name markers that mean "leave this alone"
SKIP_NAME_PREFIXES = ("🔒", "[notrans]", "EN:", "NOTRANS:")

# Regexes for content-based skip rules
URL_RE = re.compile(r"^\s*https?://\S+\s*$", re.IGNORECASE)
EMAIL_RE = re.compile(r"^\s*\S+@\S+\.\S+\s*$")
PHONE_RE = re.compile(r"^\s*[+(]?[\d][\d\s\-()]{5,}\s*$")
NUMBER_RE = re.compile(r"^\s*[+\-]?[\d.,%$€£¥/\s:]+\s*$")
PLACEHOLDER_RE = re.compile(r"\b(lorem\s+ipsum|placeholder|tbd|todo|xxx)\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv):
    if len(argv) < 2:
        die("usage: python extract.py <cache-json-path> --locales <l1,l2> [--page <name>] [--brand <name>] [--source-lang <code>]")
    cache_path = Path(argv[1])
    if not cache_path.exists():
        die(f"cache file not found: {cache_path}")

    locales, page_name, brand, source_lang = None, None, None, None
    i = 2
    while i < len(argv):
        a = argv[i]
        if a == "--locales" and i + 1 < len(argv):
            locales = [x.strip() for x in argv[i + 1].split(",") if x.strip()]
            i += 2
        elif a == "--page" and i + 1 < len(argv):
            page_name = argv[i + 1]
            i += 2
        elif a == "--brand" and i + 1 < len(argv):
            brand = argv[i + 1]
            i += 2
        elif a == "--source-lang" and i + 1 < len(argv):
            source_lang = argv[i + 1]
            i += 2
        else:
            i += 1

    if not locales:
        die("--locales is required (comma-separated ISO codes)")
    return cache_path, locales, page_name, brand, source_lang


def die(msg, code=2):
    print(f"extract.py error: {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# Glossary loading
# ---------------------------------------------------------------------------

def load_glossary(brand):
    glossary = {
        "doNotTranslate": [],
        "preferred": {},
        "characterLimits": {"auto": {}},
        "lengthBudget": {
            "de": 1.35, "fr": 1.20, "es": 1.15, "it": 1.20, "pt": 1.20,
            "ru": 1.10, "ja": 0.70, "zh": 0.65, "bg": 1.25, "ar": 1.05,
            "nl": 1.25, "pl": 1.30, "tr": 1.15, "el": 1.30, "uk": 1.15,
            "ro": 1.25, "cs": 1.20, "sk": 1.20, "hu": 1.25, "sv": 1.10,
            "da": 1.10, "no": 1.10, "fi": 1.20,
        },
    }
    # Global
    g_path = TRANSLATE_DIR / "i18n" / "glossary.global.json"
    if g_path.exists():
        try:
            merge_glossary(glossary, json.loads(g_path.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"⚠ failed to parse global glossary: {e}", file=sys.stderr)
    # Per-brand
    if brand:
        b_path = PROJECTS_DIR / brand / "i18n" / "glossary.json"
        if b_path.exists():
            try:
                merge_glossary(glossary, json.loads(b_path.read_text(encoding="utf-8")))
            except Exception as e:
                print(f"⚠ failed to parse brand glossary: {e}", file=sys.stderr)
    return glossary


def merge_glossary(base, over):
    if "doNotTranslate" in over:
        base["doNotTranslate"] = list(set(base["doNotTranslate"] + over["doNotTranslate"]))
    if "preferred" in over:
        for loc, m in over["preferred"].items():
            base["preferred"].setdefault(loc, {}).update(m)
    if "characterLimits" in over:
        for grp, m in over["characterLimits"].items():
            base["characterLimits"].setdefault(grp, {}).update(m)
    if "lengthBudget" in over:
        base["lengthBudget"].update(over["lengthBudget"])


# ---------------------------------------------------------------------------
# Page + frame discovery
# ---------------------------------------------------------------------------

def find_pages(doc):
    return [c for c in (doc.get("children") or []) if c.get("type") == "CANVAS"]


def classify_frames(frames):
    """Return ({desktop: frame, tablet: frame, mobile: frame}, None) or (None, error_msg)."""
    buckets = {"desktop": [], "tablet": [], "mobile": []}
    for f in frames:
        w = (f.get("absoluteBoundingBox") or {}).get("width") or 0
        if w >= DESKTOP_MIN:
            buckets["desktop"].append(f)
        elif w >= TABLET_MIN:
            buckets["tablet"].append(f)
        else:
            buckets["mobile"].append(f)

    picked = {}
    for device, cands in buckets.items():
        if len(cands) == 0:
            return None, f"strict mode: 0 {device} frames (need exactly 1, width thresholds desktop≥{DESKTOP_MIN}, tablet≥{TABLET_MIN})"
        if len(cands) >= 2:
            # Tiebreaker: name contains the device label
            named = [c for c in cands if device in (c.get("name") or "").lower()]
            if len(named) == 1:
                picked[device] = named[0]
                continue
            names = [c.get("name") for c in cands]
            return None, f"strict mode: {len(cands)} {device} frames found ({names}). Rename one to include \"{device}\", hide extras, or use --page <name>."
        picked[device] = cands[0]
    return picked, None


def find_target_page(doc, page_name=None):
    pages = find_pages(doc)
    if not pages:
        return None, None, "no pages found in file"
    if page_name:
        match = next((p for p in pages if p.get("name") == page_name), None)
        if not match:
            return None, None, f"--page \"{page_name}\" not found. Available: {[p.get('name') for p in pages]}"
        frames = [c for c in (match.get("children") or []) if c.get("type") == "FRAME"]
        picked, err = classify_frames(frames)
        if err:
            return None, None, f"page \"{page_name}\": {err}"
        return match, picked, None
    # Auto-detect: first page that classifies cleanly into 3 frames
    for p in pages:
        frames = [c for c in (p.get("children") or []) if c.get("type") == "FRAME"]
        if len(frames) < 3:
            continue
        picked, err = classify_frames(frames)
        if not err:
            return p, picked, None
    page_summaries = [
        f"\"{p.get('name')}\" ({len([c for c in (p.get('children') or []) if c.get('type') == 'FRAME'])} frames)"
        for p in pages
    ]
    return None, None, f"no page has exactly 3 classifiable frames. Pages: {', '.join(page_summaries)}. Use --page <name> to target one explicitly."


# ---------------------------------------------------------------------------
# Text walker
# ---------------------------------------------------------------------------

def should_skip(node, characters, glossary):
    """Return (skip: bool, reason: str|None)."""
    name = (node.get("name") or "")
    for pre in SKIP_NAME_PREFIXES:
        if name.strip().startswith(pre):
            return True, f"layer-marker:{pre}"
    s = characters.strip()
    if not s:
        return True, "empty"
    if len(s) < 2:
        return True, "too-short"
    if URL_RE.match(s):
        return True, "url"
    if EMAIL_RE.match(s):
        return True, "email"
    if PHONE_RE.match(s) and len(s) <= 18:
        return True, "phone"
    if NUMBER_RE.match(s):
        return True, "number"
    if PLACEHOLDER_RE.search(s):
        return True, "placeholder-string"
    for term in glossary.get("doNotTranslate", []):
        if term and s == term.strip():
            return True, f"glossary:{term}"
    return False, None


def role_from_fontsize(fs):
    if not fs:
        return "body"
    if fs >= 48: return "hero"
    if fs >= 32: return "h1"
    if fs >= 22: return "h2"
    if fs >= 16: return "body"
    return "caption"


def is_cta_node(node):
    name = (node.get("name") or "").lower()
    return any(k in name for k in ("button", "btn", "cta"))


def walk_text(frame, breakpoint_name, glossary):
    out = []

    def w(node, parent_chain, in_cta):
        nm = node.get("name") or ""
        cta_here = in_cta or is_cta_node(node)
        if node.get("type") == "TEXT":
            chars = node.get("characters") or ""
            skip, reason = should_skip(node, chars, glossary)
            style = node.get("style") or {}
            bbox = node.get("absoluteBoundingBox") or {}
            parent_bbox = (parent_chain[-1] or {}).get("absoluteBoundingBox") if parent_chain else None
            entry = {
                "nodeId": node["id"],
                "breakpoint": breakpoint_name,
                "characters": chars,
                "fontFamily": style.get("fontFamily"),
                "fontStyle": (
                    style.get("fontPostScriptName")
                    or f"{style.get('fontWeight', 400)}"
                ),
                "fontWeight": style.get("fontWeight"),
                "fontSize": style.get("fontSize"),
                "layerName": nm,
                "parentName": (parent_chain[-1] or {}).get("name") if parent_chain else None,
                "role": role_from_fontsize(style.get("fontSize")),
                "isCta": cta_here,
                "bbox": bbox,
                "containerWidth": (parent_bbox or {}).get("width") if parent_bbox else None,
                "skip": skip,
                "skipReason": reason,
            }
            out.append(entry)
        for c in (node.get("children") or []):
            w(c, parent_chain + [node], cta_here)

    w(frame, [], False)
    return out


# ---------------------------------------------------------------------------
# Dedup + character limits
# ---------------------------------------------------------------------------

def string_id(text):
    """Stable short ID for a source string."""
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    return f"s_{h}"


def estimate_char_limit(entry, glossary):
    """Best-effort character limit for buttons / hero headlines.
    Falls back to glossary defaults; otherwise None (no hard cap)."""
    auto = glossary.get("characterLimits", {}).get("auto", {})
    if entry["isCta"]:
        return auto.get("ctaButton") or auto.get("buttonText") or 22
    role = entry["role"]
    if role == "hero":
        return auto.get("heroTitle") or 60
    if role == "h1":
        return auto.get("h1") or 80
    return None


def dedupe(entries, glossary):
    """Group translatable entries by exact characters.
    Returns:
      strings: { stringId: { source, role, isCta, charLimit, nodeIds[...] } }
      skipped: [ entry, ... ]
    """
    strings = {}
    skipped = []
    for e in entries:
        if e["skip"]:
            skipped.append(e)
            continue
        sid = string_id(e["characters"])
        bucket = strings.get(sid)
        if not bucket:
            bucket = {
                "id": sid,
                "source": e["characters"],
                "role": e["role"],
                "isCta": e["isCta"],
                "charLimit": estimate_char_limit(e, glossary),
                "nodes": [],
            }
            strings[sid] = bucket
        bucket["nodes"].append({
            "nodeId": e["nodeId"],
            "breakpoint": e["breakpoint"],
            "fontFamily": e["fontFamily"],
            "fontStyle": e["fontStyle"],
            "fontWeight": e["fontWeight"],
            "layerName": e["layerName"],
        })
        # If any instance is a CTA, treat the whole group as CTA-constrained
        if e["isCta"] and not bucket["isCta"]:
            bucket["isCta"] = True
            bucket["charLimit"] = min(filter(None, [bucket["charLimit"], estimate_char_limit(e, glossary)])) if estimate_char_limit(e, glossary) else bucket["charLimit"]
    return strings, skipped


# ---------------------------------------------------------------------------
# Source language guess (very rough — translator confirms)
# ---------------------------------------------------------------------------

def guess_source_lang(strings):
    """Heuristic: looks at script + a few stopwords. Defaults to 'en'."""
    bulk = " ".join(s["source"] for s in strings.values())[:2000].lower()
    # script-based first
    if any("؀" <= ch <= "ۿ" for ch in bulk):
        return "ar"
    if any("֐" <= ch <= "׿" for ch in bulk):
        return "he"
    if any("Ѐ" <= ch <= "ӿ" for ch in bulk):
        # Cyrillic — could be ru, uk, bg, sr; default to ru
        return "ru"
    if any("一" <= ch <= "鿿" for ch in bulk):
        return "zh"
    if any("぀" <= ch <= "ヿ" for ch in bulk):
        return "ja"
    if any("가" <= ch <= "힯" for ch in bulk):
        return "ko"
    # Latin-script word hints
    hints = {
        "de": [" der ", " die ", " und ", " ist ", " sich ", " mit "],
        "fr": [" le ", " la ", " les ", " est ", " avec ", " votre "],
        "es": [" el ", " la ", " los ", " es ", " con ", " para "],
        "it": [" il ", " la ", " e ", " con ", " per ", " del "],
        "pt": [" o ", " a ", " e ", " com ", " para ", " você "],
        "nl": [" de ", " het ", " en ", " is ", " met "],
        "pl": [" jest ", " się ", " na ", " do "],
        "tr": [" ve ", " bir ", " için "],
    }
    padded = f" {bulk} "
    scores = {k: sum(padded.count(w) for w in ws) for k, ws in hints.items()}
    best = max(scores, key=scores.get) if scores else "en"
    if scores.get(best, 0) >= 3:
        return best
    return "en"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    cache_path, locales, page_name, brand, source_lang_arg = parse_args(sys.argv)
    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    file_key = cache.get("fileKey") or cache_path.stem
    doc = cache.get("document") or {}

    glossary = load_glossary(brand)

    page, picked, err = find_target_page(doc, page_name)
    if err:
        die(err)

    # Walk all 3 frames
    all_entries = []
    for bp_name in ("desktop", "tablet", "mobile"):
        frame = picked[bp_name]
        all_entries.extend(walk_text(frame, bp_name, glossary))

    strings, skipped = dedupe(all_entries, glossary)

    source_lang = source_lang_arg or guess_source_lang(strings)

    # Build outputs
    source_payload = {
        "fileKey": file_key,
        "fileName": cache.get("name"),
        "pageId": page["id"],
        "pageName": page.get("name"),
        "sourceLang": source_lang,
        "targetLocales": locales,
        "brand": brand,
        "frames": {bp: {"id": picked[bp]["id"], "name": picked[bp].get("name"),
                        "width": (picked[bp].get("absoluteBoundingBox") or {}).get("width")}
                   for bp in ("desktop", "tablet", "mobile")},
        "strings": strings,
        "skipped": [{"nodeId": e["nodeId"], "breakpoint": e["breakpoint"],
                     "text": e["characters"], "reason": e["skipReason"]} for e in skipped],
        "totalTextNodes": len(all_entries),
        "uniqueStrings": len(strings),
        "skippedCount": len(skipped),
        "glossary": glossary,
    }

    flat = {sid: bucket["source"] for sid, bucket in strings.items()}

    source_out = CACHE_DIR / f"{file_key}.translate-source.json"
    strings_out = CACHE_DIR / f"{file_key}.translate-strings.{source_lang}.json"

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    source_out.write_text(json.dumps(source_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    strings_out.write_text(json.dumps(flat, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"extract: \"{page.get('name')}\" · 3 frames "
        f"(desktop={picked['desktop']['id']}, "
        f"tablet={picked['tablet']['id']}, "
        f"mobile={picked['mobile']['id']}) · "
        f"{len(all_entries)} total text nodes · "
        f"{len(strings)} unique strings · "
        f"{len(skipped)} skipped · "
        f"source-lang={source_lang}"
    )
    print(json.dumps({
        "sourcePath": str(source_out),
        "stringsPath": str(strings_out),
        "sourceLang": source_lang,
        "pageId": page["id"],
        "pageName": page.get("name"),
        "uniqueStrings": len(strings),
        "totalNodes": len(all_entries),
        "skippedCount": len(skipped),
    }))


if __name__ == "__main__":
    main()

"""LP Builder — stores, field parsing, sanitization.

Follows the platform persistence pattern: in-memory dicts as the source of
truth while the process lives, best-effort JSON flushes to the artifact disk,
rehydrate on startup. Built-in sections are seeded from code and can be
OVERRIDDEN or disabled, never deleted; custom sections (admin clones) live
fully on disk.

Sections are REAL HTML+CSS annotated with data attributes:
  data-lp-text="key"   editable single-line text (must be a LEAF element)
  data-lp-rich="key"   editable multi-line text (leaf; \n -> <br> at compose)
  data-lp-img="key"    image slot (<img src> or data-lp-bg background holder)
  data-lp-link="key"   href slot
  <!--lp-repeat:key--> ...one item node... <!--/lp-repeat:key-->  repeatable
  data-lp-form         the signup form whose action is wired at export
"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from ..settings import settings

log = logging.getLogger(__name__)

LP_ROOT = settings.ARTIFACT_ROOT / "lp-builder"
SECTIONS_DIR = LP_ROOT / "sections"
PROJECTS_DIR = LP_ROOT / "projects"
ASSETS_DIR = LP_ROOT / "assets"
LANGS_PATH = LP_ROOT / "languages.json"

_LOCK = threading.RLock()
_SECTIONS: Dict[str, dict] = {}   # key -> section (built-ins + overrides + customs)
_PROJECTS: Dict[str, dict] = {}
_LANGS: List[dict] = []

_ID_RE = re.compile(r"^[a-f0-9]{32}$")
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
FIELD_RE = re.compile(r'data-lp-(text|rich|img|link)="([A-Za-z0-9_.-]+)"')
REPEAT_RE = re.compile(r"<!--lp-repeat:([A-Za-z0-9_-]+)-->(.*?)<!--/lp-repeat:\1-->", re.S)

DEFAULT_LANGS = [
    {"code": "en", "label": "English"},
    {"code": "ms", "label": "Malay"},
    {"code": "th", "label": "Thai"},
    {"code": "ja", "label": "Japanese"},
    {"code": "sv", "label": "Swedish"},
    {"code": "pt", "label": "Portuguese"},
    {"code": "es", "label": "Spanish"},
    {"code": "vi", "label": "Vietnamese"},
    {"code": "it", "label": "Italian"},
    {"code": "pl", "label": "Polish"},
    {"code": "fr", "label": "French"},
    {"code": "de", "label": "German"},
    {"code": "ar", "label": "Arabic"},
    {"code": "zh", "label": "Chinese"},
]

# Default (unbranded) design tokens — a brand pick overwrites these per project.
DEFAULT_TOKENS = {
    "primary": "#E71E25", "accent": "#0A0F2E", "bg": "#FFFFFF",
    "surface": "#F4F6FB", "card": "#FFFFFF", "text": "#0B1220", "muted": "#5B6472",
    "font": "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
    "logo": "",
}


def _now() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Sanitization + validation (sections are STRUCTURE + STYLE only)
# ---------------------------------------------------------------------------
_FORBIDDEN = (
    re.compile(r"<\s*script", re.I),
    re.compile(r"\son\w+\s*=", re.I),
    re.compile(r"javascript\s*:", re.I),
    re.compile(r"<\s*iframe", re.I),
)


def validate_section_html(html: str) -> Optional[str]:
    """Returns a user-facing error, or None when the HTML is acceptable."""
    if not html.strip():
        return "the section HTML is empty"
    for rx in _FORBIDDEN:
        if rx.search(html):
            return "scripts, event handlers, javascript: URLs and iframes are not allowed in sections"
    # Text slots must be LEAF elements (no nested tags) — the string
    # compositor replaces everything between '>' and the closing '</'.
    if re.search(r'data-lp-(?:text|rich)="[A-Za-z0-9_.-]+"[^>]*>[^<]*<(?!/)', html):
        return "data-lp-text / data-lp-rich elements must not contain nested tags"
    # Repeat markers must be balanced.
    opens = re.findall(r"<!--lp-repeat:([A-Za-z0-9_-]+)-->", html)
    closes = re.findall(r"<!--/lp-repeat:([A-Za-z0-9_-]+)-->", html)
    if sorted(opens) != sorted(closes):
        return "unbalanced <!--lp-repeat:key--> ... <!--/lp-repeat:key--> markers"
    return None


def parse_fields(html: str) -> dict:
    """Derive the editable fields + repeat groups from annotated HTML."""
    repeats = []
    for key, body in REPEAT_RE.findall(html):
        inner = [{"kind": k, "key": f} for k, f in FIELD_RE.findall(body)]
        repeats.append({"key": key, "fields": inner})
    outside = REPEAT_RE.sub("", html)
    fields = [{"kind": k, "key": f} for k, f in FIELD_RE.findall(outside)]
    return {"fields": fields, "repeats": repeats,
            "has_form": "data-lp-form" in html}


# ---------------------------------------------------------------------------
# Disk persistence (best-effort; memory stays authoritative)
# ---------------------------------------------------------------------------
def _flush_json(path: Path, data) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        log.error("lp-builder: could not persist %s: %s", path.name, e)


def persist_section(s: dict) -> None:
    _flush_json(SECTIONS_DIR / f"{s['key']}.json", s)


def persist_project(p: dict) -> None:
    _flush_json(PROJECTS_DIR / f"{p['id']}.json", p)


def persist_langs() -> None:
    _flush_json(LANGS_PATH, _LANGS)


def delete_section_file(key: str) -> None:
    try:
        (SECTIONS_DIR / f"{key}.json").unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


def delete_project_files(pid: str) -> None:
    try:
        (PROJECTS_DIR / f"{pid}.json").unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Store accessors
# ---------------------------------------------------------------------------
def sections() -> Dict[str, dict]:
    return _SECTIONS


def projects() -> Dict[str, dict]:
    return _PROJECTS


def languages() -> List[dict]:
    return _LANGS


def lock() -> threading.RLock:
    return _LOCK


def new_project_id() -> str:
    return "lp_" + uuid.uuid4().hex[:12]


def new_asset_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Startup: seed built-ins, then rehydrate disk state over them
# ---------------------------------------------------------------------------
def rehydrate() -> None:
    from . import builtin_sections, braintrade_sections
    with _LOCK:
        for s in (builtin_sections.BUILTIN_SECTIONS
                  + braintrade_sections.BRAINTRADE_SECTIONS):
            s = dict(s)
            s["built_in"] = True
            s.setdefault("enabled", True)
            _SECTIONS[s["key"]] = s
        n_sec = n_proj = 0
        if SECTIONS_DIR.is_dir():
            for f in SECTIONS_DIR.glob("*.json"):
                try:
                    s = json.loads(f.read_text(encoding="utf-8"))
                    if s.get("key"):
                        base = _SECTIONS.get(s["key"])
                        if base is not None and base.get("built_in"):
                            s["built_in"] = True  # disk override of a built-in
                        _SECTIONS[s["key"]] = s
                        n_sec += 1
                except Exception:  # noqa: BLE001
                    log.warning("lp-builder: skipped unreadable section %s", f.name)
        if PROJECTS_DIR.is_dir():
            for f in PROJECTS_DIR.glob("*.json"):
                try:
                    p = json.loads(f.read_text(encoding="utf-8"))
                    if p.get("id"):
                        _PROJECTS[p["id"]] = p
                        n_proj += 1
                except Exception:  # noqa: BLE001
                    log.warning("lp-builder: skipped unreadable project %s", f.name)
        global _LANGS
        try:
            _LANGS = json.loads(LANGS_PATH.read_text(encoding="utf-8"))
            assert isinstance(_LANGS, list) and _LANGS
            # New default languages (e.g. shipped with new template materials)
            # join a persisted list rather than being shadowed by it.
            have = {l.get("code") for l in _LANGS}
            _LANGS.extend(dict(x) for x in DEFAULT_LANGS if x["code"] not in have)
        except Exception:  # noqa: BLE001
            _LANGS = [dict(x) for x in DEFAULT_LANGS]
    if n_sec or n_proj:
        log.info("lp-builder: rehydrated %d section override(s), %d project(s)", n_sec, n_proj)

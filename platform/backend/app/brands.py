"""Admin-managed brands, persisted to a JSON file under the backend.

A *brand* bundles a palette and an optional logo so a run can be kept on-brand:
the colors are folded into the GPT-5.5 art direction, and a raster logo can be
composited onto each finished banner (see runner._composite_logo).

Storage mirrors tool_config.py: a single JSON file at `config/brands.json`
holding a list of brand objects. A read returns the parsed list (empty when the
file is missing/corrupt); a write replaces the whole list atomically enough for
this local-first, low-write workload.

Brand shape:
    {
        "id":       "<uuid hex>",          # server-generated
        "name":     "Acme",
        "colors":   ["#0A2540", "#00D4FF"],
        "logo_svg": "<svg .../>" | "data:image/png;base64,..." | null
    }

`logo_svg` is named for the common case (an inline SVG string) but also accepts a
raster data: URI — that is what makes pixel compositing reliable without an SVG
rasterizer (see runner). Anything else is stored verbatim and simply not overlaid.

Routes (mounted under /api/tools/banner-builder by runs_router.build_router):
  GET    /brands         (any logged-in user)  -> {"brands": [...]}
  POST   /brands         (admin)               -> {"brand": Brand}
  PUT    /brands/{id}     (admin)               -> {"brand": Brand}
  DELETE /brands/{id}     (admin)               -> 204
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response

from .auth import require_admin, require_user
from .settings import BACKEND_DIR

# Admin-created brands must SURVIVE deploys: the backend package dir is
# ephemeral in the cloud (each deploy ships a fresh image), so the store lives
# on the persistent artifact disk. Anything saved at the old ephemeral path is
# migrated once (covers local dev; on prod the old file died with each deploy).
from .settings import settings as _settings  # noqa: E402

BRANDS_DIR = _settings.ARTIFACT_ROOT / "config"
BRANDS_DIR.mkdir(parents=True, exist_ok=True)
BRANDS_PATH = BRANDS_DIR / "brands.json"
_LEGACY_BRANDS_PATH = BACKEND_DIR / "config" / "brands.json"
if _LEGACY_BRANDS_PATH.exists() and not BRANDS_PATH.exists():
    try:
        BRANDS_PATH.write_text(_LEGACY_BRANDS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError:
        pass

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_MAX_COLORS = 12

# --- Entity model ------------------------------------------------------------
# Three entity kinds, two roles. A *broker* is the product being sold — who the
# customer transacts with. A *whitelabel* is a routing/regulatory surface that
# fronts a brand (many-to-many, rendered "WL › Brand"). An *academy* sells
# education instead of a broker account — structurally it behaves exactly like a
# broker, and `kind` separates it only so admin and reporting can bucket it.
#
# "Brand" is the umbrella for the things being sold, not a kind of its own:
#
#     brand_options()      kind in (broker, academy)  an academy IS a brand
#     whitelabel_options() kind == whitelabel         academies are NEVER WLs
#     academy_options()    kind == academy            admin/reporting bucket only
#
# `kind` is the single source of truth: every picker, filter and validator
# derives from it. Nothing infers the vocabulary from values found on existing
# records — that turns a typo into a permanent option.
ENTITY_KINDS = ("broker", "whitelabel", "academy", "prop")
DEFAULT_KIND = "broker"
# What a BRAND picker offers: the products being sold. A broker sells accounts,
# an academy sells education, a prop firm sells funded-account challenges —
# all three are brands, so all three belong here. Only `whitelabel` is a
# different ROLE; the rest are reporting buckets over the same behaviour.
BRAND_KINDS = ("broker", "academy", "prop")

# This role was originally called 'brand'. Anything persisted under the old name
# still loads as a broker, so a rename can't silently drop an entity out of every
# bucket (an unknown kind matches no picker).
_KIND_ALIASES = {"brand": "broker"}


def _canon_kind(value: Any) -> str:
    """Lower-case a kind and resolve any legacy alias. Unknown values pass
    through unchanged so the caller can reject them."""
    v = value.strip().lower() if isinstance(value, str) else ""
    return _KIND_ALIASES.get(v, v)


def normalise_name(name: Any) -> str:
    """The ONE name normaliser: lowercase, then [\\s-]+ -> '-', then trim.

    Every name comparison and every derived slug must route through this. When a
    logo slug collapsed 'Digital-Spearhead'/'Digital Spearhead' but the colour
    lookup didn't, cards rendered the wrong tint — one normaliser means the two
    can never disagree.
    """
    if not isinstance(name, str):
        return ""
    return re.sub(r"[\s-]+", "-", name.strip().lower()).strip("-")


# Every spelling of "no white label" that real data arrives with. Without this,
# direct-brand records fall through to the neutral default instead of the brand
# colour.
_NO_WHITELABEL = {
    "", "-", "--", "—", "–", "none", "no-wl", "no-white-label", "n/a", "na",
    "direct", "no-whitelabel", "null",
}


def is_no_whitelabel(value: Any) -> bool:
    """True when `value` is any of the many spellings of "no white label"."""
    return normalise_name(value) in _NO_WHITELABEL


def _validate_kind(value: Any) -> str:
    if value is None:
        return DEFAULT_KIND
    kind = _canon_kind(value)
    if kind not in ENTITY_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"'kind' must be one of {', '.join(ENTITY_KINDS)}",
        )
    return kind


# --- Regulation --------------------------------------------------------------
# Which licence a broker operates under. Metadata + a registry filter for now:
# the risk warning it usually drives needs compliance-approved wording, which
# isn't something to invent here.
REGULATIONS = ("eu", "international")


def _validate_regulation(value: Any) -> Optional[str]:
    """'eu' | 'international' | None (unset). Anything else is rejected."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    v = value.strip().lower() if isinstance(value, str) else ""
    if v not in REGULATIONS:
        raise HTTPException(
            status_code=422,
            detail=f"'regulation' must be one of {', '.join(REGULATIONS)} (or empty)",
        )
    return v


# --- Target markets ----------------------------------------------------------
# Where an entity operates. Keys are ISO-3166 alpha-2, which is also the flag
# CDN's key, so the UI derives each flag straight from the code — no second
# mapping to keep in sync. The value is the reporting region the market rolls up
# into. Declaration order IS display order, so a saved list always comes back
# grouped the same way regardless of what order it was clicked in.
MARKETS: dict = {
    # EU
    "FR": "EU", "DE": "EU", "IT": "EU", "NO": "EU", "PL": "EU",
    "ES": "EU", "SE": "EU",
    # GCC
    "BH": "GCC", "IN": "GCC", "KW": "GCC", "OM": "GCC", "QA": "GCC",
    "SA": "GCC", "AE": "GCC",
    # LATAM
    "AR": "LATAM", "BR": "LATAM", "CL": "LATAM", "CO": "LATAM", "CR": "LATAM",
    "EC": "LATAM", "SV": "LATAM", "MX": "LATAM", "PE": "LATAM", "UY": "LATAM",
    # APAC
    "CN": "APAC", "JP": "APAC", "MY": "APAC", "SG": "APAC", "TH": "APAC",
    "VN": "APAC",
    # North America
    "CA": "NA",
    # Unassigned in the source list — grouped separately rather than guessed at.
    "ZA": "OTHER",
}
MARKET_REGIONS = ("EU", "GCC", "LATAM", "APAC", "NA", "OTHER")


def _clean_markets(value: Any) -> List[str]:
    """Known market codes only, deduped and returned in catalogue order.

    Unknown codes are dropped rather than 422-ing: the list is reference data,
    and one stale code shouldn't block saving the rest of the brand kit.
    """
    if not isinstance(value, list):
        return []
    want = {c.strip().upper() for c in value if isinstance(c, str) and c.strip()}
    return [code for code in MARKETS if code in want]


def _known_language_codes() -> List[str]:
    """Language codes the LP registry knows about, in its own order.

    Unions the live list with the shipped defaults: `languages()` reads a cache
    that's empty until the LP store rehydrates, and validating against an empty
    set would silently drop every language an admin picked.
    """
    from .lp_builder.core import DEFAULT_LANGS, languages  # local: avoids import-time coupling

    order: List[str] = []
    for entry in list(languages() or []) + list(DEFAULT_LANGS):
        code = entry.get("code")
        if isinstance(code, str) and code and code not in order:
            order.append(code)
    return order


def _clean_languages(value: Any) -> List[str]:
    """Known language codes only, deduped, in registry order."""
    if not isinstance(value, list):
        return []
    want = {c.strip().lower() for c in value if isinstance(c, str) and c.strip()}
    return [code for code in _known_language_codes() if code in want]


# --- Page design tokens ------------------------------------------------------
# Keys match the `--lp-*` CSS variables the LP section templates already consume,
# so a value set here reaches the page without touching a template. `cta` and
# `cta_text` are new: the button previously hardcoded the primary colour and
# white text, which left no way to give the CTA its own colour.
TOKEN_KEYS = (
    "primary", "accent", "cta", "cta_text",
    "bg", "surface", "card", "text", "muted",
)


def _clean_tokens(value: Any) -> dict:
    """Keep the known token keys whose value is a well-formed hex colour."""
    if not isinstance(value, dict):
        return {}
    out: dict = {}
    for key in TOKEN_KEYS:
        v = value.get(key)
        if isinstance(v, str) and _HEX_RE.match(v.strip()):
            out[key] = v.strip().upper()
    return out


# --- Typography --------------------------------------------------------------
# Two families (headings vs body) plus a size/weight/line-height per role.
# Emitted as --lp-<role>-size / -weight / -line so templates can opt in; the
# existing sections hardcode their own scale and are deliberately left alone.
TYPE_ROLES = ("h1", "h2", "h3", "body")
_DEFAULT_TYPE_SCALE = {
    "h1": {"size": 48, "weight": 700, "line": 1.1},
    "h2": {"size": 34, "weight": 700, "line": 1.2},
    "h3": {"size": 24, "weight": 600, "line": 1.3},
    "body": {"size": 16, "weight": 400, "line": 1.6},
}
_WEIGHTS = (100, 200, 300, 400, 500, 600, 700, 800, 900)


def _clean_typography(value: Any) -> dict:
    """{heading_font, body_font, scale:{role:{size,weight,line}}} — clamped.

    Sizes are px (8–200), weights snap to the nine CSS steps, line-height is a
    unitless multiplier (0.8–3). Out-of-range numbers are clamped rather than
    rejected so a fat-fingered value can't 422 the whole save.
    """
    if not isinstance(value, dict):
        return {}
    out: dict = {}
    for key in ("heading_font", "body_font"):
        f = _clean_text(value.get(key), limit=120)
        if f:
            out[key] = f

    raw_scale = value.get("scale")
    scale: dict = {}
    if isinstance(raw_scale, dict):
        for role in TYPE_ROLES:
            spec = raw_scale.get(role)
            if not isinstance(spec, dict):
                continue
            entry: dict = {}
            size = spec.get("size")
            if isinstance(size, (int, float)):
                entry["size"] = max(8, min(200, round(float(size))))
            weight = spec.get("weight")
            if isinstance(weight, (int, float)):
                entry["weight"] = min(_WEIGHTS, key=lambda w: abs(w - float(weight)))
            line = spec.get("line")
            if isinstance(line, (int, float)):
                entry["line"] = max(0.8, min(3.0, round(float(line), 2)))
            if entry:
                scale[role] = entry
    if scale:
        out["scale"] = scale
    return out

# Bundled brand assets (logos), committed under the app package so they ship in
# the Docker image and survive the ephemeral cloud disk.
_ASSETS = Path(__file__).resolve().parent / "assets" / "brands"


def _asset(*parts: str) -> Optional[str]:
    """Read a committed brand asset (e.g. an SVG logo) as text, or None."""
    try:
        return (_ASSETS.joinpath(*parts)).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _icon(slug: str) -> Optional[str]:
    """An entity's registry ICON — the square mark shown in lists and cards.

    Distinct from `logo_svg`, which is the wordmark composited onto banners:
    these icons carry an opaque white plate, so they'd look wrong overlaid.
    Returns None when the icon hasn't been supplied yet, which the UI renders as
    a name-initial placeholder.
    """
    return _asset(slug, "icon.svg")


# --- The registry ------------------------------------------------------------
# The team's canonical entities, hard-coded so they survive restarts AND the
# ephemeral cloud disk (each deploy ships a fresh image) — the vocabulary is
# "just there" on every install, rather than something an admin must re-enter.
# Admins can still register extra entities on top; those live in brands.json.
#
# `id` is deliberately the slug, i.e. normalise_name(name) — so the primary key
# IS the normalised name, and an id lookup and a name lookup can't disagree.
# Built-ins can be edited and retired (both stored as an override under the same
# id); deleting one resets it to these shipped defaults.
#
# `colors` is the palette fed to the art director; `accent` is the single colour
# that tints a card (see resolve_accent). Both are read off each supplied icon,
# so nothing here is invented. `icon_svg` is None until an icon is supplied.
BUILTIN_BRANDS: List[dict] = [
    # --- Brokers: the product being sold ------------------------------------
    {
        "id": "200invest", "name": "200Invest", "kind": "broker",
        "colors": ["#0050F9", "#303030"], "accent": "#0050F9",
        "icon_svg": _icon("200invest"),
    },
    {
        "id": "finansero", "name": "Finansero", "kind": "broker",
        "colors": ["#00B6AB", "#2A2C2E"], "accent": "#00B6AB",
        "icon_svg": _icon("finansero"),
    },
    {
        "id": "tradeapp", "name": "TradeApp", "kind": "prop",
        "colors": ["#05ADC9", "#75FBFD"], "accent": "#05ADC9",
        "icon_svg": _icon("tradeapp"),
    },
    {
        "id": "tradit", "name": "Tradit", "kind": "broker",
        "colors": ["#04DE00", "#212121"], "accent": "#04DE00",
        "icon_svg": _icon("tradit"),
    },
    {
        "id": "warren-bowie-and-smith", "name": "Warren Bowie and Smith", "kind": "broker",
        "colors": ["#FF861C", "#414141"], "accent": "#FF861C",
        "icon_svg": _icon("warren-bowie-and-smith"),
    },
    {
        "id": "zenstox", "name": "Zenstox", "kind": "broker",
        "colors": ["#00B410"], "accent": "#00B410",
        "icon_svg": _icon("zenstox"),
    },

    # --- White labels: marketing surfaces that route traffic to a brand -----
    {
        "id": "101mt", "name": "101mt", "kind": "whitelabel",
        "colors": ["#03CD03", "#313131"], "accent": "#03CD03",
        "icon_svg": _icon("101mt"),
    },
    {
        "id": "benjo", "name": "Benjo", "kind": "whitelabel",
        "colors": ["#FFCA05", "#3E3E3F"], "accent": "#FFCA05",
        "icon_svg": _icon("benjo"),
    },
    {
        "id": "dgsh", "name": "DGSH", "kind": "whitelabel",
        "colors": ["#00ABF0", "#303092"], "accent": "#00ABF0",
        "icon_svg": _icon("dgsh"),
    },
    {
        "id": "marketing-vici", "name": "Marketing Vici", "kind": "whitelabel",
        "colors": ["#73A2D4", "#383838"], "accent": "#73A2D4",
        "icon_svg": _icon("marketing-vici"),
    },
    {
        "id": "profinansez", "name": "Profinansez", "kind": "whitelabel",
        "colors": ["#00D3D3"], "accent": "#00D3D3",
        "icon_svg": _icon("profinansez"),
    },
    {
        "id": "strong-trend", "name": "Strong Trend", "kind": "whitelabel",
        "colors": ["#2BBDF2", "#1591CC"], "accent": "#2BBDF2",
        "icon_svg": _icon("strong-trend"),
    },
    {
        "id": "tradelg", "name": "TradeLG", "kind": "whitelabel",
        "colors": ["#00B4EE", "#005DAC", "#414141"], "accent": "#00B4EE",
        "icon_svg": _icon("tradelg"),
    },
    {
        "id": "vici-marketing-ltd", "name": "Vici Marketing Ltd", "kind": "whitelabel",
        "colors": ["#89D473", "#383838"], "accent": "#89D473",
        "icon_svg": _icon("vici-marketing-ltd"),
    },

    # --- Academies: education brands. Picked like brokers; counted apart ----
    {
        "id": "braintrade",
        "name": "BrainTrade",
        # A trading academy: it sells education, so it's bucketed separately for
        # admin/reporting — but it stays selectable in every brand picker.
        "kind": "academy",
        "colors": ["#FF7532", "#070851", "#F1F5F1"],
        "accent": "#FF7532",
        "swatches": [
            {"hex": "#FF7532", "role": "Primary · CTA"},
            {"hex": "#070851", "role": "Background"},
            {"hex": "#F1F5F1", "role": "Warm white"},
        ],
        "icon_svg": _icon("braintrade"),
        # The ORIGINAL full logo (wordmark + waves); older marks kept as files.
        "logo_svg": _asset("braintrade", "bt-original.svg") or _asset("braintrade", "bt2-l.svg"),
        # White-lettered variant served wherever the app shows the logo on dark.
        "logo_svg_dark": _asset("braintrade", "Braintrade_logo_white_text.svg"),
        # Landing-page design tokens the LP Builder reads on brand pick.
        "lp": {"bg": "#FBFBFB", "card": "#FFFFFF"},
    },
    {
        "id": "fiversity", "name": "Fiversity", "kind": "academy",
        "colors": ["#00AB5E"], "accent": "#00AB5E",
        "icon_svg": _icon("fiversity"),
    },
]
for _b in BUILTIN_BRANDS:
    _b["builtin"] = True
_BUILTIN_IDS = {b["id"] for b in BUILTIN_BRANDS}


def _merged_builtin(base: dict, stored: List[dict]) -> dict:
    """A built-in brand with any admin-saved override applied on top. The
    override lives in brands.json under the SAME id; `builtin` stays True so
    the UI badges it and DELETE means 'reset to defaults'."""
    override = next((b for b in stored if b.get("id") == base["id"]), None)
    if not override:
        return base
    merged = {**base, **{k: v for k, v in override.items() if k != "builtin"}}
    merged["builtin"] = True
    return merged


# --- Storage ----------------------------------------------------------------
def _load() -> List[dict]:
    if not BRANDS_PATH.exists():
        return []
    try:
        data = json.loads(BRANDS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _save(brands: List[dict]) -> None:
    BRANDS_PATH.write_text(
        json.dumps(brands, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def list_brands() -> List[dict]:
    """Built-in brands (with admin overrides applied) first, then stored ones."""
    stored = _load()
    builtins = [_merged_builtin(b, stored) for b in BUILTIN_BRANDS]
    rest = [b for b in stored if b.get("id") not in _BUILTIN_IDS]
    return [*builtins, *rest]


def _kind_of(entity: dict) -> str:
    return _canon_kind(entity.get("kind")) or DEFAULT_KIND


def _is_active(entity: dict) -> bool:
    return entity.get("active", True) is not False


def brand_options(include_retired: bool = False) -> List[dict]:
    """Everything selectable in a BRAND picker — brands AND academies.

    An academy is a brand that sells education; it must be selectable wherever a
    brand is. This is half of the asymmetry that defines the model.
    """
    return [b for b in list_brands()
            if _kind_of(b) in BRAND_KINDS and (include_retired or _is_active(b))]


def whitelabel_options(include_retired: bool = False) -> List[dict]:
    """Everything selectable in a WHITE-LABEL picker — never an academy.

    The other half of the asymmetry. Letting an academy front another brand here
    would poison every picker, count and filter with a special case; if one
    genuinely needs to, register it twice under distinct names so `kind` stays
    unambiguous.
    """
    return [b for b in list_brands()
            if _kind_of(b) == "whitelabel" and (include_retired or _is_active(b))]


def prop_options(include_retired: bool = False) -> List[dict]:
    """The prop-firm reporting bucket. Like academies, NOT a structural role —
    these all also appear in brand_options()."""
    return [b for b in list_brands()
            if _kind_of(b) == "prop" and (include_retired or _is_active(b))]


def academy_options(include_retired: bool = False) -> List[dict]:
    """The academy admin/reporting bucket. NOT a structural role — these all
    also appear in brand_options()."""
    return [b for b in list_brands()
            if _kind_of(b) == "academy" and (include_retired or _is_active(b))]


def find_by_name(name: Any) -> Optional[dict]:
    """Registry lookup by name, case- and separator-insensitive via the one
    shared normaliser — so 'Digital-Spearhead' and 'Digital Spearhead' resolve
    to the same entity."""
    slug = normalise_name(name)
    if not slug:
        return None
    return next((b for b in list_brands() if normalise_name(b.get("name")) == slug), None)


def get_brand(brand_id: str) -> Optional[dict]:
    """One brand by id (built-in incl. overrides, or stored), or None."""
    if not brand_id:
        return None
    stored = _load()
    for b in BUILTIN_BRANDS:
        if b.get("id") == brand_id:
            return _merged_builtin(b, stored)
    for b in stored:
        if b.get("id") == brand_id:
            return b
    return None


# --- Validation / coercion ---------------------------------------------------
def _clean_colors(colors: Any) -> List[str]:
    """Keep only well-formed #RGB / #RRGGBB hex strings, uppercased, deduped."""
    if not isinstance(colors, list):
        return []
    out: List[str] = []
    for c in colors:
        if isinstance(c, str) and _HEX_RE.match(c.strip()):
            h = c.strip().upper()
            if h not in out:
                out.append(h)
    return out[:_MAX_COLORS]


_MAX_LOGO_CHARS = 2_000_000  # ~2MB cap on the logo string (inline SVG / data: URI)


def _clean_logo(logo_svg: Any) -> Optional[str]:
    if logo_svg is None:
        return None
    if isinstance(logo_svg, str):
        # Reject an oversized payload before storing it (DoS / memory bloat).
        if len(logo_svg) > _MAX_LOGO_CHARS:
            raise HTTPException(status_code=422, detail="logo is too large")
        s = logo_svg.strip()
        return s or None
    return None


def _clean_text(value: Any, limit: int = 200) -> Optional[str]:
    """A short free-text brand-kit hint (typography / tone of voice), trimmed."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    return s[:limit] or None


def _clean_accent(value: Any) -> Optional[str]:
    """A single #RGB/#RRGGBB accent / CTA-colour hint, uppercased, or None."""
    if isinstance(value, str) and _HEX_RE.match(value.strip()):
        return value.strip().upper()
    return None


def resolve_accent(entity: dict) -> Optional[str]:
    """The ONE colour an entity contributes to a card tint / stripe.

    The explicit accent wins, else the first palette colour. Callers layer the
    white-label-beats-brand precedence on top of this (the WL is what the
    visitor actually sees, so its colour wins); returning None here lets them
    fall through to the next entity rather than to a neutral too early.
    """
    accent = _clean_accent(entity.get("accent"))
    if accent:
        return accent
    colors = _clean_colors(entity.get("colors"))
    return colors[0] if colors else None


def _public(brand: dict) -> dict:
    """The Brand shape returned to clients (stable key order)."""
    out: dict = {
        "id": brand.get("id"),
        "name": brand.get("name", ""),
        # Registry role — drives every picker, filter and bucket. Canonicalised,
        # so a legacy 'brand' reaches clients as 'broker'. See ENTITY_KINDS.
        "kind": _kind_of(brand),
        # Retired entities stay readable so historical records keep rendering;
        # they're filtered out of pickers, never deleted.
        "active": brand.get("active", True) is not False,
        # The resolved card colour (accent > first palette colour > none), so
        # every client tints from the same value instead of re-deriving it.
        "resolved_accent": resolve_accent(brand),
        # 'eu' | 'international' | None — which licence this broker runs under.
        "regulation": brand.get("regulation"),
        # Where this entity operates / what it publishes in.
        "markets": _clean_markets(brand.get("markets")),
        "languages": _clean_languages(brand.get("languages")),
        "colors": brand.get("colors", []) or [],
        # --- Logos. Three shapes, each with its own job -----------------------
        # icon_svg   square registry mark (lists, cards, folder tiles)
        # favicon    the tiny mark, for exported pages' <link rel=icon>
        # logo_wide  horizontal lockup for page headers
        # logo_svg   the wordmark composited onto banners (+ dark variant)
        "icon_svg": brand.get("icon_svg"),
        "favicon": brand.get("favicon"),
        "logo_wide": brand.get("logo_wide"),
        "logo_svg": brand.get("logo_svg"),
        "logo_svg_dark": brand.get("logo_svg_dark"),
        # Brand-kit hints (all optional) folded into the art direction at run time.
        "font": brand.get("font"),
        "accent": brand.get("accent"),
        # Page design tokens + type scale (see TOKEN_KEYS / TYPE_ROLES).
        "tokens": _clean_tokens(brand.get("tokens")),
        "typography": _clean_typography(brand.get("typography")),
        "builtin": bool(brand.get("builtin")),
    }
    # Built-ins may annotate each colour with a human role (CTA / Background / …).
    if brand.get("swatches"):
        out["swatches"] = brand["swatches"]
    # Landing-page token hints (website background / card fill) for the LP Builder.
    if brand.get("lp"):
        out["lp"] = brand["lp"]
    return out


def _validate_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="'name' is required")
    return name.strip()[:120]


# --- Router ------------------------------------------------------------------
def build_brands_router() -> APIRouter:
    """Brands CRUD. Mounted under /api/tools/banner-builder by the runs router,
    so the parent's require_user dependency already covers every route; admin
    writes self-gate with require_admin exactly like the tool-config PUT."""
    router = APIRouter()

    @router.get("/brands")
    def get_brands(_user: dict = Depends(require_user)):
        return {"brands": [_public(b) for b in list_brands()]}

    @router.post("/brands")
    def create_brand(payload: dict = Body(default={}), _admin: dict = Depends(require_admin)):
        name = _validate_name(payload.get("name"))
        brand = {
            "id": uuid.uuid4().hex,
            "name": name,
            "kind": _validate_kind(payload.get("kind")),
            "active": payload.get("active", True) is not False,
            "regulation": _validate_regulation(payload.get("regulation")),
            "markets": _clean_markets(payload.get("markets")),
            "languages": _clean_languages(payload.get("languages")),
            "colors": _clean_colors(payload.get("colors")),
            "icon_svg": _clean_logo(payload.get("icon_svg")),
            "favicon": _clean_logo(payload.get("favicon")),
            "logo_wide": _clean_logo(payload.get("logo_wide")),
            "logo_svg": _clean_logo(payload.get("logo_svg")),
            "logo_svg_dark": _clean_logo(payload.get("logo_svg_dark")),
            "font": _clean_text(payload.get("font")),
            "accent": _clean_accent(payload.get("accent")),
            "tokens": _clean_tokens(payload.get("tokens")),
            "typography": _clean_typography(payload.get("typography")),
        }
        brands = _load()
        brands.append(brand)
        _save(brands)
        return {"brand": _public(brand)}

    def _apply_patch(b: dict, payload: dict) -> None:
        """Partial update: only the keys present in the body change."""
        if "name" in payload:
            b["name"] = _validate_name(payload.get("name"))
        if "kind" in payload:
            b["kind"] = _validate_kind(payload.get("kind"))
        if "active" in payload:
            b["active"] = payload.get("active") is not False
        if "regulation" in payload:
            b["regulation"] = _validate_regulation(payload.get("regulation"))
        if "markets" in payload:
            b["markets"] = _clean_markets(payload.get("markets"))
        if "languages" in payload:
            b["languages"] = _clean_languages(payload.get("languages"))
        if "colors" in payload:
            b["colors"] = _clean_colors(payload.get("colors"))
        if "icon_svg" in payload:
            b["icon_svg"] = _clean_logo(payload.get("icon_svg"))
        if "favicon" in payload:
            b["favicon"] = _clean_logo(payload.get("favicon"))
        if "logo_wide" in payload:
            b["logo_wide"] = _clean_logo(payload.get("logo_wide"))
        if "logo_svg" in payload:
            b["logo_svg"] = _clean_logo(payload.get("logo_svg"))
        if "logo_svg_dark" in payload:
            b["logo_svg_dark"] = _clean_logo(payload.get("logo_svg_dark"))
        if "font" in payload:
            b["font"] = _clean_text(payload.get("font"))
        if "accent" in payload:
            b["accent"] = _clean_accent(payload.get("accent"))
        if "tokens" in payload:
            b["tokens"] = _clean_tokens(payload.get("tokens"))
        if "typography" in payload:
            b["typography"] = _clean_typography(payload.get("typography"))
        if "lp" in payload and isinstance(payload.get("lp"), dict):
            lp = {k: v.strip().upper() for k, v in payload["lp"].items()
                  if k in ("bg", "card") and isinstance(v, str) and _HEX_RE.match(v.strip())}
            b["lp"] = lp or None

    @router.put("/brands/{brand_id}")
    def update_brand(brand_id: str, payload: dict = Body(default={}),
                     _admin: dict = Depends(require_admin)):
        brands = _load()
        # Built-ins are editable too: the edit is stored as an OVERRIDE record
        # under the same id (the code defaults stay as the fallback; deleting
        # the brand later resets it to those defaults).
        if brand_id in _BUILTIN_IDS:
            override = next((b for b in brands if b.get("id") == brand_id), None)
            if override is None:
                base = next(b for b in BUILTIN_BRANDS if b["id"] == brand_id)
                override = {k: v for k, v in base.items() if k != "builtin"}
                brands.append(override)
            _apply_patch(override, payload)
            _save(brands)
            return {"brand": _public(_merged_builtin(
                next(b for b in BUILTIN_BRANDS if b["id"] == brand_id), brands))}
        for b in brands:
            if b.get("id") == brand_id:
                _apply_patch(b, payload)
                _save(brands)
                return {"brand": _public(b)}
        raise HTTPException(status_code=404, detail="brand not found")

    @router.delete("/brands/{brand_id}", status_code=204)
    def delete_brand(brand_id: str, _admin: dict = Depends(require_admin)):
        brands = _load()
        if brand_id in _BUILTIN_IDS:
            # For a built-in, delete = RESET to the shipped defaults.
            kept = [b for b in brands if b.get("id") != brand_id]
            if len(kept) == len(brands):
                raise HTTPException(status_code=409,
                                    detail="Built-in brands can't be deleted — and this one has no edits to reset.")
            _save(kept)
            return Response(status_code=204)
        kept = [b for b in brands if b.get("id") != brand_id]
        if len(kept) == len(brands):
            raise HTTPException(status_code=404, detail="brand not found")
        _save(kept)
        return Response(status_code=204)

    return router


__all__ = [
    "build_brands_router", "list_brands", "get_brand", "BRANDS_PATH",
    "ENTITY_KINDS", "DEFAULT_KIND", "BRAND_KINDS",
    "normalise_name", "is_no_whitelabel", "resolve_accent", "find_by_name",
    "brand_options", "whitelabel_options", "academy_options", "prop_options",
]

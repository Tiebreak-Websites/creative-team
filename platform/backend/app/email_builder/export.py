"""CRM Email Builder — the compositor.

compose_email() is the ONE place a campaign becomes HTML, for every consumer:
the builder canvas, the preview, and the export. Same rule the LP Builder
follows — two compositors drift, and the one you don't preview is the one that
ships.

What is different from the LP compositor, and why (see platform/EMAIL_HTML.md):
  - colours are substituted as LITERAL HEX, never CSS custom properties
  - layout is nested <table>, never flexbox
  - styles are already inline on every element; there is no stylesheet to link
  - images must be ABSOLUTE https URLs, because the recipient has no session
  - the logo is rasterised to PNG, because no mail client renders SVG
  - a text/plain alternative is generated alongside, because its absence
    raises spam score
"""
from __future__ import annotations

import html as _html
import io
import logging
import re
from typing import Callable, Dict, List, Optional

from . import core
from .blocks import W as EMAIL_W

log = logging.getLogger(__name__)

# ---------------------------------------------------------------- sanitizers

# Root-relative is allowed so the in-app preview resolves against our own
# origin. It is NOT good enough to send — an inbox has no origin to resolve
# against — so compose_email raises a warning when any survives, rather than
# silently dropping the image and looking like a missing asset.
_URL_OK = re.compile(r"^(https?:|mailto:|tel:|#|/|\{\{)", re.I)


def _esc(s: str) -> str:
    return _html.escape(str(s or ""), quote=False)


def _attr(s: str) -> str:
    return _html.escape(str(s or ""), quote=True)


def _safe_url(u: str) -> str:
    """Email links must be absolute. A relative href has no origin to resolve
    against in a mail client, so it silently goes nowhere."""
    u = str(u or "").strip()
    if not u:
        return ""
    return u if _URL_OK.match(u) else ""


_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _safe_colour(v: str, fallback: str) -> str:
    v = str(v or "").strip()
    if not _HEX_RE.match(v):
        return fallback
    if len(v) == 4:  # #abc -> #aabbcc; Word does not expand shorthand reliably
        return "#" + "".join(c * 2 for c in v[1:]).upper()
    return v.upper()


# ------------------------------------------------------------ brand → tokens

def resolve_tokens(project: dict, entity: Optional[dict]) -> Dict[str, str]:
    """Literal values for every {{token}}, brand first, defaults behind."""
    out = dict(core.DEFAULT_TOKENS)
    if entity:
        btok = entity.get("tokens") or {}
        colors = [c for c in (entity.get("colors") or []) if c]
        # Same precedence the LP builder uses: an explicit token wins, then
        # palette position, then the default.
        for key in out:
            if btok.get(key):
                out[key] = btok[key]
        if not btok.get("primary") and colors:
            out["primary"] = colors[0]
        if not btok.get("accent") and len(colors) > 1:
            out["accent"] = colors[1]
        if not btok.get("cta"):
            out["cta"] = entity.get("accent") or out["primary"]
    for k, v in (project.get("tokens") or {}).items():
        if k in out and v:
            out[k] = v

    for k, default in core.DEFAULT_TOKENS.items():
        out[k] = _safe_colour(out[k], default)

    # Non-colour tokens. The brand font is deliberately NOT used: it renders in
    # Apple Mail and almost nowhere else, so the stack has to stand alone.
    out["font"] = core.DEFAULT_FONT
    out["brand_name"] = _attr((entity or {}).get("name") or project.get("name") or "")
    return out


# EU entities must carry the ESMA/CySEC CFD loss disclosure; international ones
# a general risk statement. Derived from the registry's `regulation` field so a
# campaign cannot ship the wrong regulator's wording by hand-editing.
RISK_WARNING = {
    "eu": ("CFDs are complex instruments and come with a high risk of losing money "
           "rapidly due to leverage. You should consider whether you understand how "
           "CFDs work and whether you can afford to take the high risk of losing "
           "your money."),
    "international": ("Trading involves significant risk and may not be suitable for "
                      "all investors. You may lose more than your initial investment. "
                      "Past performance is not indicative of future results."),
}


def compliance_texts(entity: Optional[dict]) -> Dict[str, str]:
    """Footer copy the campaign author does not get to invent."""
    reg = str((entity or {}).get("regulation") or "").lower()
    out: Dict[str, str] = {}
    if reg in RISK_WARNING:
        out["risk_warning"] = RISK_WARNING[reg]
    # `address` is intentionally absent until the registry carries a postal
    # address per entity — a placeholder here would ship as real text and
    # CAN-SPAM requires a genuine one.
    return out


# ------------------------------------------------------------------- logos

def rasterise_svg(svg: str, width: int = 320) -> Optional[bytes]:
    """SVG logo -> PNG bytes. None when no rasteriser is available.

    Guarded the same way banner_engine.logo_overlay guards it: cairosvg needs
    the native libcairo, which the Docker image installs but a local macOS venv
    typically lacks. Callers must handle None rather than assume a logo.
    """
    try:
        import cairosvg  # noqa: PLC0415 — optional native dep
    except Exception as exc:
        log.warning("email-builder: no SVG rasteriser available (%s)", exc)
        return None
    try:
        return cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=width)
    except Exception:
        log.exception("email-builder: could not rasterise brand logo")
        return None


# --------------------------------------------------------------- slot filling

def _texts_for(block: dict, lang: str) -> Dict[str, str]:
    """English is the base, the target language overlays it — so a partially
    translated block falls back per key instead of going blank."""
    t = dict((block.get("texts") or {}).get("en") or {})
    if lang != "en":
        t.update((block.get("texts") or {}).get(lang) or {})
    return t


def _fill_text(html: str, key: str, value: str, rich: bool) -> str:
    attr = "data-em-rich" if rich else "data-em-text"
    safe = _esc(value)
    if rich:
        safe = safe.replace("\n", "<br>")
    pattern = re.compile(rf'({attr}="{re.escape(key)}"[^>]*>)[^<]*(</)')
    return pattern.sub(lambda m: m.group(1) + safe + m.group(2), html, count=1)


def _fill_attr(html: str, marker: str, key: str, attr: str, value: str) -> str:
    """Rewrite an existing attribute, or inject it when the tag lacks one."""
    tag_re = re.compile(rf'(<[^>]*{marker}="{re.escape(key)}"[^>]*>)')

    def sub(m: "re.Match") -> str:
        tag = m.group(1)
        if re.search(rf'\s{attr}="', tag):
            return re.sub(rf'(\s{attr}=")[^"]*(")', lambda a: a.group(1) + value + a.group(2), tag, count=1)
        return tag[:-1] + f' {attr}="{value}">'

    return tag_re.sub(sub, html, count=1)


def _drop_img(html: str, key: str) -> str:
    """Remove an <img> whose slot was never filled."""
    return re.sub(rf'<img[^>]*data-em-img="{re.escape(key)}"[^>]*>', "", html, count=1)


def compose_block(block: dict, inst: dict, lang: str,
                  resolve_img: Callable[[str], str]) -> str:
    html = block.get("html") or ""
    defaults = _texts_for(block, lang)
    texts = {**defaults, **(inst.get("texts") or {})}
    images = inst.get("images") or {}
    links = inst.get("links") or {}

    for f in core.parse_fields(html)["fields"]:
        key, kind = f["key"], f["kind"]
        if kind in ("text", "rich"):
            if key in texts:
                html = _fill_text(html, key, texts[key], rich=(kind == "rich"))
        elif kind == "img":
            raw = images.get(key) or (block.get("assets") or {}).get(key) or ""
            url = _safe_url(resolve_img(raw)) if raw else ""
            if url:
                html = _fill_attr(html, "data-em-img", key, "src", _attr(url))
            else:
                # Drop the element entirely rather than ship src="". An <img>
                # with an empty src renders as a broken-image icon in every
                # client — worse than the slot simply not being there.
                html = _drop_img(html, key)
        elif kind == "link":
            url = _safe_url(links.get(key) or "")
            if url:
                html = _fill_attr(html, "data-em-link", key, "href", _attr(url))
    return html


def _apply_tokens(html: str, tokens: Dict[str, str]) -> str:
    """Substitute {{token}} with its literal value.

    An unknown token resolves to empty rather than being left as literal
    '{{typo}}' text in someone's inbox.
    """
    return core.TOKEN_RE.sub(lambda m: tokens.get(m.group(1), ""), html)


# ------------------------------------------------------------------ compose

_SKELETON = """<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" \
"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="{lang}" dir="{dir}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>{title}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style type="text/css">
/* Progressive enhancement only — assume any client may drop this block.
   Everything load-bearing is already inline on the elements themselves. */
body {{ margin:0 !important; padding:0 !important; width:100% !important; }}
table {{ border-collapse:collapse; }}
img {{ -ms-interpolation-mode:bicubic; }}
a {{ text-decoration:none; }}
@media only screen and (max-width:{w}px) {{
  .em-card {{ width:100% !important; }}
  .em-pad {{ padding-left:20px !important; padding-right:20px !important; }}
  .em-h1 {{ font-size:24px !important; line-height:30px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background-color:{bg};">
<div style="display:none;font-size:1px;color:{bg};line-height:1px;max-height:0;\
max-width:0;opacity:0;overflow:hidden;">{preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="background-color:{bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="em-card" cellpadding="0" cellspacing="0" border="0" \
width="{w}" style="width:{w}px;max-width:{w}px;background-color:{card};">
{body}
</table>
</td></tr>
</table>
</body>
</html>"""

# Arabic, Hebrew, Farsi, Urdu. Same list the banner engine uses.
_RTL_LANGS = {"ar", "he", "fa", "ur"}


def compose_email(project: dict, blocks_map: Dict[str, dict],
                  resolve_img: Callable[[str], str],
                  entity: Optional[dict] = None) -> Dict[str, object]:
    """Returns {"html", "text", "size_bytes", "warnings"}."""
    lang = str(project.get("language") or "en")
    tokens = resolve_tokens(project, entity)
    forced = compliance_texts(entity)

    rows: List[str] = []
    for inst in project.get("sections") or []:
        block = blocks_map.get(inst.get("block_key") or "")
        if not block:
            continue
        inst = dict(inst)
        if block.get("key") == "em-footer" and forced:
            # Compliance copy wins over whatever is stored on the instance:
            # the regulator's wording is not the author's to edit.
            inst["texts"] = {**(inst.get("texts") or {}), **forced}
        rows.append(compose_block(block, inst, lang, resolve_img))

    body = "\n".join(rows)
    html = _SKELETON.format(
        lang=_attr(lang),
        dir="rtl" if lang.lower().split("-")[0] in _RTL_LANGS else "ltr",
        title=_esc(project.get("subject") or project.get("name") or ""),
        preheader=_esc(project.get("preheader") or ""),
        bg=tokens["bg"], card=tokens["card"], w=EMAIL_W, body=body,
    )
    html = _apply_tokens(html, tokens)

    size = len(html.encode("utf-8"))
    warnings: List[str] = []
    if size > core.SIZE_LIMIT_BYTES:
        warnings.append(
            f"{size // 1024}KB — over Gmail's ~102KB clip. Everything below the "
            "clip, including the unsubscribe link, will be hidden behind "
            "'View entire message'.")
    elif size > core.SIZE_WARN_BYTES:
        warnings.append(f"{size // 1024}KB — approaching Gmail's ~102KB clip limit.")

    empty_slots = sum(1 for i in project.get("sections") or []
                      for f in core.parse_fields((blocks_map.get(i.get("block_key") or "") or {}).get("html") or "")["fields"]
                      if f["kind"] == "img" and not (i.get("images") or {}).get(f["key"]))
    if empty_slots:
        warnings.append(f"{empty_slots} image slot(s) empty — those images are omitted "
                        "from the email entirely.")

    # A relative src works in this preview and in no inbox anywhere. Surfacing
    # it here is the difference between catching it now and catching it from a
    # recipient asking why the email has no logo.
    if 'src="/' in html:
        warnings.append(
            "Image URLs are relative, so they will not load in an inbox. Set "
            "PLATFORM_PUBLIC_BASE_URL to this deployment's public origin.")
    if not any(b.get("key") == "em-footer" for b in
               (blocks_map.get(i.get("block_key") or "") or {} for i in project.get("sections") or [])):
        warnings.append("No footer block — an unsubscribe link and postal address are required.")

    return {"html": html, "text": to_plain_text(html),
            "size_bytes": size, "warnings": warnings}


# ------------------------------------------------------------- plain text

_TAG_RE = re.compile(r"<[^>]+>")
_BLOCKS_RE = re.compile(r"</\s*(p|h1|h2|h3|tr|td|div)\s*>", re.I)


def to_plain_text(html: str) -> str:
    """A text/plain alternative. Its absence raises spam score on its own, and
    some corporate gateways strip HTML entirely."""
    body = re.sub(r"(?is)<head\b.*?</head>", " ", html)
    body = re.sub(r"(?is)<style\b.*?</style>", " ", body)
    # Keep the destination: a bare label is useless without its URL in text.
    body = re.sub(r'(?is)<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                  lambda m: f"{_TAG_RE.sub('', m.group(2)).strip()} <{m.group(1)}>",
                  body)
    body = _BLOCKS_RE.sub("\n", body)
    body = re.sub(r"(?i)<br\s*/?>", "\n", body)
    body = _TAG_RE.sub("", body)
    body = _html.unescape(body)
    lines = [ln.strip() for ln in body.splitlines()]
    out, blank = [], 0
    for ln in lines:
        if ln:
            out.append(ln)
            blank = 0
        else:
            blank += 1
            if blank == 1 and out:
                out.append("")
    return "\n".join(out).strip() + "\n"

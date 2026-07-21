"""AI hero-image generation for campaign emails.

The banner engine's shape, scaled to one image: an ART DIRECTOR pass
(gpt-5.5, strict JSON) turns the author's brief + the brand's settings into
concrete creative direction, then gpt-image-2 renders it. Two modes:

  with_text     the headline is painted INTO the image, verbatim — the banner
                engine's copy contract, typography hinted from the brand font
  without_text  a pure visual; any text at all is a defect

Brand styling is not optional garnish: the palette, accent and font come from
Settings > Brands and are written into both the director's context and the
image prompt, the same way runner._resolve_brand feeds banners.

The finished image is center-cropped to the hero's 2:1 frame, resized to 2x
display (1072x536) and saved as an optimised JPEG — photographic heroes as
PNG run to megabytes, and a slow-loading hero is a skipped email.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import urllib.error
import urllib.request
import uuid
from typing import Optional, Tuple

from ..secrets import get_secret
from ..settings import settings
from . import core

log = logging.getLogger(__name__)

# 3:2 is the closest gpt-image-2 landscape size to the hero's 2:1 — generated
# once, cropped down, never upscaled.
_GEN_SIZE = "1536x1024"
_OUT_W, _OUT_H = 1072, 536  # 2x the 536px the hero renders at

_DIRECTOR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["creative_brief"],
    "properties": {
        "creative_brief": {
            "type": "string",
            "description": "250-450 chars of concrete visual direction: subject, "
                           "composition for a wide 2:1 crop, lighting, mood, how "
                           "the brand colours appear.",
        },
    },
}

_DIRECTOR_SYSTEM = (
    "You are the art director for a financial-education brand's email campaigns. "
    "You write concrete, photographable creative direction for ONE wide hero "
    "image (2:1). Concrete means: subject, framing, lighting, palette placement "
    "— never vague adjectives. The composition must keep the focal subject "
    "inside the middle 80% so a 2:1 crop cannot behead it. No text, logos or "
    "watermarks are ever part of the scene itself."
)


def _style_from_brand(entity: Optional[dict]) -> str:
    """The brand's settings as prompt prose — palette, accent, type feel.

    Mirrors what runner._resolve_brand does for banners, so both generators
    speak about a brand in the same terms.
    """
    if not entity:
        return "Clean, modern, trustworthy financial-education look."
    bits = []
    colors = [c for c in (entity.get("colors") or []) if c][:4]
    if colors:
        bits.append(f"Brand palette: {', '.join(colors)} — keep the image on-brand "
                    "using these colours.")
    accent = entity.get("accent") or (entity.get("tokens") or {}).get("cta")
    if accent:
        bits.append(f"Prefer {accent} as the accent where it keeps strong contrast.")
    if entity.get("font"):
        bits.append(f"Brand typography to echo if any text is rendered: {entity['font']}.")
    reg = str(entity.get("regulation") or "")
    if reg:
        bits.append("Regulated financial brand: professional, credible, no hype.")
    return " ".join(bits) or "Clean, modern, trustworthy financial-education look."


def _direct(api_key: str, *, brief: str, style: str, with_text: bool,
            headline: str, subtitle: str) -> str:
    """The art-director pass. Falls back to a deterministic brief on any
    failure — the banner engine's rule: validate and degrade, never block."""
    from .. import lp_materials

    text_line = (
        f'The image will carry this exact headline text: "{headline}"'
        + (f' and subtitle: "{subtitle}"' if subtitle else "")
        + ". Direct a composition with a calm area where that text sits legibly."
        if with_text else
        "The image carries NO text at all — direct a pure visual."
    )
    user = (f"Campaign brief from the author: {brief or 'general brand campaign'}\n"
            f"Brand look: {style}\n{text_line}")
    try:
        out = lp_materials._llm_json(
            api_key, system=_DIRECTOR_SYSTEM, user_text=user,
            schema_name="email_hero_direction", schema=_DIRECTOR_SCHEMA,
            effort="medium", timeout=90)
        got = str(out.get("creative_brief") or "").strip()
        if 80 <= len(got) <= 900:
            return got
    except Exception:
        log.exception("email-hero: director failed, using deterministic brief")
    return (f"{brief or 'A confident, welcoming financial-education scene'}. "
            f"Wide 2:1 composition, focal subject centered, soft directional "
            f"lighting, professional and optimistic. {style}")


def _image_prompt(direction: str, style: str, with_text: bool,
                  headline: str, subtitle: str) -> str:
    parts = [
        "Design a wide hero image for a marketing email (2:1 landscape crop "
        "from a 3:2 frame — keep every important element inside the central "
        "band).",
        f"Creative direction: {direction}",
        f"Brand style: {style}",
    ]
    if with_text:
        parts.append(
            'RENDER THIS TEXT, EXACTLY ONCE, VERBATIM, CORRECTLY SPELLED: '
            f'"{headline}"'
            + (f' with the smaller subtitle: "{subtitle}"' if subtitle else "")
            + ". No other words, labels or invented text anywhere. The text must "
              "be large, high-contrast and legible at half size.")
    else:
        parts.append(
            "ABSOLUTELY NO TEXT of any kind: no words, letters, numbers, "
            "captions, watermarks, logos or UI labels anywhere in the image.")
    parts.append(
        "Never include: watermarks, stock-photo text, third-party logos, "
        "readable fake interfaces, real people's likenesses, distorted hands "
        "or faces.")
    return "\n\n".join(parts)


def _generate_png(api_key: str, prompt: str) -> bytes:
    payload = json.dumps({
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": _GEN_SIZE,
        "n": 1,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=payload,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {api_key}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=settings.OPENAI_IMAGE_TIMEOUT) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log.error("email-hero: image API %s: %s", e.code, detail)
        raise RuntimeError(f"Image generation failed (HTTP {e.code}).")
    except Exception as e:
        raise RuntimeError(f"Image generation failed: {e}")
    try:
        return base64.b64decode(body["data"][0]["b64_json"])
    except Exception:
        raise RuntimeError("Image generation returned no image data.")


def _finish(png: bytes) -> Tuple[str, int]:
    """Center-crop 3:2 -> 2:1, resize to 2x display, save optimised JPEG.
    Returns (asset_id, bytes_written)."""
    from PIL import Image

    im = Image.open(io.BytesIO(png))
    im.load()
    if im.mode != "RGB":
        im = im.convert("RGB")
    target = _OUT_W / _OUT_H
    w, h = im.size
    want_h = int(w / target)
    if want_h <= h:
        top = (h - want_h) // 2
        im = im.crop((0, top, w, top + want_h))
    else:
        want_w = int(h * target)
        left = (w - want_w) // 2
        im = im.crop((left, 0, left + want_w, h))
    im = im.resize((_OUT_W, _OUT_H), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True, progressive=True)
    aid = uuid.uuid4().hex + ".jpg"
    core.ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    (core.ASSETS_DIR / aid).write_bytes(buf.getvalue())
    return aid, buf.getbuffer().nbytes


def generate_hero(*, entity: Optional[dict], brief: str, with_text: bool,
                  headline: str = "", subtitle: str = "") -> dict:
    """The whole pipeline. Raises LookupError when no API key is configured,
    ValueError for blocked content, RuntimeError for generation failures."""
    api_key = get_secret("OPENAI_API_KEY")
    if not api_key:
        raise LookupError("OPENAI_API_KEY")

    if with_text and not headline.strip():
        raise ValueError("With-text mode needs a headline to render.")

    # Same pre-flight the banner engine runs BEFORE spending an API call.
    try:
        from ..banner_engine.prompts import check_moderation
        ok, why = check_moderation({"title": headline or brief,
                                    "subtitle": subtitle,
                                    "creative_brief": brief})
        if not ok:
            raise ValueError(f"Blocked: {why}")
    except ValueError:
        raise
    except Exception:
        log.exception("email-hero: moderation check unavailable, continuing")

    style = _style_from_brand(entity)
    direction = _direct(api_key, brief=brief, style=style, with_text=with_text,
                        headline=headline.strip(), subtitle=subtitle.strip())
    prompt = _image_prompt(direction, style, with_text,
                           headline.strip(), subtitle.strip())
    png = _generate_png(api_key, prompt)
    aid, nbytes = _finish(png)
    log.info("email-hero: generated %s (%d bytes)", aid, nbytes)
    return {"id": aid, "direction": direction}

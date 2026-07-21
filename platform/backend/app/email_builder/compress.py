"""Post-approval image compression via the Tinify (TinyPNG) API.

Runs when a campaign flips to Approved — the moment the design is final, per
the workflow this tool models. Compressing earlier wastes the monthly Tinify
quota on drafts that will be regenerated; compressing later never happens.

Rules the implementation enforces:
  - best effort, never blocks approval — a compression hiccup is not a reason
    a finished campaign cannot ship
  - idempotent per asset: a marker file records what has been squeezed, so
    re-approving does not re-spend quota on the same bytes
  - in place, same filename: the composed email's URL stays stable
  - only this campaign's raster images; SVGs and the grey placeholder are
    skipped (the placeholder should be replaced, not optimised)

Dormant until TINIFY_API_KEY is configured (free tier: 500 images/month) —
the same graceful-424 discipline as the OpenAI features, minus the 424: an
absent key simply logs and skips.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Dict, List

from ..secrets import get_secret
from . import core

log = logging.getLogger(__name__)

_SHRINK_URL = "https://api.tinify.com/shrink"
_MARKER = core.ASSETS_DIR / "_tinified.json"
_ASSET_RE = re.compile(r"^(?:[0-9a-f]{32}|logo-[0-9a-f]{24})\.(?:png|jpg)$")


def _marked() -> set:
    try:
        return set(json.loads(_MARKER.read_text(encoding="utf-8")))
    except Exception:
        return set()


def _mark(aids: set) -> None:
    try:
        _MARKER.parent.mkdir(parents=True, exist_ok=True)
        _MARKER.write_text(json.dumps(sorted(aids)), encoding="utf-8")
    except Exception:
        log.exception("tinify: could not persist the compressed-marker file")


def _shrink(api_key: str, data: bytes) -> bytes:
    """One round trip: POST the bytes, GET the compressed result."""
    auth = base64.b64encode(f"api:{api_key}".encode()).decode()
    req = urllib.request.Request(
        _SHRINK_URL, data=data, method="POST",
        headers={"Authorization": f"Basic {auth}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        location = r.headers.get("Location")
    if not location:
        raise RuntimeError("Tinify returned no result location.")
    req2 = urllib.request.Request(location, headers={"Authorization": f"Basic {auth}"})
    with urllib.request.urlopen(req2, timeout=60) as r2:
        return r2.read()


def campaign_asset_ids(campaign: dict) -> List[str]:
    """The compressible local assets this campaign references."""
    out: List[str] = []
    for s in campaign.get("sections") or []:
        for v in (s.get("images") or {}).values():
            v = str(v or "").strip()
            if v.startswith("placeholder"):
                continue
            if _ASSET_RE.match(v) and v not in out:
                out.append(v)
    return out


def compress_campaign_assets(campaign: dict) -> Dict[str, int]:
    """Squeeze every unmarked raster this campaign uses. Returns a summary.

    Raises LookupError when no TINIFY_API_KEY is configured; anything else is
    caught per-file so one bad image cannot abort the rest.
    """
    api_key = get_secret("TINIFY_API_KEY")
    if not api_key:
        raise LookupError("TINIFY_API_KEY")

    done = _marked()
    files = saved = 0
    for aid in campaign_asset_ids(campaign):
        if aid in done:
            continue
        path = core.ASSETS_DIR / aid
        if not path.is_file():
            continue
        try:
            before = path.stat().st_size
            smaller = _shrink(api_key, path.read_bytes())
            if 0 < len(smaller) < before:
                path.write_bytes(smaller)
                saved += before - len(smaller)
            # Marked even when Tinify could not beat us — the answer for these
            # bytes is known either way, and quota is finite.
            done.add(aid)
            files += 1
        except urllib.error.HTTPError as e:
            log.error("tinify: %s on %s — %s", e.code, aid,
                      e.read().decode("utf-8", "replace")[:200])
        except Exception:
            log.exception("tinify: failed on %s", aid)
    if files:
        _mark(done)
    return {"files": files, "saved_bytes": saved}

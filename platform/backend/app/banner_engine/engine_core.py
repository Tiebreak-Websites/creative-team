"""engine_core.py — pure OpenAI image gen/edit core for banner-openai.

Extracted from run.py so BOTH the CLI runner (run.py) and the web platform
backend (platform/backend) can share ONE generation path. This module has:
  - no file I/O (except reading the master PNG in edit mode),
  - no Figma paint,
  - no argparse, no sys.exit, no logging side effects.

`generate_png()` owns the 429 exponential-backoff retry loop and returns raw
PNG bytes, raising `GenError(status, message)` on terminal failure using the
exact status vocabulary run.py writes to results.json, so every caller maps
errors identically.

Stdlib only (urllib) — same constraint as the rest of the engine.
"""

import os
import io
import json
import uuid
import time
import base64
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Frame size -> OpenAI-supported generation size.
# Single source of truth shared by run.py callers (which pass openaiSize
# explicitly in urls.json) and the web backend (which derives it from the
# target frame size). OpenAI only accepts these three sizes.
# ---------------------------------------------------------------------------
OPENAI_SIZE_MAP = {
    "1200x1200": "1024x1024",
    "1080x1080": "1024x1024",
    "1200x628":  "1536x1024",
    "1920x1080": "1536x1024",
    "1200x960":  "1536x1024",
    "1080x1920": "1024x1536",
    "1080x1350": "1024x1536",
    "960x1200":  "1024x1536",
    # Additional platform export sizes (mapped to the nearest OpenAI aspect).
    "800x800":   "1024x1024",
    "600x600":   "1024x1024",
    "1200x800":  "1536x1024",
    "1200x674":  "1536x1024",
    "1280x720":  "1536x1024",
    "1440x1800": "1024x1536",
    "1200x1500": "1024x1536",
    "720x1280":  "1024x1536",
    # Display-ad slots — generated at the nearest aspect, then cover-cropped to
    # exact pixels (see banner_engine/reshape.py + runner).
    "300x250":   "1024x1024",
    "728x90":    "1536x1024",
    "970x250":   "1536x1024",
    "320x50":    "1536x1024",
    "1200x300":  "1536x1024",
    "512x128":   "1536x1024",
    "300x60":    "1536x1024",
    "160x600":   "1024x1536",
    "300x600":   "1024x1536",
    "600x315":   "1536x1024",
    "600x500":   "1024x1024",
}

OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations"
OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits"


class GenError(Exception):
    """Terminal generation failure carrying a run.py-compatible status string.

    `status` is one of:
        gen_failed, gen_http_error, edit_failed, edit_http_error, master_missing
    """

    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(f"{status}: {message}")


def post_images_generations(api_key, prompt, openai_size, model, quality, timeout):
    """POST JSON to /v1/images/generations. Returns PNG bytes.

    Raises urllib.error.HTTPError on HTTP failure (caller owns 429/backoff).
    Raises GenError('gen_failed', ...) if the response carries no b64 image.
    """
    payload = json.dumps({
        "model": model, "prompt": prompt, "n": 1,
        "size": openai_size, "quality": quality,
        "output_format": "png",
    }).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_GENERATIONS_URL, data=payload, method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    data = json.loads(body)
    b64 = data["data"][0].get("b64_json")
    if not b64:
        raise GenError("gen_failed", "no b64_json in response")
    return base64.b64decode(b64)


def post_images_edits(api_key, prompt, master_png_path, openai_size, model, quality, timeout):
    """POST multipart/form-data to /v1/images/edits with the master image.

    stdlib only - assembles the multipart body manually. Returns PNG bytes.
    Moved verbatim from run.py v1.7 (signature unchanged).
    """
    if not os.path.exists(master_png_path):
        raise FileNotFoundError(f"master_png not found: {master_png_path}")
    with open(master_png_path, "rb") as fh:
        master_bytes = fh.read()

    boundary = "----banner-openai-" + uuid.uuid4().hex
    crlf = b"\r\n"
    body = io.BytesIO()

    def _field(name, value):
        body.write(b"--" + boundary.encode() + crlf)
        body.write(f'Content-Disposition: form-data; name="{name}"'.encode("utf-8") + crlf + crlf)
        body.write(str(value).encode("utf-8") + crlf)

    def _file(name, filename, data, content_type="image/png"):
        body.write(b"--" + boundary.encode() + crlf)
        body.write(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'.encode("utf-8") + crlf)
        body.write(f"Content-Type: {content_type}".encode("utf-8") + crlf + crlf)
        body.write(data + crlf)

    _field("model", model)
    _field("prompt", prompt)
    _field("size", openai_size)
    _field("n", "1")
    _field("quality", quality)
    _file("image[]", os.path.basename(master_png_path), master_bytes)
    body.write(b"--" + boundary.encode() + b"--" + crlf)
    body_bytes = body.getvalue()

    req = urllib.request.Request(
        OPENAI_EDITS_URL,
        data=body_bytes, method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body_resp = resp.read().decode("utf-8")
    data = json.loads(body_resp)
    item = data["data"][0]
    b64 = item.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    url = item.get("url")
    if url:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read()
    raise RuntimeError("edits response had no b64_json and no url")


def generate_png(*, api_key, prompt, mode, openai_size, model="gpt-image-2",
                 quality="medium", master_png_path=None, timeout=120,
                 max_retries=2, base_backoff=8, sleep=time.sleep, on_attempt=None):
    """Generate (mode='gen') or recompose (mode='edit') one PNG; return raw bytes.

    Owns the exponential-backoff retry loop for 429 (rate limit) and 5xx
    (transient OpenAI server errors):
        429 wait = base_backoff * 2**(attempt-1)  ->  8, 16, 32, 64 ...
        5xx wait = 3 * 2**(attempt-1)             ->  3, 6, 12, 24 ...
    Raises GenError(status, message) on terminal failure. Does NOT write to the
    filesystem, does NOT paint, does NOT exit.

    Args:
        mode: "gen" | "edit". master_png_path required iff mode == "edit".
        sleep: injectable sleep (tests pass a spy; backoff calls it on 429 only).
        on_attempt: optional callback(attempt:int) invoked before each try
                    (run.py uses it to log + time the successful attempt).
    """
    is_edit = mode == "edit"
    for attempt in range(1, max_retries + 1):
        if on_attempt:
            on_attempt(attempt)
        try:
            if is_edit:
                if not master_png_path:
                    raise GenError("master_missing", "edit mode requires master_png_path")
                return post_images_edits(api_key, prompt, master_png_path,
                                         openai_size, model, quality, timeout)
            return post_images_generations(api_key, prompt, openai_size,
                                           model, quality, timeout)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            # Retry rate limits (429) AND transient server errors (5xx). OpenAI's
            # own 500 body says "you can retry your request" — a single transient
            # 500 should not fail the whole banner. 429 needs a longer cool-off;
            # 5xx can retry sooner.
            retryable = e.code == 429 or 500 <= e.code < 600
            if retryable and attempt < max_retries:
                wait = base_backoff if e.code == 429 else 3
                sleep(wait * (2 ** (attempt - 1)))
                continue
            status = "edit_http_error" if is_edit else "gen_http_error"
            raise GenError(status, f"HTTP {e.code}: {body[:300]}")
        except FileNotFoundError as e:
            raise GenError("master_missing", str(e))
        except GenError:
            raise
        except Exception as e:
            status = "edit_failed" if is_edit else "gen_failed"
            raise GenError(status, f"{type(e).__name__}: {e}")

    # Unreachable in practice: a final-attempt 429 raises inside the loop above.
    # Kept as a defensive guard so the function never returns None.
    status = "edit_http_error" if is_edit else "gen_http_error"
    raise GenError(status, f"exhausted {max_retries} attempts (429)")

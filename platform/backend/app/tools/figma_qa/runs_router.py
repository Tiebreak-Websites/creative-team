"""Figma QA HTTP routes (mounted at /api/tools/qa).

  POST /run   -> synchronous: fetch + check (+ optional AI tone + optional comments),
                 returns the full result JSON.

Wraps the existing scripts under projects/qa/scripts. Runs are fast (a few
seconds; ~15-30s when the AI tone check is on) so they complete synchronously.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ...secrets import get_secret, has_secret
from ...settings import settings
from . import tone

# Bundled qa scripts under platform/backend/figma_scripts/qa/scripts.
_SCRIPTS_DIR = settings.FIGMA_SCRIPTS_DIR / "qa" / "scripts"
_FETCH = _SCRIPTS_DIR / "fetch.py"
_CHECK = _SCRIPTS_DIR / "check.py"
_POST = _SCRIPTS_DIR / "post.py"

_FIGMA_SECRET = {"env": "FIGMA_API_KEY", "label": "Figma personal access token",
                 "docs_url": "https://www.figma.com/settings", "present": False}

_DEFAULT_VOICE = ("Confident, specific, benefit-led, action-driving. Retail-friendly "
                  "but authoritative. Every headline earns its space.")

# Human-readable section titles for the report, in display order.
_CHECK_TITLES = [
    ("parity", "Cross-device parity"),
    ("placeholder", "Placeholder text"),
    ("broken-image", "Broken images"),
    ("overflow", "Text overflow"),
    ("cta-dummy", "CTA — placeholder label"),
    ("cta-mismatch", "CTA — label mismatch"),
    ("regulator-phrase", "Regulator-unfriendly phrases"),
    ("wrong-language", "Wrong language"),
    ("tone", "Conversion tone"),
]


class QaRequest(BaseModel):
    figma_url: str
    lang: str = "en"
    brand: Optional[str] = None
    post_comments: bool = False
    tone: bool = False


def parse_file_key(url: str) -> Optional[str]:
    """Extract the fileKey: the segment after /file/ or /design/."""
    m = re.search(r"/(?:file|design)/([A-Za-z0-9]+)", url or "")
    if m:
        return m.group(1)
    # Bare key fallback (no slashes, looks like a key).
    s = (url or "").strip()
    if s and re.fullmatch(r"[A-Za-z0-9]+", s):
        return s
    return None


def _run_script(script: Path, args: list[str], token: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "FIGMA_TOKEN": token}
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True, text=True, env=env,
        cwd=str(settings.FIGMA_SCRIPTS_DIR), timeout=180,
    )


def _build_report(file_key: str, file_name: str, lang: str, brand: Optional[str],
                  devices: dict, findings: list, counts: dict) -> str:
    lines = [
        f"# QA report — {file_name or file_key}",
        "",
        f"- File: https://www.figma.com/design/{file_key}/",
        f"- Language: `{lang}`",
        f"- Brand: {brand or 'default'}",
        f"- Counts: **{counts['total']}** issues "
        f"({counts['errors']} errors, {counts['warnings']} warnings)",
        "",
    ]

    # Summary-by-check table.
    by_check: dict = {}
    for f in findings:
        c = f.get("check", "other")
        slot = by_check.setdefault(c, {"error": 0, "warning": 0})
        slot["error" if f.get("severity") == "error" else "warning"] += 1
    if by_check:
        lines += ["## Summary by check", "", "| Check | Errors | Warnings |",
                  "| --- | --- | --- |"]
        for key, title in _CHECK_TITLES:
            if key in by_check:
                s = by_check[key]
                lines.append(f"| {title} | {s['error']} | {s['warning']} |")
        # Any check not in the known list.
        known = {k for k, _ in _CHECK_TITLES}
        for key, s in by_check.items():
            if key not in known:
                lines.append(f"| {key} | {s['error']} | {s['warning']} |")
        lines.append("")

    # Findings grouped by check, in display order.
    lines += ["## Findings", ""]
    if not findings:
        lines.append("No issues found. ✅")
        return "\n".join(lines)

    grouped: dict = {}
    for f in findings:
        grouped.setdefault(f.get("check", "other"), []).append(f)

    ordered_keys = [k for k, _ in _CHECK_TITLES if k in grouped]
    ordered_keys += [k for k in grouped if k not in {k for k, _ in _CHECK_TITLES}]
    title_for = dict(_CHECK_TITLES)

    for key in ordered_keys:
        lines.append(f"### {title_for.get(key, key)}")
        lines.append("")
        for f in grouped[key]:
            sev = f.get("severity", "error")
            device = f.get("device") or "—"
            node = f.get("nodeId") or "—"
            msg = f.get("message", "")
            lines.append(f"- **[{sev}]** {device} · `{node}` — {msg}")
            if f.get("rewrite"):
                lines.append(f"  - _Suggested rewrite:_ {f['rewrite']}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_router() -> APIRouter:
    router = APIRouter()

    @router.post("/run")
    def run_qa(req: QaRequest):
        token = get_secret("FIGMA_API_KEY")
        if not token:
            return JSONResponse(status_code=424, content={"missing_secrets": [_FIGMA_SECRET]})

        file_key = parse_file_key(req.figma_url)
        if not file_key:
            return JSONResponse(status_code=200, content={
                "status": "error", "summary": {}, "report_markdown": None,
                "findings": [], "figma_ops": [],
                "error": "Could not parse a Figma file key from the URL. Expected a "
                         "figma.com/design/<key>/… or figma.com/file/<key>/… link.",
            })

        lang = (req.lang or "en").strip() or "en"
        brand = (req.brand or "").strip() or None
        run_dir = settings.ARTIFACT_ROOT / "qa" / uuid.uuid4().hex[:12]
        run_dir.mkdir(parents=True, exist_ok=True)

        warnings: list[str] = []

        # --- Phase 1a: fetch -------------------------------------------------
        try:
            fetched = _run_script(_FETCH, [file_key], token)
        except subprocess.TimeoutExpired:
            return _error("Figma fetch timed out after 180s.")
        if fetched.returncode != 0:
            return _error("Figma fetch failed.", detail=(fetched.stderr or "").strip()[:600])
        cache_path = (fetched.stdout or "").strip().splitlines()[-1].strip() if fetched.stdout else ""
        if not cache_path or not Path(cache_path).exists():
            return _error("Fetch did not produce a cache file.",
                          detail=(fetched.stderr or "").strip()[:600])

        # --- Phase 1b: deterministic checks ---------------------------------
        check_args = [cache_path, lang]
        if brand:
            check_args += ["--brand", brand]
        try:
            checked = _run_script(_CHECK, check_args, token)
        except subprocess.TimeoutExpired:
            return _error("QA checks timed out.")
        if checked.returncode != 0:
            return _error("QA checks failed.", detail=(checked.stderr or "").strip()[:600])
        try:
            summary = json.loads((checked.stdout or "").strip().splitlines()[-1])
        except (ValueError, IndexError):
            return _error("Could not parse the QA check summary.",
                          detail=(checked.stdout or "")[:600])

        findings_path = Path(summary["findingsPath"])
        texts_path = Path(summary["textsPath"])
        findings_doc = json.loads(findings_path.read_text(encoding="utf-8"))
        findings = list(findings_doc.get("findings", []))
        devices = findings_doc.get("devices", {})
        file_name = findings_doc.get("fileName") or file_key

        # --- Phase 2: AI language / tone judgment (best-effort) -------------
        tone_status = "off"
        try:
            texts = json.loads(texts_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            texts = {}
        if texts:
            if has_secret("ANTHROPIC_API_KEY"):
                voice = _voice_for_brand(brand)
                ai_findings = tone.judge(
                    texts, lang, voice, want_tone=bool(req.tone),
                    api_key=get_secret("ANTHROPIC_API_KEY"),
                )
                findings.extend(ai_findings)
                tone_status = "on" if req.tone else "language-only"
                # Persist the merged findings so post.py can pick up AI findings too.
                findings_doc["findings"] = findings
                findings_path.write_text(json.dumps(findings_doc, indent=2), encoding="utf-8")
            else:
                warnings.append("ANTHROPIC_API_KEY not set — skipped AI language/tone check.")

        # --- Recompute counts ------------------------------------------------
        counts = {
            "total": len(findings),
            "errors": sum(1 for f in findings if f.get("severity") == "error"),
            "warnings": sum(1 for f in findings if f.get("severity") == "warning"),
        }

        # --- Phase 3: optional post to Figma --------------------------------
        posted = None
        if req.post_comments:
            try:
                posted_proc = _run_script(_POST, [str(findings_path)], token)
                if posted_proc.returncode == 0 and posted_proc.stdout:
                    try:
                        post_summary = json.loads(posted_proc.stdout.strip().splitlines()[-1])
                        posted = int(post_summary.get("posted", 0))
                        if post_summary.get("failed"):
                            warnings.append(
                                f"{post_summary['failed']} comment(s) failed to post "
                                "(instance-internal node ids cannot be pinned)."
                            )
                    except (ValueError, IndexError):
                        warnings.append("Posted comments, but couldn't parse the post summary.")
                else:
                    warnings.append("Posting comments failed — token may lack Comments:Write scope.")
            except subprocess.TimeoutExpired:
                warnings.append("Posting comments timed out.")

        report = _build_report(file_key, file_name, lang, brand, devices, findings, counts)

        status = "ok"
        if warnings:
            status = "partial"

        result = {
            "status": status,
            "summary": {
                "fileKey": file_key,
                "fileName": file_name,
                "lang": lang,
                "brand": brand or "default",
                "devices": list(devices.keys()),
                "counts": counts,
                "tone": tone_status,
                "warnings": warnings,
            },
            "report_markdown": report,
            "findings": findings,
            "figma_ops": [],  # QA needs no canvas writes
        }
        if posted is not None:
            result["posted"] = posted
        return JSONResponse(status_code=200, content=result)

    return router


def _voice_for_brand(brand: Optional[str]) -> str:
    """Read target_voice from figma_scripts/brands/<brand>/qa-config.json, else default."""
    if not brand:
        return _DEFAULT_VOICE
    cfg = settings.FIGMA_SCRIPTS_DIR / "brands" / brand / "qa-config.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
        return data.get("target_voice") or _DEFAULT_VOICE
    except (OSError, ValueError):
        return _DEFAULT_VOICE


def _error(message: str, detail: str = "") -> JSONResponse:
    full = message if not detail else f"{message}\n{detail}"
    return JSONResponse(status_code=200, content={
        "status": "error", "summary": {}, "report_markdown": None,
        "findings": [], "figma_ops": [], "error": full,
    })

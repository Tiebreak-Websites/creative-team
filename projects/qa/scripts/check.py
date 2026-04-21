#!/usr/bin/env python3
"""Run deterministic QA checks against a cached Figma file.

Usage:   python check.py <cache-json-path> <lang> [--brand <name>]
Outputs: <fileKey>.findings.json  + <fileKey>.texts.json  (both under .cache/)
Stdout:  JSON summary with paths + counts.

LLM-judgment checks (language, tone) intentionally NOT done here — they run
against texts.json in the /qa command afterwards.
"""
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE.parent / ".cache"
PROJECTS_DIR = HERE.parent.parent


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv):
    if len(argv) < 3:
        print("usage: python check.py <cache-json-path> <lang> [--brand <name>]", file=sys.stderr)
        sys.exit(1)
    cache_path = Path(argv[1])
    lang = argv[2]
    brand = None
    if "--brand" in argv:
        i = argv.index("--brand")
        if i + 1 < len(argv):
            brand = argv[i + 1]
    return cache_path, lang, brand


def load_brand_config(brand):
    defaults = {
        "target_voice": "Confident, specific, benefit-led, action-driving. Retail-friendly but authoritative. Every headline earns its space.",
        "brand_name_allowlist": [],
        "loanword_allowlist": [],
        "device_widths": {"desktop_min": 1200, "tablet_min": 600},
    }
    if not brand:
        return defaults
    cfg_path = PROJECTS_DIR / brand / "qa-config.json"
    if not cfg_path.exists():
        return defaults
    try:
        return {**defaults, **json.loads(cfg_path.read_text(encoding="utf-8"))}
    except Exception:
        return defaults


# ---------------------------------------------------------------------------
# Walk helpers
# ---------------------------------------------------------------------------

CTA_RE = re.compile(r"(^|\W)(button|btn|cta|boton|botón|cta-)", re.IGNORECASE)


def normalize(s):
    return " ".join((s or "").strip().lower().split())


def first_text(node):
    if node.get("type") == "TEXT":
        return node.get("characters") or ""
    for c in node.get("children") or []:
        t = first_text(c)
        if t:
            return t
    return ""


def guess_role(node):
    fs = (node.get("style") or {}).get("fontSize") or 0
    if fs >= 48: return "hero"
    if fs >= 32: return "h1"
    if fs >= 22: return "h2"
    if fs >= 16: return "body"
    return "caption"


def classify_devices(frames, desktop_min, tablet_min):
    buckets = {"desktop": [], "tablet": [], "mobile": []}
    for f in frames:
        w = (f.get("absoluteBoundingBox") or {}).get("width") or 0
        if w >= desktop_min: buckets["desktop"].append(f)
        elif w >= tablet_min: buckets["tablet"].append(f)
        else: buckets["mobile"].append(f)

    picked = {}
    for device, candidates in buckets.items():
        if not candidates:
            return None, f"No {device} frame found (width bucket empty)."
        if len(candidates) == 1:
            picked[device] = candidates[0]
            continue
        named = [c for c in candidates if device in c["name"].lower()]
        if len(named) == 1:
            picked[device] = named[0]
            continue
        return None, (
            f"Ambiguous {device} bucket: {len(candidates)} frames match. "
            f"Rename one to include \"{device}\", or override widths via qa-config.json. "
            f"Candidates: {[c['name'] for c in candidates]}"
        )
    return picked, None


def extract_content(frame, image_refs):
    texts, images, ctas = [], [], []

    def walk(node, parent, in_cta):
        bbox = node.get("absoluteBoundingBox")
        is_cta = bool(node.get("name")) and bool(CTA_RE.search(node["name"]))

        this_cta = in_cta
        if is_cta and not in_cta:
            label = first_text(node)
            ctas.append({
                "id": node["id"],
                "name": node.get("name"),
                "label": label,
                "normLabel": normalize(label),
                "bbox": bbox,
            })
            this_cta = True

        if node.get("type") == "TEXT" and not this_cta:
            chars = node.get("characters") or ""
            texts.append({
                "id": node["id"],
                "text": chars,
                "norm": normalize(chars),
                "bbox": bbox,
                "parentBbox": (parent or {}).get("absoluteBoundingBox"),
                "fontSize": (node.get("style") or {}).get("fontSize"),
                "role": guess_role(node),
            })

        fills = node.get("fills")
        if isinstance(fills, list):
            for fill in fills:
                if fill.get("type") != "IMAGE":
                    continue
                image_ref = fill.get("imageRef")
                images.append({
                    "id": node["id"],
                    "name": node.get("name"),
                    "imageRef": image_ref,
                    "resolved": bool(image_ref and image_refs.get(image_ref)),
                    "bbox": bbox,
                })

        for c in node.get("children") or []:
            walk(c, node, this_cta)

    walk(frame, None, False)

    key_y = lambda x: ((x.get("bbox") or {}).get("y") or 0, (x.get("bbox") or {}).get("x") or 0)
    texts.sort(key=key_y)
    images.sort(key=key_y)
    ctas.sort(key=key_y)

    return {
        "id": frame["id"],
        "name": frame.get("name"),
        "bbox": frame.get("absoluteBoundingBox"),
        "texts": texts,
        "images": images,
        "ctas": ctas,
    }


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def run_parity(per_device, add):
    devices = list(per_device.keys())
    set_per = {d: {t["norm"] for t in per_device[d]["texts"] if t["norm"]} for d in devices}
    union = set().union(*set_per.values())

    for norm in union:
        missing = [d for d in devices if norm not in set_per[d]]
        if not missing or len(missing) == len(devices):
            continue
        pin_device = pin_id = preview = None
        for d in devices:
            hit = next((t for t in per_device[d]["texts"] if t["norm"] == norm), None)
            if hit:
                pin_device, pin_id, preview = d, hit["id"], hit["text"]
                break
        present = [d for d in devices if norm in set_per[d]]
        add("parity", "error", pin_device, pin_id,
            f'Text on {"+".join(present)} but missing on {"+".join(missing)}',
            {"preview": preview[:120], "missingOn": missing})


PLACEHOLDER_RE = re.compile(r"\b(lorem\s+ipsum|placeholder|tbd|todo|xxx)\b", re.IGNORECASE)


def run_placeholder(per_device, add):
    for device, content in per_device.items():
        for t in content["texts"]:
            if PLACEHOLDER_RE.search(t["text"]):
                add("placeholder", "error", device, t["id"],
                    f'Placeholder text detected: "{t["text"][:80]}"')


def run_broken_images(per_device, add):
    for device, content in per_device.items():
        for img in content["images"]:
            if not img["resolved"]:
                add("broken-image", "error", device, img["id"],
                    f'Image fill unresolved on layer "{img["name"]}"',
                    {"imageRef": img.get("imageRef")})


def run_overflow(per_device, add):
    tol = 2
    for device, content in per_device.items():
        for t in content["texts"]:
            p = t.get("parentBbox")
            b = t.get("bbox")
            if not p or not b:
                continue
            overflow_right = (b["x"] + b["width"]) - (p["x"] + p["width"])
            overflow_bottom = (b["y"] + b["height"]) - (p["y"] + p["height"])
            if overflow_right > tol or overflow_bottom > tol:
                add("overflow", "error", device, t["id"],
                    f'Text overflows parent (right: {int(overflow_right)}px, bottom: {int(overflow_bottom)}px): "{t["text"][:60]}"')


DUMMY_LABELS = {"button", "cta", "click here", "submit", "boton", "botón"}


def run_ctas(per_device, add, cfg):
    for device, content in per_device.items():
        for c in content["ctas"]:
            if c["normLabel"] in DUMMY_LABELS:
                add("cta-dummy", "error", device, c["id"],
                    f'CTA uses placeholder label: "{c["label"]}"')

    devices = list(per_device.keys())
    if len(devices) < 2:
        return
    max_count = max(len(per_device[d]["ctas"]) for d in devices)
    for i in range(max_count):
        labels = [(d, per_device[d]["ctas"][i]) for d in devices if i < len(per_device[d]["ctas"])]
        if len(labels) < 2:
            continue
        norms = {c["normLabel"] for _, c in labels}
        if len(norms) > 1:
            pin_d, pin_c = labels[0]
            summary = ", ".join(f'{d}="{c["label"]}"' for d, c in labels)
            add("cta-mismatch", "error", pin_d, pin_c["id"],
                f"CTA #{i + 1} label differs across devices: {summary}")


REGULATOR_PATTERNS = [
    re.compile(r"\b(guaranteed|garantizad[oa]s?)\s+(returns?|ganancias?|retornos?)\b", re.IGNORECASE),
    re.compile(r"\brisk[-\s]?free\b", re.IGNORECASE),
    re.compile(r"\bsin\s+riesgo\b", re.IGNORECASE),
    re.compile(r"\bcan'?t\s+lose\b", re.IGNORECASE),
    re.compile(r"\bno\s+puedes?\s+perder\b", re.IGNORECASE),
    re.compile(r"\b100%\s+(accuracy|win|precisi[oó]n)\b", re.IGNORECASE),
]


def run_regulator_phrases(per_device, add):
    for device, content in per_device.items():
        for t in content["texts"]:
            for pat in REGULATOR_PATTERNS:
                m = pat.search(t["text"])
                if m:
                    add("regulator-phrase", "warning", device, t["id"],
                        f'Regulator-unfriendly phrase: "{m.group(0)}" in "{t["text"][:80]}"')
                    break


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    cache_path, lang, brand = parse_args(sys.argv)
    data = json.loads(cache_path.read_text(encoding="utf-8"))
    cfg = load_brand_config(brand)

    page = data["document"]["children"][0]
    top_frames = [n for n in (page.get("children") or []) if n.get("type") in ("FRAME", "SECTION")]

    picked, err = classify_devices(
        top_frames,
        cfg["device_widths"]["desktop_min"],
        cfg["device_widths"]["tablet_min"],
    )
    if err:
        print(err, file=sys.stderr)
        sys.exit(3)

    per_device = {d: extract_content(f, data["imageRefs"]) for d, f in picked.items()}

    findings = []

    def add(check, severity, device, node_id, message, extra=None):
        entry = {
            "check": check, "severity": severity, "device": device,
            "nodeId": node_id, "message": message,
        }
        if extra:
            entry.update(extra)
        findings.append(entry)

    run_parity(per_device, add)
    run_placeholder(per_device, add)
    run_broken_images(per_device, add)
    run_overflow(per_device, add)
    run_ctas(per_device, add, cfg)
    run_regulator_phrases(per_device, add)

    # Emit findings.json
    findings_path = CACHE_DIR / f"{data['fileKey']}.findings.json"
    findings_path.write_text(json.dumps({
        "fileKey": data["fileKey"],
        "fileName": data.get("name"),
        "lang": lang,
        "brand": brand,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "devices": {d: {"frameId": f["id"], "frameName": f.get("name")} for d, f in picked.items()},
        "findings": findings,
    }, indent=2), encoding="utf-8")

    # Emit texts.json (for LLM judgment later)
    texts_path = CACHE_DIR / f"{data['fileKey']}.texts.json"
    text_dump = {}
    for device, content in per_device.items():
        text_dump[device] = [
            {"id": t["id"], "role": t["role"],
             "text": (t["text"] if len(t["text"]) <= 400 else t["text"][:400] + "…")}
            for t in content["texts"]
        ]
        text_dump[f"{device}_ctas"] = [{"id": c["id"], "label": c["label"]} for c in content["ctas"]]
    texts_path.write_text(json.dumps(text_dump, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({
        "findingsPath": str(findings_path),
        "textsPath": str(texts_path),
        "counts": {
            "total": len(findings),
            "errors": sum(1 for f in findings if f["severity"] == "error"),
            "warnings": sum(1 for f in findings if f["severity"] == "warning"),
        },
    }))


if __name__ == "__main__":
    main()

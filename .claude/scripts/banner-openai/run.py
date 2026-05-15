#!/usr/bin/env python3
"""banner-openai gen+paint runner v1.7 - Python stdlib + ThreadPoolExecutor.

v1.7 deltas vs v1.6:
- Prompt assembly moved to prompts.py (testable, ~$0.30/run cheaper in Claude tokens)
- Manifest schema accepts structured concepts; legacy {base + layouts} still works
- Moderation pre-flight skips OpenAI calls that would moderation_block
- (concept, size) key-based validation catches manifest/urls drift up-front
- --resume mode: skips frames whose status is already "ok" in results.json
- Per-job state written incrementally so a crash mid-run is recoverable

Inputs (in --dir, defaults to $TEMP/banner-openai on Windows or /tmp/banner-openai):
  manifest.json   - see schema docs below
  urls.json       - [{ concept, size, openaiSize, submitUrl }, ...]

Outputs:
  <dir>/<concept>__<size>.png      - generated PNG per job
  <dir>/results.json               - per-job result manifest (written after each job)

Manifest schema (v1.7 structured, recommended):
  {
    "concepts": {
      "c1": {
        "title": "...",                     # required
        "locale": "sv",                     # optional, default 'en'
        "register": "empowerment",          # optional, default 'curiosity'
        "hook_phrase": "personlig handledning",
        "lp_visual_style": "deep charcoal + vivid orange ...",
        "palette_hex": ["#0E0E10", "#F37021", "#FFFFFF"],
        "concept_visual": "spotlight on barrel + tick chart",
        "avoid": "classroom, instructor portrait"
      }
    }
  }

Manifest schema (v1.6 legacy, still supported):
  {
    "layouts":  { "1200x1200": "Layout (1:1) ...", ... },
    "concepts": { "c1": { "title": "...", "base": "... {LAYOUT} ..." } }
  }

Env:
  OPENAI_API_KEY   - required (resolve via .env loader before invocation).

Exit code: 0 if all jobs succeeded, 1 otherwise.
"""

import sys, os, json, base64, time, argparse, traceback
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import build_prompt, check_moderation, validate_manifest


def parse_args():
    p = argparse.ArgumentParser(description="banner-openai gen+paint runner")
    default_dir = os.path.join(os.environ.get("TEMP") or "/tmp", "banner-openai")
    p.add_argument("--dir", default=default_dir,
                   help="working directory containing manifest.json + urls.json")
    p.add_argument("--concurrency", type=int, default=6,
                   help="parallel jobs (default 6; gpt-image-2 rate-limits at 12)")
    p.add_argument("--gen-timeout", type=int, default=540, help="seconds per gen call")
    p.add_argument("--paint-timeout", type=int, default=120, help="seconds per paint POST")
    p.add_argument("--max-retries", type=int, default=4,
                   help="max attempts per job on 429 (default 4)")
    p.add_argument("--base-backoff", type=int, default=8,
                   help="base seconds for exp backoff on 429 (default 8 -> 8/16/32/64)")
    p.add_argument("--model", default="gpt-image-2",
                   choices=["gpt-image-2", "gpt-image-1-mini"])
    p.add_argument("--quality", default="medium", choices=["low", "medium"])
    p.add_argument("--no-paint", action="store_true",
                   help="generate PNGs only, skip Figma paint POST")
    p.add_argument("--resume", action="store_true",
                   help="skip frames whose results.json status is 'ok' AND PNG exists")
    p.add_argument("--no-moderation", action="store_true",
                   help="skip pre-flight moderation keyword check")
    return p.parse_args()


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def resolve_prompt(concept_data, layouts_legacy, size):
    """Return a prompt string for (concept, size).

    If `concept_data` has structured fields (title + locale + ...), build via
    prompts.build_prompt(). If it only has legacy `base` + `layouts_legacy`,
    do the v1.6 string substitution.
    """
    if "base" in concept_data and layouts_legacy and size in layouts_legacy:
        return concept_data["base"].replace("{LAYOUT}", layouts_legacy[size])
    return build_prompt(concept_data, size)


def gen_and_paint(idx, total, frame, concept_data, layouts_legacy, args, api_key):
    label = f"{frame['concept']}__{frame['size']}"
    out_png = os.path.join(args.dir, f"{label}.png")

    result = {
        "label": label, "concept": frame["concept"], "size": frame["size"],
        "openai": frame["openaiSize"], "status": "pending",
        "gen_ms": None, "paint_ms": None, "bytes": 0, "error": None, "attempts": 0,
    }

    try:
        prompt = resolve_prompt(concept_data, layouts_legacy, frame["size"])
    except Exception as e:
        result["status"] = "prompt_failed"
        result["error"] = f"{type(e).__name__}: {e}"
        log(f"[{idx+1:02d}/{total}] {label} PROMPT failed: {e}")
        return result

    if not args.no_moderation:
        ok, reason = check_moderation(concept_data)
        if not ok:
            result["status"] = "moderation_skip"
            result["error"] = reason
            log(f"[{idx+1:02d}/{total}] {label} MODERATION skip: {reason}")
            return result

    payload = json.dumps({
        "model": args.model, "prompt": prompt, "n": 1,
        "size": frame["openaiSize"], "quality": args.quality, "output_format": "png",
    }).encode("utf-8")

    png = None
    for attempt in range(1, args.max_retries + 1):
        result["attempts"] = attempt
        t0 = time.time()
        log(f"[{idx+1:02d}/{total}] {label} GEN attempt {attempt}/{args.max_retries} ({frame['openaiSize']}, {len(prompt)}c prompt)")
        req = urllib.request.Request(
            "https://api.openai.com/v1/images/generations",
            data=payload, method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=args.gen_timeout) as resp:
                body = resp.read().decode("utf-8")
            gen_ms = int((time.time() - t0) * 1000)
            result["gen_ms"] = gen_ms
            data = json.loads(body)
            b64 = data["data"][0].get("b64_json")
            if not b64:
                result["status"] = "gen_failed"
                result["error"] = "no b64_json in response"
                return result
            png = base64.b64decode(b64)
            with open(out_png, "wb") as fh:
                fh.write(png)
            result["bytes"] = len(png)
            log(f"[{idx+1:02d}/{total}] {label} GEN ok in {gen_ms}ms ({len(png)//1024}KB)")
            break
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code == 429 and attempt < args.max_retries:
                wait = args.base_backoff * (2 ** (attempt - 1))
                log(f"[{idx+1:02d}/{total}] {label} 429, sleeping {wait}s before retry {attempt+1}")
                time.sleep(wait)
                continue
            result["status"] = "gen_http_error"
            result["error"] = f"HTTP {e.code}: {body[:300]}"
            log(f"[{idx+1:02d}/{total}] {label} GEN giving up: HTTP {e.code}")
            return result
        except Exception as e:
            result["status"] = "gen_failed"
            result["error"] = f"{type(e).__name__}: {e}"
            log(f"[{idx+1:02d}/{total}] {label} GEN failed: {e}")
            return result

    if png is None:
        return result

    if args.no_paint:
        result["status"] = "ok_no_paint"
        return result

    t1 = time.time()
    try:
        paint_req = urllib.request.Request(
            frame["submitUrl"], data=png, method="POST",
            headers={"Content-Type": "image/png"},
        )
        with urllib.request.urlopen(paint_req, timeout=args.paint_timeout) as resp:
            paint_status = resp.status
            paint_body = resp.read().decode("utf-8", errors="replace")
        paint_ms = int((time.time() - t1) * 1000)
        result["paint_ms"] = paint_ms
        if 200 <= paint_status < 300:
            result["status"] = "ok"
            log(f"[{idx+1:02d}/{total}] {label} PAINT ok in {paint_ms}ms")
        else:
            result["status"] = "paint_http_error"
            result["error"] = f"HTTP {paint_status}: {paint_body[:200]}"
            log(f"[{idx+1:02d}/{total}] {label} PAINT http {paint_status}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        result["status"] = "paint_http_error"
        result["error"] = f"HTTP {e.code}: {body[:300]}"
        log(f"[{idx+1:02d}/{total}] {label} PAINT http {e.code}: {body[:120]}")
    except Exception as e:
        result["status"] = "paint_failed"
        result["error"] = f"{type(e).__name__}: {e}"
        log(f"[{idx+1:02d}/{total}] {label} PAINT failed: {e}")

    return result


def load_resume_state(results_path):
    if not os.path.exists(results_path):
        return set()
    try:
        with open(results_path, "r", encoding="utf-8") as fh:
            prior = json.load(fh)
        return {(r["concept"], r["size"]) for r in prior
                if r.get("status") in ("ok", "ok_no_paint")}
    except Exception:
        return set()


def write_results(results_path, results):
    """Atomic-ish: write to temp then rename. Lets --resume read a fresh
    snapshot even if the runner is killed mid-flight."""
    tmp = results_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, results_path)


def main():
    args = parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("FATAL: OPENAI_API_KEY not set in environment.", file=sys.stderr, flush=True)
        sys.exit(2)

    manifest_path = os.path.join(args.dir, "manifest.json")
    urls_path = os.path.join(args.dir, "urls.json")
    results_path = os.path.join(args.dir, "results.json")
    for p in (manifest_path, urls_path):
        if not os.path.exists(p):
            print(f"FATAL: missing {p}", file=sys.stderr, flush=True)
            sys.exit(2)

    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    with open(urls_path, "r", encoding="utf-8") as fh:
        urls = json.load(fh)

    errs = validate_manifest(manifest, urls)
    if errs:
        print("FATAL: manifest/urls validation failed:", file=sys.stderr, flush=True)
        for e in errs:
            print(f"  - {e}", file=sys.stderr, flush=True)
        sys.exit(2)

    layouts_legacy = manifest.get("layouts")

    resume_skip = load_resume_state(results_path) if args.resume else set()
    if args.resume and resume_skip:
        log(f"--resume: skipping {len(resume_skip)} frames already 'ok' in results.json")

    work = []
    for f in urls:
        key = (f["concept"], f["size"])
        if key in resume_skip and os.path.exists(os.path.join(args.dir, f"{f['concept']}__{f['size']}.png")):
            continue
        work.append(f)

    if not work:
        log("Nothing to do - all frames already 'ok' in results.json. Exiting.")
        sys.exit(0)

    log(f"Starting {len(work)} jobs (of {len(urls)} total), model={args.model}, "
        f"concurrency={args.concurrency}, max_retries={args.max_retries}, "
        f"base_backoff={args.base_backoff}s, moderation={'off' if args.no_moderation else 'on'}, "
        f"resume={'on' if args.resume else 'off'}")

    results = []
    if args.resume and os.path.exists(results_path):
        try:
            with open(results_path, "r", encoding="utf-8") as fh:
                prior = json.load(fh)
            results = [r for r in prior
                       if (r.get("concept"), r.get("size")) in resume_skip]
        except Exception:
            results = []

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {
            ex.submit(gen_and_paint, i, len(work), f,
                      manifest["concepts"][f["concept"]],
                      layouts_legacy, args, api_key): f
            for i, f in enumerate(work)
        }
        for fut in as_completed(futures):
            try:
                r = fut.result()
            except Exception as e:
                log(f"unhandled exception in job: {e}\n{traceback.format_exc()}")
                r = {"status": "crashed", "error": str(e)}
            results.append(r)
            write_results(results_path, results)

    ok = sum(1 for r in results if r.get("status") in ("ok", "ok_no_paint"))
    skipped = sum(1 for r in results if r.get("status") == "moderation_skip")
    fail = len(results) - ok - skipped
    log(f"DONE - ok={ok} moderation_skip={skipped} failed={fail} (results -> {results_path})")
    for r in sorted(results, key=lambda x: x.get("label", "")):
        line = f"  {r.get('label','?'):<24} {r.get('status','?'):<18} attempts={r.get('attempts',0)}"
        if r.get("gen_ms"):   line += f" gen={r['gen_ms']}ms"
        if r.get("paint_ms"): line += f" paint={r['paint_ms']}ms"
        if r.get("bytes"):    line += f" {r['bytes']//1024}KB"
        if r.get("error"):    line += f" err={r['error'][:80]}"
        print(line, flush=True)

    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    main()

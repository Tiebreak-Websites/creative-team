#!/usr/bin/env python3
"""Fetch a Figma file + image refs via REST API and cache to disk.

Usage:   python fetch.py <fileKey>
Env:     FIGMA_TOKEN  (Personal Access Token from figma.com/settings)
Stdout:  absolute path to the cached JSON file.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE.parent / ".cache"


def get_json(url, token):
    req = urllib.request.Request(url, headers={"X-Figma-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        raise SystemExit(f"HTTP {e.code} {e.reason} on {url}\n  {body}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Network error on {url}: {e.reason}")


def main():
    if len(sys.argv) < 2:
        print("usage: python fetch.py <fileKey>", file=sys.stderr)
        sys.exit(1)
    file_key = sys.argv[1]

    token = os.environ.get("FIGMA_TOKEN")
    if not token:
        print("FIGMA_TOKEN not set. Generate one at:", file=sys.stderr)
        print("  https://www.figma.com/settings  →  Personal access tokens", file=sys.stderr)
        print("Then set it in your shell:", file=sys.stderr)
        print("  export FIGMA_TOKEN=<token>    (bash/zsh)", file=sys.stderr)
        print("  $env:FIGMA_TOKEN='<token>'    (PowerShell)", file=sys.stderr)
        sys.exit(2)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()

    print(f"fetching file {file_key}…", file=sys.stderr)
    file_data = get_json(f"https://api.figma.com/v1/files/{file_key}", token)

    print("fetching image URLs…", file=sys.stderr)
    try:
        images = get_json(f"https://api.figma.com/v1/files/{file_key}/images", token)
        image_refs = images.get("meta", {}).get("images", {})
    except SystemExit:
        image_refs = {}

    out = {
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fileKey": file_key,
        "name": file_data.get("name"),
        "lastModified": file_data.get("lastModified"),
        "document": file_data.get("document"),
        "components": file_data.get("components") or {},
        "imageRefs": image_refs,
    }

    cache_path = CACHE_DIR / f"{file_key}.json"
    cache_path.write_text(json.dumps(out), encoding="utf-8")
    kb = cache_path.stat().st_size // 1024
    elapsed = int((time.time() - started) * 1000)
    print(f"cached → {cache_path} ({kb} KB, {elapsed}ms)", file=sys.stderr)
    print(str(cache_path))


if __name__ == "__main__":
    main()

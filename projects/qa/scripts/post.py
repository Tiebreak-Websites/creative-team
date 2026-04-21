#!/usr/bin/env python3
"""Post QA findings to a Figma file as pinned comments.

Usage: python post.py <findings.json>
Env:   FIGMA_TOKEN (needs Comments:Write scope)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


def post_comment(file_key, token, message, node_id):
    body = json.dumps({
        "message": message,
        "client_meta": {"node_id": node_id, "node_offset": {"x": 0, "y": 0}},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.figma.com/v1/files/{file_key}/comments",
        data=body,
        method="POST",
        headers={
            "X-Figma-Token": token,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, resp.status
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"
    except urllib.error.URLError as e:
        return False, f"Network: {e.reason}"


def main():
    if len(sys.argv) < 2:
        print("usage: python post.py <findings.json>", file=sys.stderr)
        sys.exit(1)

    token = os.environ.get("FIGMA_TOKEN")
    if not token:
        print("FIGMA_TOKEN not set.", file=sys.stderr)
        sys.exit(2)

    findings_path = Path(sys.argv[1])
    data = json.loads(findings_path.read_text(encoding="utf-8"))
    file_key = data["fileKey"]
    findings = data["findings"]

    posted = 0
    failed = 0
    errors = []

    for i, f in enumerate(findings, 1):
        lines = [f"[QA · {f['check']} · {f['severity']}]", f["message"]]
        if f.get("rewrite"):
            lines.append("")
            lines.append("Suggested rewrite:")
            lines.append(f["rewrite"])
        message = "\n".join(lines)

        ok, info = post_comment(file_key, token, message, f["nodeId"])
        if ok:
            posted += 1
            print(f"  [{i}/{len(findings)}] posted to {f['nodeId']} ({f['check']})", file=sys.stderr)
        else:
            failed += 1
            errors.append({"nodeId": f["nodeId"], "check": f["check"], "error": info})
            print(f"  [{i}/{len(findings)}] FAILED on {f['nodeId']}: {info}", file=sys.stderr)

        time.sleep(0.2)  # gentle rate-limiting

    print(json.dumps({"posted": posted, "failed": failed, "errors": errors}))


if __name__ == "__main__":
    main()

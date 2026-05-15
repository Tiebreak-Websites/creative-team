# LP screenshot cache (used by /banner-openai v1.7+)

Each file in this directory caches the **one-line LP visual style summary** that
Phase 0.3 of `/banner-openai` extracts from a Figma screenshot. Re-using the cache
saves ~5s of MCP screenshot fetch + ~$0.10 of Claude tokens per repeat run on
the same LP.

## File naming

`{fileKey}__{nodeId}.json` — e.g. `zyv1xdCAcXtILdpsNZZ7CC__2001-1697.json`.
NodeId uses `-` separator (not `:`) for filesystem safety.

## Schema

```json
{
  "fileKey": "zyv1xdCAcXtILdpsNZZ7CC",
  "nodeId":  "2001:1697",
  "fetched_at": "2026-05-15T17:22:00Z",
  "ttl_hours": 24,
  "lp_visual_style": "deep charcoal gradient + vivid orange (#F37021) type-hero + white body, glossy oil barrel + chart line + Stockholm silhouette",
  "palette_hex": ["#0E0E10", "#F37021", "#FFFFFF"]
}
```

## Cache rules (v1.7)

1. **Read** before calling `get_screenshot`: if file exists AND
   `now - fetched_at < ttl_hours`, use the cached `lp_visual_style` directly
   and skip the screenshot.
2. **Write** after extracting a fresh summary: overwrite the file with the new
   timestamp.
3. **Bypass** with `--no-cache` flag or `--no-lp` (skip LP entirely).
4. **Invalidation**: bump `ttl_hours` to 0 to force a re-read on the next run,
   or just delete the file.

## Why text-only

The Figma screenshot URL expires within minutes (Figma TTL), so caching the URL
is useless. Caching the PNG bytes would be wasteful (~500KB each) and would need
.gitignore. Caching the **extracted summary** is small (~200 bytes), useful, and
shareable across the team via git.

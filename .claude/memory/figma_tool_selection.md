---
name: Figma MCP tool selection guide
description: Decision tree for which Figma MCP tool to use across all team commands (/qa, /banner-higgsfield, /banner-openai, /banner-prompt, /translate-figma). Two MCPs are available — Framelink (read-only, structured JSON, fast) and the official Figma MCP (read+write, code+screenshots).
type: reference
---

# Figma MCP tool selection

Two Figma MCPs are connected in this project:

| MCP | Access | When to use |
|---|---|---|
| **Framelink** (`mcp__framelink-figma__*`) | read-only | Structured JSON reads — node layout, styling, content, text enumeration. Fast, clean, no React/Tailwind wrapper. Pulls directly from Figma REST via `FIGMA_API_KEY`. |
| **Official** (`mcp__a17e5c91-…__*`) | read + write | Anything that writes (frames, text, image fills). Anything that needs a rendered screenshot (PNG of a node). Code preview (React+Tailwind). Design tokens, libraries, page metadata. |

---

## Read decision tree

| You want… | Use this tool | Why |
|---|---|---|
| **Structured node JSON** (layout, fills, text, children) | `mcp__framelink-figma__get_figma_data` | Cleanest output. No code wrapper to strip. Ideal for `/qa` parity checks, `/translate-figma` text enumeration, `/banner-openai` Creative Card composition. |
| **A rendered PNG screenshot of a node** | `mcp__a17e5c91-…__get_screenshot` | Framelink doesn't return rendered images. For brand-continuity visual reads (`/banner-higgsfield`, `/banner-openai` LP context), this is the cheapest source. |
| **React + Tailwind code preview** | `mcp__a17e5c91-…__get_design_context` | Only useful when implementing the design in code. Heavier than `get_figma_data` for everything else. |
| **Top-level page structure / IDs only** | `mcp__a17e5c91-…__get_metadata` (XML) or `mcp__framelink-figma__get_figma_data` | XML metadata is lighter when you only need IDs and names. JSON is better when you'll inspect properties next. |
| **Download multiple image assets** (PNG/SVG/GIF) | `mcp__framelink-figma__download_figma_images` | Bulk fetch by `imageRef` to local disk. Better than N separate `get_screenshot` calls. |
| **Design tokens / variables / library search** | `mcp__a17e5c91-…__get_variable_defs`, `…__search_design_system`, `…__get_libraries` | Framelink doesn't expose these. |

## Write — always official MCP

| Action | Tool |
|---|---|
| Create frames, edit text, set fills via JS plugin code | `mcp__a17e5c91-…__use_figma` |
| Upload image bytes as a fill on a specific node | `mcp__a17e5c91-…__upload_assets` |

Framelink is read-only. Do not look for a write tool there.

---

## Quick references (canonical call shapes)

### Framelink — `get_figma_data`
```
mcp__framelink-figma__get_figma_data({
  fileKey: "Vs19mSZZaf7DjHmUDWBtLc",
  nodeId: "224:413",        // optional — omit for whole file
  depth: 3                   // optional — limit recursion
})
```
Returns a clean JSON tree of the node with `layout`, `styles`, `content`, `children`. No code preview.

### Framelink — `download_figma_images`
```
mcp__framelink-figma__download_figma_images({
  fileKey: "...",
  nodes: [
    { nodeId: "1:2", fileName: "hero.png" },
    { nodeId: "1:5", imageRef: "abc...", fileName: "bg.png" }
  ],
  localPath: "assets/figma",
  pngScale: 2
})
```

### Official — `get_screenshot`
```
mcp__a17e5c91-…__get_screenshot({
  fileKey: "...", nodeId: "224:413", maxDimension: 1200
})
```
Returns a short-lived PNG URL + curl instructions.

### Official — `use_figma`
```
mcp__a17e5c91-…__use_figma({
  fileKey: "...",
  code: "/* JS using figma plugin API */",
  description: "..."
})
```

---

## Per-command preferences (from current specs)

| Command | Primary Figma reads | Recommended tool |
|---|---|---|
| `/qa` | parity, text overflow, image localization | `get_figma_data` (structured JSON). Python scripts in `projects/qa/scripts/` still authoritative for deterministic checks. |
| `/banner-higgsfield` | LP hero visual style | `get_screenshot` (brand-continuity is visual). Optional structure read via `get_figma_data`. |
| `/banner-openai` | LP hero visual style + node sanity | `get_screenshot` for visual; `get_figma_data` for structure. v1.5 default flow can do both in TURN 1. |
| `/banner-prompt` | optional LP read | `get_screenshot` if visual context wanted; otherwise skip Figma entirely. |
| `/translate-figma` | enumerate all text nodes across 3 breakpoints | `get_figma_data` (clean enumeration). Writes via `use_figma`. |

---

## Auth setup

- **Framelink**: needs `FIGMA_API_KEY` env var (Figma PAT). Loaded via `scripts/claude.ps1` / `scripts/claude.sh` from `.env`.
- **Official MCP**: configured at Claude Code user level (OAuth via Figma desktop app, no token needed).

If Framelink calls fail with auth errors, verify `FIGMA_API_KEY` is exported in the shell that launched `claude` — Claude Code doesn't auto-load `.env`.

## Fallback strategy

If Framelink is unavailable (token missing, Node.js not installed, MCP not loaded), every read can fall back to the official MCP equivalents:
- `get_figma_data` → `get_design_context` (heavier output, but works)
- `download_figma_images` → N × `get_screenshot` (slower, but works)

Commands should not hard-require Framelink — treat it as an optimization path.

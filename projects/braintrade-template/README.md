# Braintrade Template

Landing-page template for BrainTrade campaigns. Structured as a single HTML file with external content data so marketing copy can be swapped without touching the layout.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The LP layout and styling. Consumes `content.json` at load time. Protected — changes need PR review. |
| `content.json` | All copy, labels, CTAs, and campaign-specific data the template renders. Coordinate before editing — multiple campaigns pull from it. |

## Using it

1. Clone the repo and `cd projects/braintrade-template/`.
2. Open `index.html` directly in a browser, or serve it with any static server (`python -m http.server`, `npx serve`, etc.) — `content.json` needs to be fetched over HTTP, not `file://`.
3. To create a new campaign variant: copy `content.json` to a named variant (e.g. `content.campaign-2026-q2.json`), edit the copy, and point `index.html` at it.

## Related Figma source

The Figma file keys, page map, section node IDs, and design tokens live in shared Claude memory:
- `.claude/memory/project_figma_lp_template.md`
- `.claude/memory/reference_figma_file.md`

When Claude Code is run from the repo root, it auto-loads these — ask it for node IDs or section maps and it already has them.

## Protected — do not edit without team approval

- `index.html`
- `content.json`

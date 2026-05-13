---
description: Translate every text node on a 3-breakpoint Figma page (desktop/tablet/mobile) into one or more locales. Fully automated, ≤5 min, no human QA. Always non-destructive — new page per locale.
---

# /translate-figma — automated Figma localization

The teammate hands Claude a Figma URL and a list of locales. Claude reads the file, deduplicates the source strings across the 3 responsive frames, translates them once per locale with the `anthropic-skills:translate` skill, and writes the result back into Figma as **new, duplicated pages** — one per locale. Nothing on the source page is touched.

**SLA: ≤ 5 minutes end-to-end for up to 5 locales.**

---

## Input parsing

Arguments: `$ARGUMENTS`

Expected format: `<figma-url> <locales> [--page <name>] [--brand <name>] [--dry-run]`

- `<figma-url>` — REQUIRED. Any `https://figma.com/design/<fileKey>/...` link. Parse out `fileKey`. If a `node-id` query param is present, scope discovery to that node's page.
- `<locales>` — REQUIRED. Comma-separated ISO-639-1 codes, e.g. `de`, `de,es,fr`, `bg,fr,it,de,es`. Map common labels: "German" → `de`, "Brazilian Portuguese" → `pt-BR`, "Spanish Latam" → `es-LATAM`. If a label can't be mapped confidently, stop and ask.
- `--page <name>` — optional. Pick a specific page by name when the file has multiple pages. If omitted, use the **first page that contains exactly 3 frames classifiable as desktop/tablet/mobile**.
- `--brand <name>` — optional. Folder name under `projects/`. Used to load per-brand glossary + voice overrides. If omitted, try to auto-match the Figma file name against folders in `projects/` (same logic as `/qa`).
- `--dry-run` — optional. Extract + translate + validate, write the locale JSONs and the QA report, but **do not write to Figma**. Useful for reviewing translations before they go live.

### Hard fail-fast — STOP and error out

- No Figma URL → `❌ /translate-figma needs a Figma file URL.`
- No locales → `❌ /translate-figma needs at least one locale, e.g. "de" or "de,es,fr".`
- Ambiguous locale label → ask the teammate to use ISO codes; do not guess.

---

## Pre-flight

1. **`FIGMA_TOKEN`** — `echo $FIGMA_TOKEN | head -c 4` (PowerShell: `$env:FIGMA_TOKEN.Substring(0,4)`). If empty, stop and link the teammate to `projects/qa/README.md` — same token setup as `/qa`.
2. **Python** — `python --version` must be ≥3.8.
3. **Figma MCP** — verify the `use_figma` capability is available (`mcp__a17e5c91-...__use_figma` or `mcp__figma-desktop__*`). If not, stop with `❌ Figma MCP not connected — translation requires it for the write phase.`

---

## Phase 1 — Extract (fast, deterministic)

Run from repo root:

```bash
CACHE=$(python projects/qa/scripts/fetch.py <fileKey>)
python projects/translate/scripts/extract.py "$CACHE" --locales <locales> [--page <name>] [--brand <name>]
```

`extract.py` does all of this in one pass:

1. Loads the cached Figma JSON.
2. Picks the target page: either `--page <name>` or the first page with exactly 3 classifiable frames.
3. Classifies frames by width into `desktop` (≥1200), `tablet` (600–1199), `mobile` (<600). **Strict mode: if any bucket has 0 or ≥2 frames, abort with a clear error** ("Found N desktop, N tablet, N mobile frames — strict mode requires exactly 1 of each.").
4. Recursively walks every `TEXT` node in all 3 frames. For each, records: `nodeId`, `breakpoint`, `characters`, `fontFamily`, `fontStyle`, `fontSize`, `parentName`, `bbox`, `containerWidth`, `inComponentInstance`.
5. Applies do-not-translate rules:
   - Layer name starts with `🔒`, `[notrans]`, or `EN:`
   - Pure number, percentage, currency-prefixed number
   - URL, email, phone number (regex)
   - String length < 2 chars
   - Glossary `doNotTranslate` hit
6. **Deduplicates by exact-string match** — same `characters` across breakpoints/nodes collapses to one source string with a list of `nodeIds` that share it.
7. Estimates a per-string character limit from the source field's container width × font-size relationship (used for CTA buttons / hero headlines).
8. Writes two outputs into `projects/qa/.cache/`:
   - `<fileKey>.translate-source.json` — full extracted tree with mappings
   - `<fileKey>.translate-strings.<source-lang>.json` — flat `{ "string-id": "source text" }` (the only thing sent to the translator)

The source language is auto-detected from the bulk of strings (script + frequent-word heuristic). Default to `en` if uncertain.

Print to stdout a one-line summary:

```
extract: <page-name> · 3 frames (desktop=<id>, tablet=<id>, mobile=<id>) · <N> total text nodes · <M> unique strings · <S> skipped (not translated)
```

If `extract.py` exits non-zero, surface its stderr verbatim and stop.

---

## Phase 2 — Load voice + glossary

Resolve in this priority order (later overrides earlier):

1. `projects/translate/i18n/glossary.global.json` — global defaults
2. `projects/translate/i18n/brand-voice.default.md` — global voice
3. `projects/<brand>/i18n/glossary.json` — per-brand overrides (if exists)
4. `projects/<brand>/i18n/brand-voice.md` — per-brand voice (if exists)

Glossary structure:
```json
{
  "doNotTranslate": ["BrainTrade", "P/E", "ROI"],
  "preferred": {
    "de": { "trading": "Trading", "coach": "Coach" }
  },
  "characterLimits": {
    "auto": { "buttonText": 22, "heroTitle": 60, "ctaButton": 22 }
  },
  "lengthBudget": {
    "de": 1.35, "fr": 1.20, "es": 1.15, "it": 1.20, "pt": 1.20,
    "ru": 1.10, "ja": 0.70, "zh": 0.65, "bg": 1.25
  }
}
```

The voice file is a 5-bullet markdown — fed verbatim into the translator's prompt.

---

## Phase 3 — Translate (parallel, one Agent per locale)

For each locale in the list, spawn an **Agent in parallel** (all Agent tool calls in a SINGLE message) with this prompt template:

```
You are translating responsive-web landing-page marketing copy from <source-lang> to <target-locale>.

QUALITY BAR: native-speaker fluency, marketing tone preserved, every CTA punchy, idiomatic where the source is idiomatic, formal where the source is formal. This will be shown in production with no human review — your output is final.

CONSTRAINTS:
1. Preserve placeholders verbatim: {foo}, {{var}}, %s, %1$s, ${name}. Do not translate, reorder, or escape them.
2. Preserve URLs, emails, phone numbers, and brand names: see DO_NOT_TRANSLATE below.
3. Per-string character limits where given — output must fit. Rewrite shorter if needed.
4. Output ONLY a JSON object with the same keys as the input. Every input key must have a translated value. No prose, no explanations.

BRAND VOICE:
<contents of brand-voice.md>

GLOSSARY:
- Do not translate: <doNotTranslate list>
- Preferred terms for <target-locale>: <preferred map>

CHARACTER LIMITS (where present):
<per-string limits if known>

LENGTH BUDGET:
Target translation should not exceed <lengthBudget[locale] * 100>% of source length. Aim shorter for buttons and headlines.

SOURCE STRINGS (JSON):
<contents of <fileKey>.translate-strings.<source>.json>

OUTPUT: JSON object with the same keys, translated values.
```

The Agent invokes `anthropic-skills:translate` with this prompt and the strings JSON. It returns the translated JSON.

**Run all N locale Agents in parallel** — single message with N Agent tool calls. Wall time is dominated by the slowest one (~20–30s). Total Phase 3 = ~25s for any locale count up to 10.

---

## Phase 4 — Validate (with silent retry)

For each locale's translated JSON, run:

```bash
python projects/translate/scripts/validate.py "$CACHE" <locale>
```

`validate.py` checks every translated string:
- **Length budget** — translation length ≤ `lengthBudget[locale] × source length × 1.05` tolerance
- **Placeholder integrity** — every `{...}`, `%s`, `${...}` in source is in translation, exact match
- **Glossary respect** — `doNotTranslate` items appear verbatim in translation
- **Character limit** — per-string `characterLimits` not exceeded (CTAs, hero titles)
- **Non-empty** — no empty translations, no unchanged-from-source (model failed to translate)

Output: `<fileKey>.translate-validation.<locale>.json` listing every failure with the offending key, source, translation, and which rule it broke.

**Retry policy:** If ≥1 string fails, fire ONE retry to the translator with just the failing strings + the specific rule violation as an instruction ("This translation was rejected because X. Try again, fix only X."). Merge the retry result back.

After retry, if any string still fails: keep the source string in place (don't ship broken output), and flag it in the QA report. Never silently drop or substitute.

---

## Phase 5 — Apply to Figma (parallel, one JS execution per locale)

For each locale, fire **one** `use_figma` JS execution. Pattern:

```js
// Per-locale write — all node updates in one async batch
async function translatePage(sourcePageId, localeCode, translations) {
  const sourcePage = await figma.getNodeByIdAsync(sourcePageId);
  if (!sourcePage) throw new Error(`source page ${sourcePageId} not found`);
  await figma.setCurrentPageAsync(sourcePage);

  // Duplicate the page
  const newPage = sourcePage.clone();
  newPage.name = `${sourcePage.name} — ${localeCode.toUpperCase()}`;
  figma.root.appendChild(newPage);
  await figma.setCurrentPageAsync(newPage);

  // Pre-load every font we'll need (unique by family+style)
  const fontPairs = new Set();
  for (const t of translations) fontPairs.add(`${t.fontFamily}::${t.fontStyle}`);
  await Promise.all(
    Array.from(fontPairs).map(p => {
      const [family, style] = p.split("::");
      return figma.loadFontAsync({ family, style });
    })
  );

  // For each translation, look up the node on the NEW page and write
  // Note: cloned nodes have NEW ids. We match by walking and comparing name+position.
  // Better approach: build a map from sourceNodeId → newNodeId via parallel traversal.
  const idMap = mapClonedTree(sourcePage, newPage);

  let written = 0, missing = 0;
  for (const t of translations) {
    const newId = idMap.get(t.sourceNodeId);
    if (!newId) { missing++; continue; }
    const node = await figma.getNodeByIdAsync(newId);
    if (!node || node.type !== "TEXT") { missing++; continue; }
    node.characters = t.translation;
    written++;
  }
  return { newPageId: newPage.id, newPageName: newPage.name, written, missing };
}

function mapClonedTree(src, dst) {
  const map = new Map();
  function walk(a, b) {
    map.set(a.id, b.id);
    const ac = "children" in a ? a.children : [];
    const bc = "children" in b ? b.children : [];
    for (let i = 0; i < Math.min(ac.length, bc.length); i++) walk(ac[i], bc[i]);
  }
  walk(src, dst);
  return map;
}
```

**All locale executions fire in parallel** (single message with N `use_figma` calls). Total Phase 5 = ~10–15s.

**Component instance handling:** because we duplicated the entire page, instances on the new page reference the same masters. Setting `node.characters` on a text node inside an instance creates an **instance override** on the new page — the master is never touched, the original page is never touched. This is the safe behavior we want.

**Font fallback:** if any `loadFontAsync` rejects, retry once with the same family but `Regular` style. If still failing, skip those nodes and flag in the QA report. Never proceed with corrupted text.

---

## Phase 6 — Auto QA report

For each locale, write `projects/<brand-or-default>/translate-reports/<YYYY-MM-DD-HHmm>-<fileKey>-<locale>.md`:

```markdown
# Translation report — <fileName> — <locale>

- File: https://figma.com/design/<fileKey>/
- Source page: <name>
- Target page: <name — LOCALE>
- Source language: <source>
- Target language: <locale>
- Ran at: <timestamp>
- Counts: <N> strings translated · <M> retries · <K> kept-as-source · <P> nodes written · <Q> nodes missing

## Strings (sorted by length-change)

| Source | Translation | Δ length | Status |
|---|---|---|---|
| "Sign up and learn" | "Anmelden und lernen" | +18% | ok |
| ... |

## Skipped (do-not-translate)

| String | Reason |
|---|---|
| "BrainTrade" | brand name |
| "+359" | phone prefix |
| ... |

## Validation failures (post-retry)

| Key | Rule | Source | Translation |
|---|---|---|---|
(empty if all passed)

## Images with visible text (flagged for manual review)

| Node ID | Layer name |
|---|---|
| 2389:8557 | hero/creative-image |
| ... |
```

---

## Phase 7 — Summarize in chat

One-line summary, then breakdown:

```
/translate-figma done — <N> locales · <M> strings · <P> pages created in Figma · ⏱ <elapsed>s · reports: projects/<brand>/translate-reports/
```

Then a per-locale table:

| Locale | Strings | Retries | Pages | Status |
|---|---|---|---|---|
| de | 82 | 1 | 1 | ✓ |
| es | 82 | 0 | 1 | ✓ |
| fr | 82 | 0 | 1 | ⚠ 2 strings kept-as-source (length budget) |

End with the direct Figma URLs to each new page.

---

## Fail-fast rules

- Missing `FIGMA_TOKEN` → stop, link `projects/qa/README.md`.
- `fetch.py` errors → surface stderr verbatim.
- `extract.py` strict-mode failure (frame count ≠ 3) → tell the teammate which frames were found and how to fix (rename, hide extras, or pass `--page <name>`).
- Figma MCP not connected → stop.
- Font not in Figma's cloud library → finish the write phase but flag the affected nodes; never silently substitute fonts.
- Translation skill returns malformed JSON twice → stop for that locale, keep the others going.

## Performance targets

| Phase | Target time |
|---|---|
| 1. Extract | ≤ 30 s |
| 2. Load voice/glossary | ≤ 1 s |
| 3. Translate (parallel) | ≤ 30 s |
| 4. Validate + retry | ≤ 30 s |
| 5. Apply to Figma (parallel) | ≤ 30 s |
| 6. QA reports | ≤ 10 s |
| 7. Summarize | ≤ 5 s |
| **Total** | **≤ 5 min** |

If a phase exceeds its budget by 2×, surface a warning in the final summary and check `projects/qa/.cache/` for the slow artifact.

## Non-goals

- Does not re-render image content (text baked into images is flagged, not translated).
- Does not modify component masters or anything on the source page.
- Does not run native-speaker review — the `anthropic-skills:translate` skill output is final.
- Does not handle pages with ≠3 device frames (strict mode).
- Does not preserve in-Figma text-style overrides applied per-character (only paragraph-level `characters` is set).
- Does not sync translations back to `content.json` or HTML — Figma is the deliverable.

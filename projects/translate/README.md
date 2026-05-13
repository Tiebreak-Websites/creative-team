# /translate-figma — automated Figma localization

Translate every text node on a 3-breakpoint Figma page (desktop / tablet / mobile)
into one or more locales. Fully automated, ≤5 min, no human QA. Always
non-destructive — Claude duplicates the source page per locale; the original is
never touched.

```
/translate-figma <figma-url> <locales> [--page <name>] [--brand <name>] [--dry-run]
```

Examples:

```
/translate-figma https://figma.com/design/5t066Ac9yDEqdJ7fvN05Pv de
/translate-figma https://figma.com/design/5t066Ac9yDEqdJ7fvN05Pv de,es,fr,bg,it
/translate-figma https://figma.com/design/abc123 de --page "LP Template"
/translate-figma https://figma.com/design/abc123 de --dry-run
```

## How it works

```
1. fetch.py        Figma REST API → cached JSON                       (~10 s)
2. extract.py      walks 3 frames, dedupes by exact string, classifies (~1 s)
3. translate skill one parallel Agent per locale → translated JSON     (~25 s)
4. validate.py     length / placeholders / glossary / char limits      (~5 s)
5. use_figma MCP   duplicate source page per locale, write back          (~15 s)
6. report          markdown QA report per locale                         (~5 s)
                                                              ─────────────
                                                              ≤ 5 min total
```

## Components

```
projects/translate/
  scripts/
    extract.py             walks the cached Figma JSON, finds the 3 frames,
                           dedupes by exact-string match, applies do-not-
                           translate rules, writes the flat strings JSON
                           the translator consumes.
    validate.py            checks each locale's translated JSON against
                           the source: placeholder integrity, length
                           budget, glossary respect, character limits.
                           Produces a retry payload for the rejected
                           strings.
  i18n/
    glossary.global.json   defaults — brand-name allowlist, preferred
                           per-locale terms, character limits per role,
                           length budget per locale.
    brand-voice.default.md tone-of-voice instructions fed into every
                           translation run when no per-brand voice
                           override exists.
.claude/commands/
  translate-figma.md       the slash command runbook Claude follows.

# Per-brand overrides (optional):
projects/<brand>/i18n/glossary.json
projects/<brand>/i18n/brand-voice.md
```

## Inputs

- **`FIGMA_TOKEN`** — same env var as `/qa`. Get one at
  https://www.figma.com/settings → Personal access tokens. Needs
  read scope on the target file(s). Set in your shell:
  - PowerShell: `$env:FIGMA_TOKEN = '<token>'`
  - bash/zsh: `export FIGMA_TOKEN=<token>`
- **Figma MCP** — `use_figma` capability (figma-desktop or cloud MCP).
  Required for Phase 5 (the write phase). The REST API is read-only.

## Outputs

For each locale `<L>` you pass, Claude produces:

1. A **new Figma page** named `<original-page-name> — <L>` with all 3
   responsive frames duplicated and every translatable text node updated.
   The source page is untouched. Component instances on the new page
   receive instance overrides — masters are never modified.
2. A **markdown QA report** at
   `projects/<brand-or-default>/translate-reports/<YYYY-MM-DD-HHmm>-<fileKey>-<L>.md`
   with the source-to-translation table, skipped strings, validation
   failures, and a list of image nodes that contain visible text (flagged
   for manual review).

Intermediate artifacts (in `projects/qa/.cache/`):

```
<fileKey>.json                                       full Figma file (from fetch.py)
<fileKey>.translate-source.json                      extracted tree + dedup map
<fileKey>.translate-strings.<source-lang>.json       flat input to translator
<fileKey>.translate-<locale>.json                    translator's output (one per locale)
<fileKey>.translate-validation.<locale>.json         validation results (one per locale)
```

## Do-not-translate rules

A text node is left alone if **any** of these applies:

- Layer name starts with `🔒`, `[notrans]`, `EN:`, or `NOTRANS:`
- Content is a URL, email, phone number, or pure number / percentage / currency
- Length < 2 chars
- Content exactly matches a `doNotTranslate` term in the glossary
  (`projects/translate/i18n/glossary.global.json`, plus any per-brand override)

Designers can flag any extra nodes they want preserved by prefixing the
layer name with `🔒` in Figma.

## Strict mode

The command refuses to run on pages whose frame layout isn't unambiguous:

- The page must contain at least 3 `FRAME`s.
- Frames are bucketed by width: desktop ≥ 1200 px, tablet 600–1199 px, mobile < 600 px.
- Each bucket must have **exactly 1** frame after a name-based tiebreaker.

If the page has 4+ frames, an empty bucket, or two ambiguous frames in
the same bucket, `extract.py` aborts with a clear instruction (rename
one, hide extras, or pass `--page <name>` to scope to a specific page).

## Quality bar

The translator is the `anthropic-skills:translate` skill — multilingual
professional translator that preserves Markdown / HTML / placeholders /
technical terminology / tone of voice. We add:

- Brand voice file fed verbatim into the prompt
- Per-locale glossary (brand names, preferred terms)
- Per-string character limits for CTAs and hero titles
- Length budget per locale (DE ≤ 135%, FR ≤ 120%, ES ≤ 115%, etc.)
- Automated validation with **one silent retry** when a string fails

If a string still fails validation after retry, the source is kept in
place (never broken output) and the QA report flags it.

## Non-goals

- Does not re-render text baked into images (flagged in the QA report).
- Does not modify component masters or the source page (instance overrides only).
- Does not run human review — the skill's output is final.
- Does not handle pages with ≠ 3 device frames (strict mode).
- Does not preserve per-character text-style overrides — only paragraph-level `characters` is set.
- Does not sync translations back to `content.json` or HTML — Figma is the deliverable.

## Adding per-brand overrides

When a brand has terms that should always translate a specific way, or
a voice that differs from the default:

```
projects/<brand>/
  i18n/
    glossary.json      same shape as glossary.global.json — keys merge on top of global
    brand-voice.md     replaces brand-voice.default.md entirely for this brand
```

Pass `--brand <name>` (or let auto-match infer it from the Figma file
name) and the per-brand files load automatically.

## Troubleshooting

| Error | Fix |
|---|---|
| `FIGMA_TOKEN not set` | Generate one at figma.com/settings, export it in your shell |
| `strict mode: N desktop frames found` | Rename one of the candidates to include "desktop", hide the extras, or pass `--page <name>` |
| `no page has exactly 3 classifiable frames` | The file's layout isn't ≥3 frames at the canonical widths. Pass `--page <name>` to target a specific page |
| `Font X is not in Figma's cloud library` | Either upload the font in Figma → fonts settings, or substitute it. Server-side MCP can't access locally-installed fonts |
| Validation `failedCount` keeps climbing after retry | The translator is consistently struggling with this string. Check character limit, then either relax the limit in the glossary or shorten the source string |

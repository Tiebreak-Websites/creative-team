# Creative Team

A toolkit of slash commands for the design + creative team — runs inside [Claude Code](https://claude.com/claude-code).

```bash
git clone https://github.com/chr1srusevv/creative-team.git
cd creative-team
claude
```

Type `/pull` to sync. Type any command below to use it.

---

## 🔧 Commands

<details>
<summary><strong>/pull</strong> — sync latest from main</summary>

Fetch the latest team work. Run this before starting anything new.

```
/pull
```

**What it does**
- Fetches `main` from GitHub
- Refuses to overwrite uncommitted work (safe by default)
- Summarizes what teammates have shipped since you last synced
- Surfaces any merge conflicts so you can resolve them before they bite

**When to use**: every time you start a new piece of work.

[Full spec →](.claude/commands/pull.md)

</details>

<details>
<summary><strong>/push</strong> — commit + open a pull request</summary>

Ship your current branch as a PR. Claude shows the diff, proposes a commit message, asks before committing, pushes, and opens the PR.

```
/push
```

**What it does**
- Shows you the diff before committing (you can still bail out)
- Generates a commit message that focuses on the *why*, not just the *what*
- Enforces the feature-branch rule — refuses to push to `main`
- Opens the PR with a generated title + body + test plan checklist
- Never force-pushes, never skips hooks, never bypasses signing

**When to use**: when your branch is ready for team review.

[Full spec →](.claude/commands/push.md)

</details>

<details>
<summary><strong>/qa</strong> v1.1 — automated QA for localized Figma landing pages</summary>

Audit a Figma LP for translation parity, image localization, overflow, broken placeholders, missing CTAs, and regulator phrase compliance — in seconds.

```
/qa <figma-url> <lang> [--brand <name>] [--tone] [--post]
```

**Example**

```
/qa https://figma.com/design/<fileKey>/... pt-BR --brand braintrade --tone --post
```

**What it does**
- One-shot REST fetch via the Figma API
- Deterministic Python checks: parity vs. EN source, placeholder integrity, image localization, text overflow, CTA presence, regulator phrases
- LLM judgment for language quality and conversion tone
- Writes a Markdown report to `projects/<brand>/qa-reports/`
- Optional `--post` pins comments directly to Figma nodes for the designer to action

**Requires**
- `FIGMA_TOKEN` env var (Personal Access Token from figma.com/settings)
- One-time setup: [`projects/qa/README.md`](projects/qa/README.md)

**When to use**: before any localized LP goes to client review.

[Full spec →](.claude/commands/qa.md)

</details>

<details>
<summary><strong>/banner</strong> v2.0 — multi-concept banners → Figma with auto-LP context + designer review pause</summary>

Generate **multiple** ad banner concepts with **Higgsfield GPT Image 2** and paint them into a Figma file at exact pixel sizes. Claude auto-reads the LP hero from the same Figma file, asks you which visual approaches should ship via clickable polls, renders one MVP per chosen approach, pauses for you to review in Figma, and then recomposes every approved MVP to every requested size.

```
/banner <figma-url> <WxH> [<WxH> ...]
Title: <verbatim title copy>
cta: <verbatim CTA copy>
```

**Example**

```
/banner https://figma.com/design/<fileKey>/...
Title: O Brasil está comprando ações de IA. E você?
cta: Entre agora
1200x1200, 1200x628, 960x1200
```

**What you get**
- One Figma frame per (concept × size) combination at exact pixel dimensions, grouped per concept in a single row
- Every rendered banner painted in as a FILL — MVPs first, recomps after your Continue click
- A summary table with concept index, frame node IDs, Higgsfield job IDs, and any crop/timeout warnings

**Workflow** *(blocking points marked 🛑)*

1. **Phase 0** — auto-detect language from copy (drives subject demographics, typography script, LTR/RTL direction)
2. **Phase 0.2** — one-line cost preview before any credit fires
3. **Phase 0.3** — classify emotional register (aspiration / urgency / provocation / trust / curiosity / empowerment / identity)
4. **Phase 0.4** — **auto-screenshot the LP hero** from the same Figma file. Extract subject archetype + 3 dominant hex + tone. (Mandatory, fail-soft — proceeds without LP if the hero frame can't be found.)
5. **Phase 0.5** — 🛑 **two clickable polls (AskUserQuestion, no chat typing)**:
   - Poll #1 (multi-select): which visual approaches should ship — Human / AI Robot / Mirror LP / Wild Card
   - Poll #2 (single-select): 0–3 extra Claude-picked variations
   - Total = your picks + extras (1–7 concepts)
6. **Phase 1** — compose N short visual prompts (~500 chars soft, ≤800 hard). Adaptive — no register lookup tables.
7. **Phase 2** — render all N MVPs in parallel at 1200×1200
8. **Phase 3** — create all (N × M) Figma frames upfront, grouped per concept in a single row
9. **Phase 4** — paint MVPs into their 1:1 frames
10. **Phase 5** — 🛑 **designer review pause**: AskUserQuestion → Continue / Regenerate one MVP / Stop. Regenerate loops back to this pause.
11. **Phase 6** — recompose every surviving MVP to every requested non-1:1 size (parallel)
12. **Phase 7** — paint recomps into their frames
13. **Phase 8** — summary table with concept index, frame IDs, job IDs, and warnings

**v2.0 deltas vs v1.8**

- **Auto LP-context read** — no more drag-drop screenshots; Claude calls `get_screenshot` on the same Figma file
- **Multi-concept, no winner pick** — every picked approach ships; Phase 0.5 picks become deliverables, not candidates
- **Clickable polls everywhere** — Phase 0.5 and Phase 5 both use `AskUserQuestion`, never chat replies
- **Designer review pause** — between MVPs and recomps, the run pauses so you can review and regenerate any concept in Figma
- **Adaptive framework** — register lookup tables dropped (color family, CTA finishing, lighting matrix); decisions made per banner from LP palette + register + copy
- **Compressed prompts** — visual prompt template down to ~500 chars soft target so the model has room to be creative
- **CTR-anxiety rules pruned** — highlighter ban, 2-line ban, flat-CTA ban, neutral-lighting ban, ornament-from-list rule all removed; cultural / RTL / brand-safety guardrails stay
- **Bigger but disciplined CTA** — 110–140px tall, text fills 60–80% button width, no wrap, no clip

**Requires**
- Higgsfield MCP connector configured
- Figma MCP connector configured (now **read + write** — needs `get_screenshot`, `use_figma`, `upload_assets`)

[Full spec →](.claude/commands/banner.md)

</details>

<details>
<summary><strong>/translate-figma</strong> v1.0 — auto-translate any 3-breakpoint Figma page</summary>

Hand Claude a Figma URL + a comma-separated list of locales. It walks the desktop / tablet / mobile frames, deduplicates the source copy across all three (≈80 unique strings from ≈240 nodes is typical), translates with the `anthropic-skills:translate` skill — feeding it a brand glossary + voice file + per-string character limits — validates every translation against length budgets and placeholder integrity (silent retry on failure), then duplicates the source page once per locale and writes the translations back into Figma. End-to-end ≤ 5 minutes for up to 5 locales. Fully automated, no third-party QA, source page never touched.

```
/translate-figma <figma-url> <locales> [--page <name>] [--brand <name>] [--dry-run]
```

**Example**

```
/translate-figma https://figma.com/design/<fileKey>/... de,es,fr,it,bg
```

**What you get**
- One new Figma page per locale, named `<original> — <LOCALE>`, with all 3 breakpoints translated
- A Markdown QA report per locale at `projects/<brand-or-default>/translate-reports/`
- Length-change stats, skipped-strings list, validation failures, and a list of image nodes with visible text (flagged for manual re-render)

**Key features**
- **String-match dedupe** — same copy across desktop/tablet/mobile is translated once and fanned out, guaranteeing consistency across breakpoints
- **Strict 3-frame mode** — refuses to run on pages without exactly 1 desktop (≥1200px), 1 tablet (600–1199px), 1 mobile (<600px) frame; surfaces a clear error if ambiguous
- **Non-destructive** — duplicates the source page; original is read-only. Component instances on the new page get instance overrides; masters are never touched
- **Auto-skip rules** — URLs, emails, phone numbers, pure numbers, brand-allowlist terms, and any layer prefixed `🔒` / `[notrans]` / `EN:` are preserved verbatim
- **Validation with retry** — placeholder integrity, length budget (DE ≤135%, FR ≤120%, ES ≤115%, …), glossary respect, CTA character limits. One silent retry per failed string; if still failing, keeps the source in place and flags in the report
- **Parallel per-locale execution** — translation Agents and Figma writes both fan out in parallel; 5 locales finish in the same wall time as 1

**Requires**
- `FIGMA_TOKEN` env var (same as `/qa`)
- Figma MCP `use_figma` capability connected (write phase)

**When to use**: every time you ship a localized version of an LP. The new pages are designer-reviewable in Figma without leaving the file.

[Full spec →](.claude/commands/translate-figma.md) · [Project docs →](projects/translate/README.md)

</details>

<details>
<summary><strong>/banner-prompt</strong> v1.2 — banner prompts only (no rendering, no Figma)</summary>

Same creative reasoning as `/banner` — **without** firing Higgsfield or touching Figma. Pure prompt output you can copy-paste anywhere, plus 5 numbered alternative approaches you can switch between by replying with a single digit.

```
/banner-prompt
Title: <verbatim title copy>
cta: <verbatim CTA copy>   (optional in this mode)
[+ optional LP hero screenshot]
```

**What you get**

1. A `📋 Approach:` summary line
2. A fenced code block with the ready-to-copy visual prompt (≤ 2,800 chars)
3. A `🎨 5 alternative approaches` list — reply with `1`–`5` to regenerate in that direction, describe your own in one line, or type `done` to finish

**When to use**
- Review the prompt before spending any credit to render
- Iterate cheaply (~$0) across multiple creative directions
- Hand the prompt to a different image tool or vendor

Every variant respects the same framework as `/banner` — cultural safety, RTL handling, verbatim copy, hex-coded palettes, money-element priority, register classification, CTA alignment.

[Full spec →](.claude/commands/banner-prompt.md)

</details>

---

## 📅 Daily workflow

1. `/pull` — sync
2. `git checkout -b feature/<your-name>-<thing>` — new branch
3. Build (Claude can help — just describe what you want)
4. `/push` — commit + open PR
5. PR review → merge

---

## 📁 What's in the repo

| Path | What it is |
| --- | --- |
| [`.claude/commands/`](.claude/commands/) | Team slash commands — auto-loaded by Claude Code in this repo |
| [`.claude/memory/`](.claude/memory/) | Shared Claude memory — Figma file keys, node IDs, design tokens |
| [`CLAUDE.md`](CLAUDE.md) | Team rules Claude follows here (read this first) |
| [`projects/braintrade-template/`](projects/braintrade-template/) | BrainTrade LP template (protected — PR review required) |
| [`projects/creative-summary/`](projects/creative-summary/) | Bilingual creative summary automation (in progress) |
| [`projects/qa/`](projects/qa/) | Automated QA for localized Figma LPs |
| [`projects/translate/`](projects/translate/) | Automated Figma translation pipeline (extract → translate → push back) |

---

## 🛡 Rules

- ❌ Never commit directly to `main`
- ❌ Never auto-commit — always ask first
- ❌ Never force-push, skip hooks, or `reset --hard` without asking
- ✅ Always work on a feature branch, always open a PR, always get review
- ✅ **When you change a slash command, update this README in the same PR** (versions, descriptions, examples — keep them in sync)

Full rules: [`CLAUDE.md`](CLAUDE.md). If Claude ever suggests bypassing these, push back — they exist because they've prevented lost work before.

---

## 👥 Contacts

- Project owner: [@chr1srusevv](https://github.com/chr1srusevv)
- Repo: https://github.com/chr1srusevv/creative-team
- Issues / feedback: open a GitHub issue on this repo

---

## License

Internal team use. Do not redistribute outside the team without project-owner approval.

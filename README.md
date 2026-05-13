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
<summary><strong>/banner</strong> v2.4 — general visual intelligence + reasoning-first ad design</summary>

Render one or more banner concepts with **Higgsfield GPT Image 2** and paint them into a Figma file at exact pixel sizes. **You** pick the hero frame in Figma first (so the URL carries the node-id), then paste the URL + Title(s) + CTA. Claude reads only that node for LP context, asks at most 4 short clickable questions per concept, renders, and paints. Runs silently — only critical issues surface.

```
/banner <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                  ← optional; Claude suggests if missing
[<WxH> ...]                                   ← optional; defaults to 1200×1200, 1200×628, 1080×1920
```

**Example — single concept**

```
/banner https://figma.com/design/<fileKey>/...?node-id=38-1040
Title: เงินฝากครั้งแรกของคุณจะเพิ่มเป็นสองเท่า โบนัส 100%
CTA: เริ่มต้นลงทุนกับ Academy
```

**Example — two concepts in one run (parallel masters + recomps)**

```
/banner https://figma.com/design/<fileKey>/...?node-id=1-456
Title: +171% 2024. +39% 2025. Investerar du?
Title: 43 analytiker säger Stark Köp. AI-handeln är inte över.
```

**What you get**
- One Figma frame **row per concept**, one frame per requested size
- The rendered banner painted in as a FILL (MVP first, recomps after your Continue click)
- A one-line success summary + an optional problem-list of any silent issues from the run

**Polls (at most 4 per concept, all clickable, plain language)**

1. **Title highlight** — which part of the title pops? (3–4 candidates + "no highlight")
2. **Button** — only if `CTA:` missing. Claude suggests 3 short options + "no button"
3. **Visual direction** — 3 specific directions Claude composes from LP + title + register + "Creative AI decides"
4. **Local cues** — only for non-English markets. Subtle (default) / Strong / None. Asked once across all concepts (shared)

**Strict requirements**

- Figma URL must contain `node-id=X-Y` — pre-select the hero frame in Figma before copying the URL. If missing, `/banner` fails fast with a clear instruction.
- `Title:` is required (full headline text verbatim). Multiple `Title:` lines = multiple concepts (cap 4 per run).
- For cloud Claude Code workspaces, allowlist both `d8j0ntlcm91z4.cloudfront.net` and `mcp.figma.com` — pre-flight checks both and fails fast if blocked.

**v2.4 deltas vs v2.3** — general visual intelligence + three P1 fixes from the v2.3 visual review

**Visual intelligence overhaul:**

- **Phase 1.0 visual reasoning (NEW).** Before composing any prompt, Claude reasons about what the ad is selling, what emotion it should create, and what visual metaphor best fits the copy. No reflexive AI-chip / fintech-chart / trading-floor unless the brief clearly calls for them. Visual concept is derived fresh per task.
- **Campaign-meaning → visual logic catalog.** Reference table mapping meaning archetypes (AI/tech, investing, education, luxury, lifestyle, urgency, trust, SaaS, problem/solution, local-identity) to characteristic visual logics. Seeds Poll 3 options; doesn't dictate them.
- **Three-zone composition planning.** Every prompt has an explicit Text Zone, Main Visual Zone, CTA Zone — planned before render. Prompt describes an advertising layout, not a scene.
- **Per-aspect layout rules.** Each aspect (1:1, 1.91:1, 16:9, 3:4, 9:16) has a placement recipe. Recomp redesigns layout per format, never just resize.
- **Banner quality standard + anti-patterns.** Hard guardrails against generic stock-photo people, random people-on-laptops, fake logos, fake platform screenshots, excessive glow, decorative text effects, template aesthetics.
- **On-screen data localization.** Data-product subjects (terminal / dashboard / app UI) populated with market-native data labels (SEB, Nordea, Handelsbanken for Nordic; etc.) instead of US defaults.

**P1 fixes from v2.3:**

- **Stacked vs inline highlight mode.** Resolves the line-break ↔ size-escalation conflict. `(highlight_chars × base_size × 1.12) / column_width` decides: > 0.40 = Inline (drop size escalation); ≤ 0.40 = Stacked (highlight on its own row at 1.12×).
- **CTA color tier rule.** Tier 1 (highlight) and Tier 2 (CTA) never share the same hex. When highlight = LP accent, CTA uses a darker shade (~70% L) or LP's actual button color.
- **Title block height as ratio of canvas.** `clamp(canvas_h × 0.22, 180, 480) px` locks campaign-wide typographic rhythm.

**P2 additions:**

- **Phase 6.5 silent visual QA.** Claude reads every recomp PNG before painting and scores composition fidelity (line structure, prop manifest, edge clipping, alignment, highlight treatment, readability). Auto-retries critical failures once.
- **Master prop manifest enforced.** Every prop named in master is a checklist for recomps.
- **Subject vertical fill rule for TALL.** 9:16 / 3:4 subject occupies 45–55% of canvas height (no crushing).

**Requires**
- Higgsfield MCP connector configured
- Figma MCP connector configured (read + write)
- Cloud workspaces: allowlist `d8j0ntlcm91z4.cloudfront.net` and `mcp.figma.com`

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

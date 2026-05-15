# Creative Team

A toolkit of slash commands for the design + creative team — runs inside [Claude Code](https://claude.com/claude-code).

```bash
git clone https://github.com/chr1srusevv/creative-team.git
cd creative-team
cp .env.example .env   # then fill in your keys
claude
```

Type `/pull` to sync. Type any command below to use it.

---

## 🔌 Project MCP servers

The repo ships a project-level [`.mcp.json`](.mcp.json) so every team member picks up the same MCP servers on next `/pull`. Per-user secrets stay local via `.env` (gitignored).

| MCP | Mode | What it adds | Required env |
|---|---|---|---|
| **framelink-figma** ([GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)) | read-only | Clean structured JSON view of any Figma node via Figma REST. Faster + smaller than the default `get_design_context` for design-context lookups. Useful for `/qa`, `/translate-figma`, `/banner-openai` brief composition. | `FIGMA_API_KEY` (Figma personal access token — read scope is enough) |
| Official Figma MCP (`a17e5c91-…`) | read+write | Built-in to Claude Code at the user level. Bidirectional writes via `use_figma`, screenshots, asset uploads. Already used by `/translate-figma`, `/banner-higgsfield`, `/banner-openai`. | OAuth handled by Figma desktop app |
| OpenAI image MCP (`7e69985f-…`) | read+write | Built-in via Higgsfield. Backs `/banner-higgsfield`. Not used by `/banner-openai` (which calls OpenAI REST directly). | (Higgsfield MCP setup) |

**Not installed (intentionally):**
- `grab/cursor-talk-to-figma-mcp` — Cursor-only per its own docs. Requires Bun runtime + a separate WebSocket server + a Figma plugin install. The official Figma MCP already gives us bidirectional writes; adding Grab would duplicate capability while tripling moving parts.

**One-time setup for each teammate** — pick ONE option:

### Option A (recommended) — persistent user env vars (no admin, no launcher needed)

```powershell
cp .env.example .env
# Fill in OPENAI_API_KEY + FIGMA_API_KEY

# One-time: copy each key into a persistent USER env var (per-user, no admin/UAC).
# After this, plain `claude` works from any shell forever.
Get-Content .env | ForEach-Object {
  if ($_ -match '^([A-Z_][A-Z0-9_]*)=(.+)$') {
    $name, $val = $Matches[1], $Matches[2].Trim()
    if ($val -and $val -notmatch '^(sk-\.\.\.|figd_\.\.\.)$') {
      [Environment]::SetEnvironmentVariable($name, $val, "User")
    }
  }
}

# Open a fresh PowerShell and run:
claude
```

POSIX/macOS — add to `~/.zshrc` or `~/.bashrc`:
```bash
set -a; [ -f ~/path/to/creative-team/.env ] && source ~/path/to/creative-team/.env; set +a
```

### Option B — launcher script (no persistent vars; sources `.env` on each launch)

```powershell
cp .env.example .env
# fill in keys, then every time:
.\scripts\claude.ps1
```

POSIX/macOS:
```bash
./scripts/claude.sh
```

Use this if you don't want keys in your global user env (e.g. shared machine), or if you frequently rotate keys without restarting your shell.

### Why one of these is required

Claude Code does NOT auto-load `.env`. MCP servers configured in [`.mcp.json`](.mcp.json) (like Framelink) read `${FIGMA_API_KEY}` from Claude Code's process environment at startup. If the var isn't there, the MCP fails to authenticate. Option A makes the var permanent at the user level; Option B injects it for one launch.

### Verify after `claude` starts

Ask Claude *"what Framelink tools are available?"* — you should see `mcp__framelink-figma__get_figma_data` and `mcp__framelink-figma__download_figma_images`. Both are pre-authorized in [`.claude/settings.json`](.claude/settings.json) — no per-call prompts.

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
<summary><strong>/banner-higgsfield</strong> v2.7 — Claude writes a short brief, Higgsfield draws the picture</summary>

Render one or more banner concepts with **Higgsfield GPT Image 2** and paint them into a Figma file at exact pixel sizes. **You** pick the hero frame in Figma first (so the URL carries the node-id), then paste the URL + Title(s) + CTA. Claude reads only that node for LP context, asks at most 4 short clickable questions per concept, writes a **short creative brief** (not a photoshoot direction), lets Higgsfield create the picture, and paints. Runs silently — only critical issues surface.

```
/banner-higgsfield <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                  ← optional; Claude suggests if missing
[<WxH> ...]                                   ← optional; defaults to 1200×1200, 1200×628, 1080×1920
```

**Example — single concept**

```
/banner-higgsfield https://figma.com/design/<fileKey>/...?node-id=38-1040
Title: เงินฝากครั้งแรกของคุณจะเพิ่มเป็นสองเท่า โบนัส 100%
CTA: เริ่มต้นลงทุนกับ Academy
```

**Example — two concepts in one run (parallel masters + recomps)**

```
/banner-higgsfield https://figma.com/design/<fileKey>/...?node-id=1-456
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
3. **Visual direction** — 3 campaign-first directions Claude composes (Typography-led poster / Local hero campaign / Cultural-environment campaign) + "Creative AI decides"
4. **Local cues** — only for non-English markets. Subtle (default) / Strong / None. Asked once across all concepts (shared)

**Strict requirements**

- Figma URL must contain `node-id=X-Y` — pre-select the hero frame in Figma before copying the URL. If missing, `/banner-higgsfield` fails fast with a clear instruction.
- `Title:` is required (full headline text verbatim). Multiple `Title:` lines = multiple concepts (cap 10 per run). Customize mode gets click-heavy beyond 5 concepts — Auto mode is recommended for high N.
- For cloud Claude Code workspaces, allowlist both `d8j0ntlcm91z4.cloudfront.net` and `mcp.figma.com` — pre-flight checks both and fails fast if blocked.

**v2.7 deltas vs v2.6 — split responsibility: Claude writes the brief, Higgsfield writes the picture**

v2.6 fixed the visual direction (campaign poster, not editorial photo) but Claude was still **over-describing** scenes — naming exact subjects, props, lighting, depth layers, design-layer-rule items. That over-specification was steering Higgsfield back toward "realistic photo + text overlay." v2.7 stops Claude from acting like a photoshoot director.

**The core split:**

- **Claude controls the BRIEF.** Campaign understanding · size/layout rules · copy hierarchy · text + CTA placement · market/localization · LP consistency · what to avoid.
- **Higgsfield controls the PICTURE.** Visual creativity · atmosphere · subject interpretation · lighting · decorative energy · poster feel · final image style.

**Concrete changes:**

- **Prompt length tightened again.** v2.7: **450–750 chars preferred, 900 max** (was 700–1,000 / 1,300 in v2.6). GPT Image 2 needs concentrated creative direction, not a system spec.
- **6-section prompt structure** (was 7 / 8): Format + market + mood → Campaign-poster direction → Layout lock → Visual atmosphere → Copy/CTA → Constraints.
- **Phase 1.0 reasoning replaced.** v2.6's 8-step scene reasoning + 5-layer depth formula + Mandatory Design Layer enumeration → **single 9-line Creative Card** per concept (campaign purpose, market, register, hook, hierarchy, LP style, sizes, layout lock, avoid). Tight. No prop enumeration.
- **Aspect-ratio layout locks shortened to ONE LINE each** (1:1 / 1200×628 / 9:16 / 3:4 / 16:9). That one line is the only layout guidance that goes to Higgsfield.
- **What Claude no longer enumerates in the Higgsfield prompt:** exact person details (age, hair, wardrobe, expression) · specific room interiors · detailed prop lists · 5-layer depth breakdown · 8-step reasoning narrative · multi-clause material/texture/light descriptions · the 12-item design layer checklist · highlight treatment in 4 dimensions. Higgsfield decides those.
- **Claude vs Higgsfield responsibility table** added to § Design Framework. Stay in your lane.
- **Phase 2.5 cliché QA simplified** to 6 yes/no questions: campaign-poster vs photoshoot? title is hero? design layer visible? palette not too dark? no office cliché? close to regional reference? One auto-retry max.
- **Background described in 1–2 short phrases**, not enumerated 5-layer depth. "Stockholm waterfront atmosphere" replaces a paragraph.
- **Campaign element manifest scope clarified:** design assets only (title hierarchy, highlight treatment, CTA treatment, main visual metaphor, market atmosphere, color system, graphic panel style, hero subject type if used). Never desk / lamp / notebook / coffee / chip / laptop / monitor unless explicitly the concept.
- **Job-display flakiness handling.** If `job_display` returns empty `{results: []}` for a known-good job ID, cross-check `show_generations` (it's occasionally flaky — treat empty as transient, not failed). Captured from the v2.6 problem-list.

**Carried over from v2.6:** campaign-poster-first creative ceiling, forbidden default style drivers (no walnut desk / brass lamp / analyst portrait / AI chip still life / dark prestige finance), Typography Hero Rule (number / % / strong claim → typography is hero), Nordic localization rewrite (Stockholm waterfront, not desk + lamp), 5 archetypes campaign-first, "continuous promotional campaign composition" background rule, Phase 0.4 / 0.45 / 0.5 polls, Stacked/Inline highlight mode, CTA tier rule, title block height ratio, CTA height ratio, subject vertical fill 45–55% for TALL when subject used, Phase 6.5 silent QA, multi-concept, market exclusion lists, fill-math safe-area, queue-aware polling (hard cap t+30min), Auto-mode 3-direction picker, hard ban on readable invented text, hard ban on hard split-panel.

**Requires**
- Higgsfield MCP connector configured
- Figma MCP connector configured (read + write)
- Cloud workspaces: allowlist `d8j0ntlcm91z4.cloudfront.net` and `mcp.figma.com`

[Full spec →](.claude/commands/banner-higgsfield.md)

</details>

<details>
<summary><strong>/banner-openai</strong> v1.7 — Python runtime + structured prompts + LP cache + moderation pre-flight + resume, ~75–150s for a 3×3 run, ~$0.80</summary>

Renders banner concepts with **OpenAI gpt-image-2** (default) or **gpt-image-1-mini** (`--mini` for previews). Loads the full design framework + reads LP context (cached, TTL 24h) + composes structured Creative Cards + runs silent cliché QA every run — same briefing depth as `/banner-higgsfield`. Paints into Figma via a Python pipeline (stdlib + ThreadPoolExecutor) with built-in 429 retry, pre-flight moderation, and `--resume` after crashes.

Three modes:
- **fast (default)** — gpt-image-2, no polls, full framework + LP cache + Creative Card + auto-QA. **~75–150s for a 3×3 run, ~$0.80.**
- **`--mini`** — gpt-image-1-mini for previews + iteration. ~50s, ~$0.50.
- **`--strict`** — adds blocking polls + MVP→designer pause→edit-chain. ~6 min.

Reads key from `$env:OPENAI_API_KEY` or any of `./.env`, `../.env`, `../../.env`, `../../../.env`, `$HOME/.env` (first hit wins, ordered).

**v1.7 deltas vs v1.6 — post-runtime cleanup:**
- **Prompt assembly moved to [`.claude/scripts/banner-openai/prompts.py`](.claude/scripts/banner-openai/prompts.py).** v1.6 built ~14KB of per-run prompt strings inside Claude's context every time — untestable + token-heavy. v1.7 takes a structured concept dict and emits the 6-section template + all 4 auto-injections (localization, typography, RTL, layout) deterministically. Saves ~$0.30/run in Claude tokens, prompt size 1100 → 870c (under framework's 900-char hard limit), unit-testable.
- **LP screenshot cache** at [`.claude/memory/lp_cache/`](.claude/memory/lp_cache/). Repeat campaigns on the same LP skip the screenshot fetch — saves ~5s + ~$0.10 per re-run. TTL 24h, text-only summaries (~200B/file, safe to commit).
- **Pre-flight moderation** scans user input (title + hook + visual + avoid) for forbidden keywords (politicians, celebrities, banned visual concepts) BEFORE submitting to OpenAI. Saves ~30s + ~$0.04 per blocked job vs. waiting for OpenAI's `moderation_blocked`. Override with `--no-moderation` if user has explicit authorization for a specific person.
- **`--resume` mode** with incremental `results.json` writes (atomic rename via `.tmp`). If a run is interrupted at job 8/15, restart with `--resume` and only the failed/missing 7 frames re-process. Mid-run kills become recoverable.
- **Manifest validation** — runner asserts every `(concept, size)` in `urls.json` resolves to a concept in `manifest.concepts` and a size in `LAYOUT_LOCKS`. Catches the silent paint-mismatch bug where `urls.json` and `manifest.json` could drift.
- **Carries forward from v1.6:** Python ThreadPoolExecutor, concurrency 6, built-in 429 retry exp backoff (8/16/32/64s), live per-job logging, page-root nodeId rejection, drop of `get_metadata` from Phase 0, single key resolver, reusable script in repo.

**Cost per run (3 concepts × 3 sizes, pt-BR):**

| Mode | Wall clock | OpenAI | Claude | **Total** | $/banner-higgsfield | vs `/banner-higgsfield` quality | Reliability |
|---|---|---|---|---|---|---|---|
| v1.5 fast (PS ThreadJob) | ~2 min (or ∞ on hang) | ~$0.55 | ~$0.65 | ~$1.20 | ~$0.13 | parity | broke on long runs |
| v1.6 fast (Python, conc=6) | ~75–150s | ~$0.55 | ~$0.55 | ~$1.10 | ~$0.12 | parity | production-stable |
| **v1.7 fast (cold cache)** | **~75–150s** | **~$0.55** | **~$0.25** | **~$0.80** | **~$0.09** | **parity** | **production-stable + resumable** |
| **v1.7 fast (cache hit)** | **~70–145s** | **~$0.55** | **~$0.15** | **~$0.70** | **~$0.08** | **parity** | **production-stable + resumable** |
| v1.7 `--mini` | ~50s | ~$0.30 | ~$0.20 | ~$0.50 | ~$0.06 | preview-grade | ok |

**When to use which:**
- **Default** — production deliverables, hero campaigns, client work
- **`--mini`** — concept iteration, A/B exploration, internal tests
- **`--strict`** — brand-strict deliverables where you want human gates between MVP and recomps

```
/banner-openai <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept)
Title: <second concept's title>             ← optional additional concepts
CTA: <button text verbatim>                  ← optional; Claude suggests if missing
[<WxH> ...]                                   ← optional; defaults to 1200×1200, 1200×628, 1080×1920
```

**Example**

```
/banner-openai https://figma.com/design/<fileKey>/...?node-id=1-456
Title: Peluang keemasan untuk berdagang - Jangan lepaskan!
Title: Adakah anda bersedia untuk Demam Emas dagangan? Mulakan sekarang!
```

**What's the same vs `/banner-higgsfield`**

- Claude/image-model responsibility split (Claude = BRIEF, model = PICTURE)
- 6-section Visual Prompt template (450–750 chars preferred, ≤900 hard)
- Phase 1.0 Creative Card (9 lines per concept)
- Polls (size selection / Customize-vs-Auto / per-concept polls in Customize)
- Phase 5 designer pause (one multi-select in v1.2)
- 5 creative archetypes, Typography Hero Rule, CTA tier rule
- Localization atmosphere allowlists (incl. Malaysia / Indonesia)
- Multi-concept, grid frame layout, verbatim Title + CTA, hard guardrails

**What's different**

| Concern | `/banner-higgsfield` (Higgsfield) | `/banner-openai` (OpenAI) |
| --- | --- | --- |
| MVP endpoint | `generate_image` MCP, `gpt_image_2` | `POST /v1/images/generations` with `gpt-image-2` |
| Recomp endpoint | Same MCP tool, master via `medias[]` | `POST /v1/images/edits` (multipart), master via `image[]=@<path>` |
| Polling | Async, t+60s poll → 30s cadence, hard cap t+30min | **Synchronous** — request blocks until done (typically 20–90s). HTTP timeout 300s. |
| Auth | MCP-configured | `OPENAI_API_KEY` env var (or local `.env`). Key never logged. |
| Concurrency | 8 concurrent (Ultra Monthly) | v1.7: Python ThreadPoolExecutor, default `max_workers=6`, built-in 429 retry (exp backoff 8/16/32/64s), `--resume` for crash recovery. |
| Available sizes | Any aspect at 1k | Fixed: `1024x1024`, `1024x1536`, `1536x1024`. Mapped per target; FILL handles residual crop (typically 10–22% — see /banner-openai § Aspect map). |
| Egress allowlist | `d8j0ntlcm91z4.cloudfront.net` + `mcp.figma.com` | `api.openai.com` + `mcp.figma.com` |
| Frame name prefix | `Banner-Higgsfield — …` | `Banner-OpenAI — …` (so /banner-higgsfield and /banner-openai grids never collide on the same Figma page) |

**Setup (one-time)**

```bash
# Option 1 — .env file in repo root (already gitignored, recommended for the team)
echo "OPENAI_API_KEY=sk-..." >> .env

# Option 2 — PowerShell session var (ad-hoc)
$env:OPENAI_API_KEY = "sk-..."
```

The v1.6 resolver searches in order: `$env:OPENAI_API_KEY` → `./.env` → `../.env` → `../../.env` → `../../../.env` → `$HOME/.env`. First hit wins.

**Requires**
- An OpenAI org with `gpt-image-2` access
- `OPENAI_API_KEY` set via env var or `.env` (never committed)
- **Python 3.x on PATH** — v1.7 runs the Python pipeline at [`.claude/scripts/banner-openai/run.py`](.claude/scripts/banner-openai/run.py) + uses the prompt module at [`.claude/scripts/banner-openai/prompts.py`](.claude/scripts/banner-openai/prompts.py) (stdlib only, no `pip install`)
- Figma MCP connector configured (read + write)
- Cloud workspaces: allowlist `api.openai.com` and `mcp.figma.com`
- LP cache lives at [`.claude/memory/lp_cache/`](.claude/memory/lp_cache/) — text-only summaries with 24h TTL, safe to commit and share across team

**Security**
- The key is read into a single shell variable / curl `-H` header at run time; it is never printed in tool output, never echoed back to the user, and never written to a committed file. If you ever paste a key directly in chat (it's text — it gets persisted), rotate it at https://platform.openai.com/api-keys before continuing.

[Full spec →](.claude/commands/banner-openai.md)

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

Same creative reasoning as `/banner-higgsfield` — **without** firing Higgsfield or touching Figma. Pure prompt output you can copy-paste anywhere, plus 5 numbered alternative approaches you can switch between by replying with a single digit.

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

Every variant respects the same framework as `/banner-higgsfield` — cultural safety, RTL handling, verbatim copy, hex-coded palettes, money-element priority, register classification, CTA alignment.

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

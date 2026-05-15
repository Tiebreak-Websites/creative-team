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
<summary><strong>/banner-openai</strong> v1.9 — MVP-first (1:1 master → recomp via /v1/images/edits) + interactive polls + designer pause + push notification, ~115-165s for a 3×3 run</summary>

Renders banner concepts with **OpenAI gpt-image-2** (default) or **gpt-image-1-mini** (`--mini`) and paints them into Figma. **MVP-first** — the 1200×1200 master is generated first, then every other size is a **recomposition** of that master via `POST /v1/images/edits` (multipart, master via `image[]`). Mirrors the higgsfield model — same campaign across all aspects, no cross-aspect drift.

| Command | Polls | Designer pause | Sizes | Use when |
|---|---|---|---|---|
| `/banner-openai ...` | Yes (sizes · count · model · brief) | Yes (after MVP) | optional | Default — designer-driven |
| `/banner-openai --fast ...` | No | No | **required** | Ship now |
| `/banner-openai --mini ...` | Yes | Yes | optional | Same flow, gpt-image-1-mini model |
| `/banner-openai --fast --mini ...` | No | No | **required** | Fastest possible preview |

**Reasoning style is strict.** Fast = 1-2 status lines then a push notification. Casual = one short line per phase, then notification + total wall clock. The PNG painted into Figma is the deliverable — no narration of the brief, no QA report, no summary table.

**v1.9 changes vs v1.8:**
- **MVP-first orchestration** — Phase 4 generates only the 1200×1200 master per concept (one `/v1/images/generations` call). Phase 5b then recomposes each non-1:1 size from that master via `/v1/images/edits` — same campaign, same colors, same typography, just relaid out for the new aspect. Eliminates the v1.8 drift where three parallel free gens produced three slightly different barrels / splashes / skylines.
- **Runner edits-endpoint support** — [`run.py`](.claude/scripts/banner-openai/run.py) now dispatches per-job on `mode: "gen" | "edit"`. Edits go through a new `post_images_edits()` helper that assembles multipart/form-data (stdlib only) with `image[]` pointing at the master PNG saved by the prior MVP run.
- **New prompt builder** — [`prompts.py`](.claude/scripts/banner-openai/prompts.py) `build_recomp_prompt(concept, master_size, target_size)` composes the layout-redesign brief per the framework's § Recomposition Prompt Template (~800-1100c, hard cap 1200c).
- **Designer pause in casual** — after the MVP paints, one `AskUserQuestion` to approve / redo / stop before recomp fires. Auto-skipped in `--fast`.
- **2-batch runner invocation** — Claude runs the runner twice per casual flow (MVP, then recomp with `--resume`), letting `results.json` accumulate atomically and supporting mid-run resume after a kill.
- **`avoid` excluded from moderation scan** — fixed in `prompts.py:check_moderation`. Was triggering false positives like `avoid: "us flag"` → blocked render. Negative-instruction fields are now exempt; the auto-injected "no flag, no real person, no fake UI" guardrail still applies in the prompt itself.

**v1.8 carries forward:**
- Push notification on done · `--fast` strips polls + pause + requires sizes · phases flat 1-6 · QA / silent QA / Phase 8 summary deleted · hero bounds sanity check · Windows TEMP path portability.

**v1.7 carries forward:**
- Python ThreadPoolExecutor (conc 6), 429 exp backoff (8/16/32/64s, max 4), LP screenshot cache (24h TTL), structured concept manifest → `prompts.build_prompt()` assembly, moderation pre-flight, `--resume`, manifest validation, frame name prefix `Banner-OpenAI —`.

**Removed flags:** `--strict`, `--customize`, `--edit-chain` (now default), `--no-qa`, `--no-lp`.

**Wall clock + cost (3 concepts × 3 sizes, sv, LP cache hit):**

| Mode | MVP gen | Pause | Recomp gen (edits) | Total | $/run | $/banner |
|---|---|---|---|---|---|---|
| `--fast` | ~60-75s | — | ~50-65s | **~115-145s** | ~$0.75 | ~$0.08 |
| `--fast --mini` | ~30-40s | — | ~25-35s | **~55-75s** | ~$0.45 | ~$0.05 |
| default (casual) | ~60-75s | ~10-20s | ~50-65s | **~125-165s** | ~$0.80 | ~$0.09 |
| `--mini` (casual) | ~30-40s | ~10-20s | ~25-35s | **~65-95s** | ~$0.50 | ~$0.06 |

**Input**

```
/banner-openai [--fast] [--mini] [--sizes=W1xH1,W2xH2] <figma-url-with-node-id>
Title: <full title text verbatim>           ← one or more (each = one concept, cap 10)
CTA: <button text verbatim>                 ← optional
Sizes: 1200x1200, 1200x628, 1080x1920       ← optional in casual / required in --fast
```

**Example**

```
/banner-openai --fast https://figma.com/design/<fileKey>/...?node-id=2001-1697
Title: Oljepriserna är galet höga just nu!
Sizes: 1200x1200, 1200x628, 1080x1920
```

**Flags**
- `--fast` — strip polls, require sizes, ship-only
- `--mini` — `gpt-image-1-mini` model (same flow as default)
- `--sizes=W1xH1,W2xH2,...` — explicit sizes (alternative to `Sizes:` block)
- `--no-paint` — save PNGs only, skip Figma paint
- `--resume` — re-run skipping frames already `ok` in `results.json`
- `--no-cache` — bypass LP screenshot cache
- `--no-moderation` — skip pre-flight forbidden-keyword check
- `--concurrency=N` — override runner concurrency (default 6)

**Setup (one-time)**

```bash
# .env in repo root (gitignored)
echo "OPENAI_API_KEY=sk-..." >> .env
```

Resolver order: `$env:OPENAI_API_KEY` → `./.env` → `../.env` → `../../.env` → `../../../.env` → `$HOME/.env`. First hit wins.

**Requires**
- OpenAI org with `gpt-image-2` access · `OPENAI_API_KEY` in env or `.env`
- Python 3.x on PATH (stdlib only) — runner at [`.claude/scripts/banner-openai/run.py`](.claude/scripts/banner-openai/run.py) + prompts at [`.claude/scripts/banner-openai/prompts.py`](.claude/scripts/banner-openai/prompts.py)
- Figma MCP connector (read + write)
- Cloud workspaces: allowlist `api.openai.com` + `mcp.figma.com`
- LP cache at [`.claude/memory/lp_cache/`](.claude/memory/lp_cache/) (text-only, 24h TTL, safe to commit)

**Security** — Key is never printed in tool output, never written to a committed file. If you paste a key in chat (it persists as text), rotate it at https://platform.openai.com/api-keys.

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

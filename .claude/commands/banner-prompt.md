---
description: Generate a ready-to-copy Higgsfield GPT Image 2 banner prompt using the /banner-higgsfield design framework. No image generation, no Figma writes — pure prompt output, plus 5 numbered alternative approach variants the user can pick by replying with a number.
---

# /banner-prompt — Prompt generator only (no rendering, no Figma) v1.2 (tracks /banner-higgsfield v1.8)

## What this does

Same creative reasoning as `/banner-higgsfield` — but stops before any tool call. Produces:

1. A **ready-to-copy MVP visual prompt** (≤ 2,000 chars) for 1200×1200 / 1:1
2. **Five alternative approach variants** for the same copy, numbered, so the user can regenerate with a different creative direction by replying with a single digit

Use `/banner-prompt` when:
- You want to review the prompt before paying any credit to render
- You want to try multiple creative directions cheaply (~$0 to iterate)
- You want to hand the prompt to a different image tool or vendor

Use `/banner-higgsfield` when:
- You're ready to render and paint into Figma in one shot

---

## Source of truth — reuses /banner-higgsfield

This command reuses **§ Design Framework**, **§ Composition Guide**, **§ Visual Prompt Template**, **§ Emotional Register Library**, **§ Money element treatment by register**, **§ Visual Reference Library**, and the **DO NOT RENDER list** from `.claude/commands/banner-higgsfield.md`. Read those sections — do not re-derive them here.

Everything that applies to `/banner-higgsfield` Phase 0 + Phase 0.3 + Phase 0.4 + Phase 0.5 + Phase 1 applies here unchanged:
- Language auto-detection (incl. dialect cues)
- **Emotional register classification (v1.7)** — per-banner derivation from copy, drives lighting / palette / typography ladder / CTA finishing / background depth ornament
- **LP context analysis (v1.8)** — if user attaches an LP hero screenshot, derive subject archetype + dominant palette + tone register and bias the prompt's subject + accent hex toward continuity
- **Interactive variant-selection poll (v1.8)** — BLOCKING AskUserQuestion with 4 options (human / AI robot / product-led / editorial metaphor) before composing the prompt
- **CTA-alignment rule (v1.8)** — CTA shares an explicit x-anchor with the text block (right-edge align default for LTR aspiration); never floats
- **Lean Visual Prompt Template (v1.8)** — descriptive sections stay prose, structured sections become atomic bullets
- Cultural safety + market-aware imagery rules
- RTL composition + RTL typography
- Money element expanded priority list (number → identity hook → verb → brand → urgency → hero)
- 3-tier hierarchy, 3-size max, max 2 typefaces, typography ladder for HERO > 6 words
- Hex-coded palette discipline + warm-off-white-neutral rule (no pure #FFFFFF for premium)
- Background depth ornament rule (exactly one, ≤15% opacity)
- Premium CTA finishing per register (gradient + glow + inner highlight for aspiration, etc.)
- Product proof element rule for finance/SaaS/etc.
- Verbatim copy rule (HERO + CTA never edited)
- Negative-prompt list + v1.7/v1.8 bans (highlighter yellow, pure white neutral, 2-cramped-lines, flat CTA for aspiration, flat gradient background, cool flat lighting for non-trust, CTA floating without an x-anchor)

What is **explicitly removed** from this flow:
- ❌ No `models_explore` / `generate_image` / `job_display` — no Higgsfield calls of any kind
- ❌ No `use_figma` / `upload_assets` — no Figma reads, no Figma writes
- ❌ No `curl` / no HTTP fetches
- ❌ No frame creation, no painting, no recomposition for other sizes
- ❌ No cost preview (there is no cost)

---

## Input parsing

Arguments: `$ARGUMENTS`. Free-form, no rigid syntax.

**Required:**
- **Title** — the HERO copy verbatim. Accept `Title:`, `Tittle:`, `Headline:`, or an unlabeled line. Never split, never "improve," never translate.

**Optional:**
- **CTA** — `cta:` / `CTA:` / `button:`. If absent, the prompt is composed with no CTA button (per the framework's empty-CTA path; flow ends on hero or money element).
- **lang:** — language override if auto-detection might miss (e.g. `lang: pt-PT`)
- **style:** — free-form one-line style hint (`style: editorial`, `style: dramatic low-key`, `style: clean vector`). Acts as a soft preference for the chosen approach.
- **variant:** — `variant: 3` to regenerate using the previous run's variant #3. Only valid as a follow-up turn.

### Hard fail-fast — STOP and error out

- No title → `❌ /banner-prompt needs the title copy verbatim.`

CTA is **optional** here (unlike `/banner-higgsfield` which requires it). Prompt-only mode tolerates a CTA-less hero banner.

---

## Phase 0 — auto-detect LANGUAGE

Identical to `/banner-higgsfield` Phase 0. Same label set (`pt-BR`, `pt-PT`, `es-LATAM`, `es-ES`, `English`, `Arabic`, `Hebrew`, `Urdu`, `Farsi`, `Pashto`, `th-TH`, `tr-TR`, …). If `lang:` override is supplied, honor it.

Surface the detection line (same format as `/banner-higgsfield` v1.7):

```
🌐 Detected: <LANGUAGE> (cues: "<cue1>", "<cue2>"). Composing prompt…
```

## Phase 0.3 — classify emotional register

Identical to `/banner-higgsfield` Phase 0.3. Read HERO + CTA + LANGUAGE, pick exactly ONE register from § Emotional Register Library (aspiration / urgency / provocation / trust / curiosity / empowerment / identity), then surface:

```
🎭 Register: <register name> (cues: "<cue1>", "<cue2>"). Direction: <one-line visual identity>.
```

The register drives defaults for decisions 4, 6, 7, 9, 11, 12 in the next phase.

## Phase 0.4 — LP context analysis (optional, only when a screenshot is attached)

Identical to `/banner-higgsfield` Phase 0.4. If the user attached an LP hero screenshot, extract subject archetype + dominant hex + tone register + setting/typography style. Surface:

```
🖼️ LP context: <subject archetype> + <2–3 dominant hex> + <tone match: yes/conflict>. Prompt will mirror.
```

If no screenshot → skip this phase.

## Phase 0.5 — interactive variant-selection poll (BLOCKING)

Identical to `/banner-higgsfield` Phase 0.5. Fire `AskUserQuestion` with 4 options (human / AI robot / product-led / editorial metaphor). LP-recommended option (if any) goes first with `(Recommended)` label. The user's pick substitutes into decisions 2/3/4/partial-7 in Phase 1.

This phase blocks. /banner-prompt is interactive — there is no auto-pick fallback.

---

## Phase 1 — compose the MVP visual prompt (silent reasoning)

Apply `/banner-higgsfield`'s Composition Guide in full:

1. **Internally answer the 12-decision checklist** from `.claude/commands/banner-higgsfield.md`:
   1. Realistic customer · 2. Hero subject · 3. Setting · 4. Lighting (register-driven) · 5. Composition direction (LTR/RTL) · 6. Money element (expanded priority list incl. identity hook) · 7. Color palette (register family + per-banner hex) · 8. Typography by script · 9. CTA treatment chassis · 10. Typography ladder (3–4 lines if HERO > 6 words) · 11. Background depth ornament (exactly one) · 12. Premium CTA finishing (gradient / glow / inner highlight per register)
2. **Fill the § Visual Prompt Template** from `.claude/commands/banner-higgsfield.md` with concrete decisions, including the new TYPOGRAPHY LADDER, BACKGROUND DEPTH, PRODUCT PROOF, and CTA finishing blocks
3. **Self-check against the Visual Reference Library** — mentally compare the filled prompt to the register's premium anchor. If it reads closer to the generic anchor, return to step 1 and tighten.
4. **Verify length ≤ 2,800 chars** after filling. If over, tighten — drop redundant adjectives, merge sentences. Never drop content that names a specific subject, position, color, line of copy, the typography ladder, the background depth ornament spec, or the CTA finishing spec.

If a `style:` hint was provided, bias the 12-decision answers toward that hint while still satisfying the framework (cultural safety, RTL rules, money element priority, register defaults remain non-negotiable unless the hint explicitly overrides the register).

If `variant: N` is supplied as a follow-up, look up variant N from the previous turn's alternatives list, substitute its axis choices (imagery style / subject / setting / lighting / palette / register if changed) into the checklist, then recompose.

---

## Phase 2 — emit the prompt for copy-paste

Output exactly this shape so the user can one-click copy the fenced block:

```
📋 Approach: <one-line approach name, e.g. "Aspiration register · golden-hour Brazilian penthouse balcony · dark green + gold palette · 4-line editorial typography ladder · gradient gold pill CTA with glow">

📐 Canvas: 1200×1200 (1:1) · Language: <LANGUAGE> · Direction: <LTR|RTL> · Register: <register>

──── COPY THIS TO HIGGSFIELD GPT IMAGE 2 ────
```
<the filled visual prompt, fenced as a separate ```text``` block so the user can copy in one click>
```
──── END (<XXXX> chars, ≤ 2,800 cap) ────
```

The prompt body MUST be in its own fenced code block (use ```text``` fences) so chat UIs render a copy button on it.

---

## Phase 3 — propose 5 alternative approaches

Immediately after the prompt, offer **5 alternative creative directions** for the same copy + language. Each variant must change **3–5 of the 9 decisions** (subject archetype, setting, lighting, palette, imagery style) — *not* minor color swaps. The variants are genuinely different creative reads, not adjacent tweaks.

Pull each variant from a distinct combination across these axes:

| Axis | Options to vary across the 5 |
|---|---|
| Imagery style | photorealistic · clean vector illustration · 3D render · editorial / magazine cover · cinematic |
| Subject | aspirational human · mirror human (looks like the customer) · product-only · abstract / metaphor · typographic-only |
| Setting | environment-grounded (named props) · clean studio backdrop · abstract directional gradient · urban / location-led · domestic / candid |
| Lighting mood | warm golden hour · cool studio key · neon high-contrast · overcast soft · dramatic low-key |
| Palette mood | dominant warm · dominant cool · monochrome with one accent · duotone · earth tones |

Rules for the 5:
- **All 5 must be culturally appropriate** for the detected LANGUAGE/market. Cultural safety rules from the framework still apply — never recommend a Western default for a non-English banner, never apply cross-region cues.
- **All 5 must respect the same RTL/LTR direction** as the chosen prompt.
- **All 5 must preserve the same money element** — that decision is driven by the copy, not the visual style.
- The 5 should span the axis table — don't cluster all 5 in "photorealistic + human + warm." A typical good spread: 1 photorealistic-human, 1 vector-illustration, 1 product-led, 1 editorial / typographic, 1 cinematic-mood.

Output format:

```
🎨 5 alternative approaches — reply with a number 1–5 to regenerate with that direction:

1. <name> — <one-line: imagery style · subject · setting · lighting · palette mood>
2. <name> — <one-line>
3. <name> — <one-line>
4. <name> — <one-line>
5. <name> — <one-line>

Reply with **1–5** to regenerate, or describe your own approach in one line (e.g. "minimalist editorial, no human, cool monochrome").
Type **done** to finish.
```

---

## Phase 4 — handle the user's reply

- **Reply is `1`–`5`:** look up that variant, substitute its axis choices into the 9-decision checklist, re-run Phase 1 → Phase 2 → Phase 3. The new Phase 3 list must propose **5 fresh variants** (exclude the just-rendered one from suggestions).
- **Reply is a free-form description:** treat it as a `style:` hint, re-run Phase 1 → Phase 2 → Phase 3 with that bias.
- **Reply is "done" / "ship it" / "perfect" / similar:** end the session with one line: `✅ Final prompt above. Paste into Higgsfield GPT Image 2 with model: gpt_image_2, aspect_ratio: "1:1", quality: "high", resolution: "1k".`
- **Reply is anything else** (a new title, a new CTA): treat it as a fresh `/banner-prompt` call with the new inputs.

The loop runs as many turns as the user wants — there is no cap.

---

## Constraints — do not violate

- **No tool calls to image models.** No `generate_image`, no `job_display`, no `models_explore`. This command does not touch Higgsfield.
- **No Figma operations.** No `use_figma`, no `upload_assets`, no `get_metadata`, no `get_design_context`. Do not even check the Figma file.
- **No external HTTP.** No `curl`, no `WebFetch`, no network calls.
- **Prompt length ≤ 2,800 chars** per /banner-higgsfield v1.7's constraint. Verify after filling.
- **Verbatim copy.** HERO and CTA pass through unchanged into the visual prompt — no edits, no translations, no improvements.
- **Framework stays internal.** Never paste the Design Framework, Composition Guide, or DO-NOT-RENDER list into the prompt output. Only the filled Visual Prompt Template appears in the fenced copy-block.
- **Silent designer for reasoning.** The 9-decision checklist work happens internally. The user sees the named "Approach" line, the prompt, and the 5 alternatives — not the brief.
- **No autonomous commits** per CLAUDE.md.

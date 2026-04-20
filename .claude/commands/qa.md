---
description: QA a localized Figma landing page — checks content parity, language, placeholders, images, overflow, CTAs, and conversion-focused tone
---

# /qa — Figma landing-page QA

The teammate is asking Claude to QA a localized landing page inside Figma. Given a Figma URL and a target-language code, run seven checks on the local-language version and post one Figma comment per issue, pinned to the offending node.

## Input parsing

Arguments: `$ARGUMENTS`

Expected format: `<figma-url> <language-code>`

- `<figma-url>` — any valid Figma file URL; parse out the file key yourself.
- `<language-code>` — ISO-639-1 code of the target local language (`es`, `pt`, `fr`, `de`, etc.). English is always assumed to be the reference language.

If either argument is missing, stop and tell the teammate the expected usage — do not guess.

## Brand detection (optional)

Once the file is loaded, try to match the Figma file's name or top-level page name against folder names in `projects/`. If there's a hit:
- Load `projects/<brand>/qa-config.json` if it exists.
- Use its `brand_name_allowlist`, `loanword_allowlist`, `target_voice`, and `device_widths` overrides where present.

If no match or no config: continue with built-in defaults (see "Defaults" at the bottom). Mention in the final chat summary which brand was detected (or that defaults were used).

## Procedure

### 1. Load the file
Use the Figma MCP (`get_metadata`, `get_design_context`, or equivalent read endpoints) to fetch:
- All top-level frames on the page
- Their bounding boxes, widths, and heights
- All text nodes with their content, parent frame, and bounding box
- All image fills and whether they resolve to a source
- Button/CTA nodes (components named like "Button", "CTA", or resolved by text + clickable shape heuristics)

### 2. Identify target-language frames
For each top-level frame, sample its text nodes and classify the dominant language. Keep frames whose dominant language is the target code; treat the rest as EN reference frames and ignore them.

If zero frames match the target language, **stop** and report: "No frames found in `<lang>`. Is the language code correct?"

### 3. Classify each LA frame as Desktop / Tablet / Mobile
Default widths (overridable via qa-config.json):
- Desktop: frame width ≥ 1200
- Tablet: 600 ≤ width < 1200
- Mobile: width < 600

If any device is missing, **stop** and report which. If two frames fall in the same bucket, **stop** and ask the teammate to override widths via qa-config.json — do not guess.

### 4. Extract ordered content per device
For each LA device frame, walk the node tree top-to-bottom (by Y coordinate), producing an ordered list of items:
```
{ type: "text" | "image" | "cta", content: <string or asset ref>, bbox, nodeId }
```
Skip decorative elements (pure shape fills with no content).

### 5. Run the seven checks

#### 5.1 Cross-device parity
Diff the three content lists. Match items by normalized text content (trim + lowercase + collapse whitespace), not by Figma layer names. Flag:
- Content items present on one or two devices but missing on the third.
- Items with the same logical role but different text across devices.
- Items in a different relative order across devices (a CTA that's above the hero on Mobile but below it on Desktop, for example).

#### 5.2 Wrong language
For each text node in the LA frames, judge whether the text is actually in the target language. Flag:
- Full English sentences left over.
- Mixed-language phrases (e.g. "Download our app" with one local loanword) — flag by default.
- Skip items in the brand's `loanword_allowlist` and `brand_name_allowlist` from qa-config.json.

#### 5.3 Placeholder text
Flag any text matching: lorem ipsum, "placeholder", "TBD", "TODO", "XXX", or unusually repeated filler strings.

#### 5.4 Broken images
Flag image fills that are empty, unresolved, or missing a source. Include the node ID and device in the report.

#### 5.5 Overflow
Flag text nodes whose rendered bounding box exceeds their parent container, or any node clipped by its parent. Only flag real overflow — not decorative bleeds that are clearly intentional.

#### 5.6 CTA issues
For each CTA node:
- Dummy/placeholder text labels ("Button", "CTA", "Click here", "Submit")
- Labels still in English on the LA version (covered partly by 5.2, but flag specifically as a CTA issue for severity)
- Labels that differ across Desktop/Tablet/Mobile
- Buttons in a visibly different position (relative to the section they're in) across devices

#### 5.7 Conversion-focused tone
For each major copy block (headlines, subheads, body paragraphs, CTAs), evaluate against this default voice — or the brand's `target_voice` if set in qa-config.json:

> **Default voice:** Confident, specific, benefit-led, action-driving. Retail-friendly but authoritative. Every headline earns its space.

Flag any block that is:
- Vague or generic (no specific benefit or number)
- Hedged or weak ("might help", "could potentially", "try to")
- Filler / padding (words that add no meaning)
- Tonally off for financial trading (overly casual, meme-y, or hype)
- Inconsistent in tone with the rest of the page

For each flagged block, produce:
- **What's weak** (one line)
- **Why it hurts conversion** (one line)
- **Suggested rewrite** (one tighter alternative)

Also surface regulator-unfriendly language as **warnings** (not errors): "guaranteed returns", "risk-free", "can't lose", "100% accuracy", etc.

### 6. Post findings to Figma

For each issue, create a Figma comment **pinned to the offending node** using the Figma MCP's write-capable comment endpoint (try `use_figma` if no dedicated tool exists; most Figma MCP installs expose `POST /v1/files/:key/comments` with a `client_meta` node anchor).

Comment body format:
```
[QA · <check-name> · <severity>]
<one-line description of the issue>

Suggested rewrite:  (only for tone issues)
<rewrite>
```

Severity: `error` (parity mismatch, missing device, broken image, placeholder, wrong language, weak conversion copy) or `warning` (regulator-unfriendly phrasing, minor tone inconsistency, overflow in a decorative context).

**Fallback** — if the Figma MCP cannot create comments in this project, save the full report to `projects/<brand>/qa-reports/<YYYY-MM-DD-HHmm>-<file-key>.md` (create folders as needed) and tell the teammate where it landed. Do not silently skip.

### 7. Summarize in chat
After posting, print a single-line summary:
```
/qa done — <N> issues (<errors> errors, <warnings> warnings) · <comments-posted> Figma comments posted · brand: <detected-or-default>
```

Followed by a grouped breakdown: issues-per-device, issues-per-check-category.

## Defaults (when no qa-config.json is present)

```json
{
  "target_voice": "Confident, specific, benefit-led, action-driving. Retail-friendly but authoritative. Every headline earns its space.",
  "brand_name_allowlist": [],
  "loanword_allowlist": [],
  "device_widths": {
    "desktop_min": 1200,
    "tablet_min": 600
  }
}
```

## Non-goals for this version

- Does not compare LA content against the EN reference (EN is for humans).
- Does not auto-fix anything in Figma — every change goes through a human.
- Does not block `/push`; `/qa` is run on demand.
- Does not generate more than one suggested rewrite per tone issue.
- Does not evaluate visual hierarchy, color contrast, accessibility, or responsive breakpoints beyond the three device frames.

## If something goes wrong

- Figma file not reachable → stop, ask the teammate to check the link + their Figma auth.
- Figma MCP not connected → stop, link them to the MCP setup docs.
- Ambiguous device classification → stop, ask for qa-config.json override.
- Language detection uncertain on a given node → err on the side of flagging (human reviewer decides).

Never silently skip a check. If a check cannot run, say so in the chat summary.

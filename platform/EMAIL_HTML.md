# CRM Email Builder — HTML rules, deliverability, and architecture

Reference for the Email Builder tool. Email HTML is **not** web HTML: the dominant
rendering engines are 20+ years old, and the rules below are what keeps a campaign
rendering everywhere and landing in the inbox rather than the spam folder.

Written against the LP Builder architecture (`platform/backend/app/lp_builder/`), which
this tool mirrors — but see [What does not transfer](#5-what-does-not-transfer-from-the-lp-builder).

---

## 1. The client landscape (what we are actually targeting)

Roughly, by global open share:

| Client | Share | Engine | The constraint it imposes |
|---|---|---|---|
| Apple Mail (iOS + macOS) | ~50–55% | WebKit | Modern; the easy one. Auto-scales text under 13px. |
| Gmail (web + app) | ~28–30% | Blink, heavily sanitised | Strips `<head>`, strips `<link>`, **clips at ~102KB**. |
| Outlook **Windows desktop** | ~4–6% | **Microsoft Word** | No flexbox, no grid, no `border-radius`, no `background-image` without VML, no CSS vars. |
| Outlook.com / Outlook mobile | ~4% | Blink-ish | Better, but rewrites CSS classes. |
| Yahoo / AOL / Samsung / others | ~8% | Mixed | Mostly forgiving; Samsung Mail ignores `<style>` in places. |

**The rule this produces:** design to Outlook-Windows and Gmail. Everything else is
downstream of those two. A layout that survives Word's engine survives everywhere.

---

## 2. Document rules

### 2.1 Skeleton

- **Doctype:** XHTML 1.0 Transitional. Word's engine behaves most predictably with it.
- **Layout:** nested `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`.
  Never `<div>`+flex/grid for structure. `role="presentation"` keeps screen readers
  from announcing layout tables as data tables.
- **Width:** one fixed outer table at **600px** (safe everywhere; 640px is the modern
  ceiling but gains nothing). Mobile collapses to 100%.
- **Padding lives on `<td>`**, not on `<div>` or via `margin` — Word drops most margins.
- Required `<head>` bits:
  - `<meta charset="utf-8">` — mandatory for our Arabic/Thai/Japanese/Chinese copy.
  - `<meta name="viewport" content="width=device-width,initial-scale=1">`
  - `<meta name="x-apple-disable-message-reformatting">` — stops iOS auto-resizing.
  - `<meta name="color-scheme" content="light dark">` + `supported-color-schemes`.
  - `<html lang="…" dir="…">` — `dir="rtl"` for Arabic. We ship Arabic, so this matters.

### 2.2 CSS

**Inline every style as a `style=""` attribute.** Gmail strips `<link>` entirely and
sanitises `<head>`; assume a `<style>` block may not survive. Use a `<style>` block
**only** for what cannot be inlined — media queries, `:hover`, dark-mode overrides —
and treat all of it as progressive enhancement that may be discarded.

| Safe | Avoid entirely |
|---|---|
| `color`, `background-color` | `position`, `float`, `flex`, `grid` |
| `font-family/size/weight/style` | CSS custom properties (`var(--x)`) |
| `line-height` (**use px**, not unitless — Word mis-scales unitless) | `box-shadow`, `text-shadow` |
| `padding` on `<td>` | `object-fit`, `aspect-ratio`, `color-mix()` |
| `text-align`, `vertical-align` | `border-radius` (Outlook squares it — acceptable degradation, never load-bearing) |
| `border`, `width`, `height` | `@import`, external stylesheets |
| `display:block` on `<img>` | `transition`, `animation`, `transform` |

**Colour must be literal hex at compose time.** The LP Builder's `--lp-*` custom
properties are exactly what Outlook cannot read — tokens have to be resolved into
the markup, not referenced from it.

### 2.3 Images

- **Absolute `https://` URLs only.** Relative paths and `cid:` are not options for us.
- **Always set `alt`**, plus `width`/`height` **attributes** (not only CSS). Outlook
  blocks images by default — the alt text *is* the email for those readers.
- `display:block` and `border:0` on every `<img>` to kill gaps and link borders.
- Retina: export at 2× and constrain with the `width` attribute.
- **No SVG.** Not supported in Outlook, Gmail, or Yahoo. Logos must be PNG.
- Background images need a VML fallback for Outlook, or a solid `bgcolor` behind them.
  Prefer a solid colour and a foreground `<img>`.

### 2.4 Size budget — the one nobody remembers

**Gmail clips the message past ~102KB** of HTML and hides the rest behind
"View entire message". Anything below the clip — including the **unsubscribe link** —
effectively disappears, which drives spam complaints and hurts sender reputation.

Keep composed HTML under **~100KB**. This is why inlining a 12KB logo as a data URI
(what the LP Builder does) is wrong here: it would burn a tenth of the budget on one
image, and most clients reject `data:` images anyway.

### 2.5 Typography

- Web-safe stacks with a real fallback: `Arial, Helvetica, sans-serif` /
  `Georgia, 'Times New Roman', serif`. Webfonts render in Apple Mail and not much else,
  so brand fonts must degrade gracefully — never rely on them for legibility.
- Body **≥14px** (16px preferred), headline **≥22px** on mobile.
- iOS auto-enlarges text under 13px; do not go below it.

---

## 3. Deliverability — not getting blocked

Rendering and inboxing are different problems. Most blocking is decided before the
HTML is ever parsed.

### 3.1 Authentication (infrastructure, not this tool)

**SPF, DKIM, and DMARC must all pass** on the sending domain. Since Feb 2024, Google
and Yahoo *require* them for bulk senders, plus one-click unsubscribe and a spam-complaint
rate under 0.3%. No amount of clean HTML compensates for failing these. This lives with
whoever owns the sending domain and the ESP — flag it, do not assume it is done.

### 3.2 What the HTML itself must do

- **Visible unsubscribe link** in the footer, plus a `List-Unsubscribe` header set by
  the ESP. Legally required (CAN-SPAM, GDPR/ePrivacy) and a direct ranking signal.
- **Physical postal address** of the sender in the footer — CAN-SPAM requires it.
- **Meaningful text-to-image ratio.** An image-only email is a classic spam signature.
  Headline, body, and CTA should be live text, not baked into the hero.
- **Plain-text alternative** (`multipart/alternative`). Missing it raises spam score.
- **No `<script>`, `<form>`, `<iframe>`, `<object>`, `<embed>`.** Stripped at best,
  flagged at worst. The LP Builder's sanitiser already bans these — reuse it.
- **Link text must match its destination.** Mismatched anchor text, URL shorteners, and
  raw IP links all score badly.
- **Valid, balanced markup.** Malformed HTML raises spam score on its own.
- Avoid the obvious triggers: ALL-CAPS subjects, `!!!`, "FREE", "GUARANTEED", "RISK-FREE".
  Note the financial-services tension below.

### 3.3 Financial services — our specific exposure

Broker and prop-firm mail is scrutinised harder than most, and the copy vocabulary
("profit", "returns", "free", "guaranteed") overlaps heavily with spam heuristics.

- **Risk warnings are mandatory** for EU-regulated entities (ESMA/CySEC), including the
  CFD loss-percentage disclosure. The registry already carries `regulation`
  (`eu` | `international`) per entity — the footer disclaimer should be **derived from
  that field**, not typed per campaign. That is the single highest-value tie-in between
  the entity model and this tool.
- Never imply guaranteed returns. This is both a compliance and a deliverability problem.
- Keep the regulated entity name and licence number in the footer.

---

## 4. Accessibility

- `role="presentation"` on every layout table.
- `lang` and `dir` on `<html>`.
- Real `<h1>`/`<h2>` for headings where the layout allows.
- Contrast ≥4.5:1 — check brand palettes, several of ours are low-contrast on white.
- Alt text on every image; `alt=""` on purely decorative ones.
- Dark mode: `color-scheme` meta, and avoid pure-black text on transparent PNGs
  (they invert to black-on-black in some clients). Logos need a light-background plate
  or a dark-mode variant — the registry already has `logo_svg_dark`.

---

## 5. What does not transfer from the LP Builder

Verified against the current code:

| LP mechanism | Why it breaks in email |
|---|---|
| `--lp-*` CSS variables (`export.tokens_css`) | Unsupported in Outlook. Resolve to literal hex at compose. |
| External `styles.css` / `<style>` block | Gmail strips `<link>`; `<style>` unreliable. Inline instead. |
| Flexbox and grid (every section's CSS) | Word engine. Tables only. |
| 3 breakpoints (`base`/`tablet`/`mobile`) | Email is 2 states: 600px desktop, ≤480px mobile. |
| `<picture>` + `srcset` art direction | Unsupported. Use two `<img>` with show/hide, or one image. |
| `@import` Google Fonts | Stripped. Web-safe stack with graceful degradation. |
| `script.js` (accordion, form fetch) | JS never runs in email. |
| `data-lp-form` submit wiring | No forms. CTA links to a landing page instead. |
| `border-radius`, `box-shadow`, `object-fit`, `color-mix()` | Unsupported/partial. Needs an email-specific prop whitelist. |
| SVG logo tokens (`brand_logo_tokens`) | SVG unsupported. Must be a hosted PNG. |
| Relative `assets/<hash>.png` in the ZIP | Must be absolute https URLs. |

### Transfers cleanly

The `data-*` slot DSL and `parse_fields` · `validate_section_html` sanitiser ·
per-language `texts` dicts with `en` fallback · repeat expansion · `_esc`/`_attr`/`_safe_url` ·
the layer-naming system · `core.py`'s lock/persist/rehydrate idiom · the Project/Instance
split · brand scoping by `category` · `_llm_json` + strict JSON schema · the
validate-then-fall-back-per-field pattern from `_validate_director`.

---

## 6. Two blockers to resolve before building

Both are verified against the current deployment, not hypothetical.

**1. Images are behind authentication.** Every `/api/tools/lp-builder/*` route is mounted
with `dependencies=[Depends(require_user)]` (`main.py:126,138`). A recipient opening the
email has no session, so every image would 401. Email images must be served from a
**public, unauthenticated, unguessable** URL. Options: a public route scoped to email
assets, or an external bucket/CDN.

**2. Brand logos are SVG and cannot be rasterised.** The registry stores `logo_svg`,
`logo_wide`, `icon_svg` as SVG markup; email cannot render any of it. No rasteriser is
installed in the backend venv — `cairosvg`, `svglib`, `wand` are all absent (this is also
why banner logo overlay silently skips SVGs, `runner.py:522-528`). Either add a rasteriser
dependency, or add a PNG logo upload per entity.

---

## 7. Testing matrix

Minimum before any campaign ships:

| Must test | Why |
|---|---|
| Outlook 2016/2019 Windows | The strictest engine; if it passes, most things pass. |
| Gmail web + Gmail app (Android) | Largest share after Apple; different sanitisers. |
| Apple Mail iOS (light **and** dark) | Largest single share; dark mode breaks logos. |
| Outlook.com | Rewrites CSS classes. |
| Images-off in Outlook | Proves the alt-text layer. |
| An Arabic (RTL) send | Proves `dir` handling end to end. |
| Total HTML size | Must stay under ~100KB (Gmail clip). |

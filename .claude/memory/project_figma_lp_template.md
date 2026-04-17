---
name: BrainTrade LP Template — Figma setup
description: Figma file key, page name, frame structure, and workflow for rewriting the LP template for new marketing campaigns
type: project
---
The BrainTrade landing page template lives in Figma and is ready for mass reproduction.

**Why:** Template was built so the same LP structure can be reused for different marketing angles by swapping copy and images only.

**How to apply:** When the user says "rewrite the content" or "create a new version" of the landing page, use the Figma MCP tool to navigate to the template page, find the labeled text nodes (✏️), and update them. Do NOT redesign — only change copy and images.

---

## Figma file

- **File key:** `5t066Ac9yDEqdJ7fvN05Pv`
- **File URL:** https://www.figma.com/design/5t066Ac9yDEqdJ7fvN05Pv/BrainTrade-LP-Template
- **Template page:** `🔲 LP Template`
- **Frames (side by side on the same page):**

| Frame name | Width | Breakpoint | x position |
|---|---|---|---|
| `Landing Page — Template` | 1280px | Desktop | 0 |
| `Landing Page — Tablet (1024px)` | 1024px | Tablet | 1400 |
| `Landing Page — Mobile (375px)` | 375px | Mobile | 2544 |

---

## Workflow to rewrite content for a new campaign

1. **Duplicate the template page** in Figma (right-click tab → Duplicate), rename it with campaign name
2. **Navigate to the new page** using `use_figma` with `figma.setCurrentPageAsync()`
3. **All 3 breakpoints share identical layer naming** — update once conceptually, apply to all 3 frames
4. **Find text nodes** — all editable text nodes are prefixed `✏️` in the Layers panel
5. **Find image nodes** — all replaceable images are prefixed `🖼️`
6. **Update text** using `use_figma` JS: find node by name, call `figma.loadFontAsync()`, then set `node.characters = "new copy"`
7. **Content schema** is saved at `content.json` in the repo root — edit this JSON and use it as the source of truth for new campaigns

---

## Section map (layer names → what to edit)

| Layer | Editable fields |
|---|---|
| `01 — HEADER` | `🖼️ logo/image` |
| `02 — HERO` | `✏️ form/title`, `✏️ cta/button-text`, `✏️ trust-signals`, `🖼️ hero/creative-image` |
| `03 — 3 STEPS` | `✏️ section-title`, `✏️ step-1/title`, `✏️ step-1/description` … x3 |
| `04 — CONTENT BLOCK (image+text)` | `✏️ content/title`, `✏️ content/body`, `🖼️ content/image` |
| `05 — CONTENT BLOCK (full-width)` | `✏️ content/title`, `✏️ content/body` |
| `06 — CONTENT BLOCK (2 columns)` | `✏️ content/title`, `✏️ content/col-left`, `✏️ content/col-right` |
| `07 — CARDS GRID` | `✏️ section-title`, `✏️ card-N/title`, `✏️ card-N/description`, `🖼️ card-N/image` (N=1–4) |
| `08 — CTA BUTTON` | `✏️ cta/button-text` |
| `09 — JOURNEY` | `✏️ section-title`, `✏️ month-1/label`, `✏️ month-1/title`, `✏️ month-1/description`, same for month-2, `🖼️ month-2/background-image` |
| `10 — BENEFITS` | `✏️ section-title`, `✏️ benefit-N/title`, `✏️ benefit-N/description`, `🖼️ benefit-N/icon` (N=1–6) |
| `11 — PERSONAL COACHING` | `✏️ title`, `✏️ subtitle`, `✏️ body`, `✏️ cta/button-text`, `🖼️ coaching/photo` |
| `12 — LEARN & PRACTICE` | `✏️ title`, `✏️ subtitle`, `✏️ body`, `✏️ bullet-1` … `✏️ bullet-5`, `🖼️ learn/platform-screenshot` |
| `13 — SWITCH TO TRADER MODE` | `✏️ title`, `✏️ subtitle`, `✏️ body`, `🖼️ switch/platform-screenshot` |
| `14 — FAQ` | `✏️ section-title`, `✏️ section-subtitle`, `✏️ faq-N/question`, `✏️ faq-N/answer` (N=1–6), `🖼️ faq/decorative-photo` |
| `15 — TESTIMONIALS` | `✏️ section-title`, `✏️ section-subtitle`, `✏️ testimonial-N/name`, `✏️ testimonial-N/role`, `✏️ testimonial-N/quote`, `🖼️ testimonial-N/photo` (N=1–2) |
| `16 — FOOTER` | `✏️ footer/link-privacy`, `✏️ footer/link-contact`, `✏️ footer/link-terms`, `✏️ footer/legal-text`, `✏️ footer/copyright` |

---

## Figma JS snippet to update a text node

```js
// Standard pattern for editing any ✏️ text node
await figma.loadFontAsync({ family: "Urbanist", style: "Medium" }); // match original weight
const page = figma.root.children.find(p => p.name === "🔲 LP Template — Campaign Name");
await figma.setCurrentPageAsync(page);

function findNodeByName(root, name) {
  if (root.name === name) return root;
  if ('children' in root) {
    for (const c of root.children) { const f = findNodeByName(c, name); if (f) return f; }
  }
  return null;
}

const frame = page.children.find(n => n.name === "Landing Page — Template");
const node = findNodeByName(frame, "✏️ form/title");
node.characters = "Your new headline here";
```

---

## Design tokens (do not change these unless rebranding)

| Token | Value |
|---|---|
| Navy (headings) | `#070851` |
| Orange (CTAs, accents) | `#FF7532` |
| Background | `#FBFBFB` |
| Body text | `#707070` |
| Card border | `#DDE1E6` |
| Font | Urbanist (Regular 400, Medium 500, SemiBold 600, Bold 700) |

# Development prompt — LP Builder (drag-and-drop landing-page builder)

Build the **LP Builder** — the main tool of the "LP Builder" product in Internovus -
Creative Builder. It is a Webflow-lite, section-based drag-and-drop builder for
marketing landing pages: admins author brand templates (sections with
multi-language text and pre-attached materials), users assemble and edit an LP on
a live canvas with three device views, and the result exports as a ready-to-host
static website (HTML + CSS + assets + a tiny vanilla JS file).

Backend: `platform/backend` (FastAPI). Frontend: `platform/frontend` (React +
Vite + Tailwind + shadcn). Follow every existing platform convention: artifact
persistence on `ARTIFACT_ROOT` with in-memory cache + rehydrate on startup,
shared team visibility with owner/admin-only destructive actions, auto-save,
`?app=lp&tool=builder` routing, the premium animation language (fade-up /
scale-in / slide-up), and the release protocol (land on `main`, bump MINOR →
v1.54.0, verify live before pushing, then ff-merge `prod`).

## Locked product decisions (do not re-litigate)

1. **Templates** = a professional BUILT-IN section library shipped in code + an
   in-app ADMIN editor to clone/edit sections and save brand templates.
2. **Drag model**: whole SECTIONS stacked vertically — drag from the library
   into the page, drag to reorder. Elements inside a section are click-to-edit,
   not free-positioned. No absolute positioning anywhere.
3. **Languages**: ONE language per LP project. Templates carry per-language
   default texts (admin-authored). The user picks the language when creating
   the LP (campaign market pre-selects it); every text stays editable. The
   Thai version of an LP = "Duplicate to language…".
4. **Export**: ZIP with `index.html` + `styles.css` + `script.js` + `assets/`.
   The signup form posts to a **form action URL** set in the form's properties.
5. **Campaign link**: an LP can attach one LP Materials campaign — its hero,
   customer avatars, section cards and advertorial images appear in the asset
   panel; the campaign market pre-selects the LP language.
6. **Exported JS**: one small dependency-free `script.js` (FAQ accordion,
   mobile menu, form validation + submit, smooth scroll). Works offline.
7. **Breakpoints**: per-device property overrides like Figma/Webflow. Desktop
   (1920) is the base; while viewing tablet (1199) or mobile (375) the user can
   override visibility, font size, spacing, alignment and images for that
   breakpoint. Overridden props show a badge + "reset to base".
8. **Branding**: templates are built on DESIGN TOKENS (`--lp-primary`,
   `--lp-accent`, `--lp-bg`, `--lp-text`, `--lp-font`, logo slot). An LP picks
   a brand from the existing brands store (e.g. BrainTrade) and the whole page
   re-themes; any individual property can still be overridden.
9. **Text editing**: double-click on the canvas edits text INLINE; the
   properties panel simultaneously exposes the styling.
10. **v1 section set**: the finance-LP standard set (12 sections, below).
11. **Projects**: shared team dashboard (creator + date on cards, everyone
    sees everything, owner/admin edits/deletes), auto-save while editing.

## Architecture

### Template model — annotated HTML, not a custom DSL

A section is REAL HTML + CSS written by us/admins, annotated with data
attributes the builder understands. This keeps sections previewable anywhere
and keeps the export byte-faithful to the canvas.

- `data-lp-text="key"` — inline-editable single-line text node
- `data-lp-rich="key"` — multi-line text (paragraphs)
- `data-lp-img="key"` — image slot (`<img>` or a `background-image` holder)
- `data-lp-link="key"` — href target (buttons/links)
- `data-lp-repeat="key"` — a repeatable ITEM node (FAQ item, review card,
  benefit card, step). Users add/remove/reorder items in the properties panel
  (min 1, max 12); each clone's inner fields become `key.N.field`.
- `data-lp-form` — marks the form element whose `action` is wired at export
- Section CSS uses the brand tokens (`var(--lp-primary)` …) and standard
  breakpoints: base = desktop, `@media (max-width: 1199px)` = tablet,
  `@media (max-width: 575px)` = mobile. Canvas previews at 1920 / 1199 / 375.
- CSS is namespaced per section key (`.lp-sec-hero-form …`) so sections never
  collide; the builder additionally scopes instance overrides by
  `[data-iid="…"]`.

Section template record (built-ins seeded in Python; admin edits persisted to
`ARTIFACT_ROOT/lp-builder/sections/` using the sizes_config pattern —
in-memory cache, best-effort disk flush, built-ins never deletable, only
overridable/disable-able):

```json
{
  "key": "hero-form", "name": "Hero with form", "category": "hero",
  "html": "<section class=\"lp-sec-hero-form\">…</section>",
  "css": ".lp-sec-hero-form { … } @media (max-width:1199px) { … }",
  "texts": {"en": {"headline": "…", "cta": "…"}, "ms": {…}},
  "assets": {"hero": "lpa_xxx"},
  "position": 10, "enabled": true, "built_in": true,
  "updated_by": "…", "updated_at": "…"
}
```

Fields are DERIVED by parsing the HTML for `data-lp-*` (backend does the
parse; expose the field list in the API so both the admin editor and the
builder use one source of truth).

### LP project model

Persisted at `ARTIFACT_ROOT/lp-builder/projects/{id}.json` (+ uploaded assets
under `ARTIFACT_ROOT/lp-builder/assets/`), rehydrated on startup:

```json
{
  "id": "lp_x", "name": "BrainTrade MY — July", "brand_id": "braintrade",
  "language": "ms", "campaign_id": "cp_x|null",
  "sections": [
    {"iid": "s1", "template_key": "hero-form",
     "texts": {"headline": "…"},
     "images": {"hero": "lpa_x"},
     "links": {"cta": "#signup"},
     "repeats": {"faq": 5},
     "props": {
       "headline": {"base": {"fontSize": "56px", "color": "#fff"},
                     "tablet": {}, "mobile": {"fontSize": "32px"}},
       "_section": {"base": {"bg": "#0A1A3A", "padY": "96px"},
                     "mobile": {"hidden": false}}
     }}
  ],
  "tokens": {"primary": "#FF7532"},
  "form": {"action_url": "", "success_url": ""},
  "fonts": "bundled | google",
  "created_by": "…", "created_at": "…", "updated_at": "…"
}
```

`props` keys are element field keys plus `_section`; buckets are `base` /
`tablet` / `mobile`. Only a curated whitelist of props per element type —
this is Figma-LIKE, not raw CSS: text (fontSize, fontWeight, color, align,
lineHeight, letterSpacing, transform, marginTop/Bottom), image (fit, radius,
height, alt), button (bg, color, radius, size), section (bg color / bg image +
overlay, padY, maxWidth, gap, hidden).

### Canvas = iframe with the real page

- The center canvas is an `<iframe srcdoc>` rendering the COMPOSED page: all
  section HTML instances + section CSS + token CSS + a generated
  `<style id="lp-overrides">` block (instance-scoped selectors, media queries
  for tablet/mobile buckets) + an EDITOR RUNTIME script (builder-only).
- Editor runtime (vanilla, injected only in the builder): hover outlines,
  click → postMessage selection to parent, double-click → contentEditable on
  `data-lp-text/rich` (input → postMessage the new text), drop-position
  indicator while dragging sections, Esc to deselect. All state lives in
  React; the iframe re-renders from state (debounced, preserving scroll).
- Viewport toggle: iframe width 1920 / 1199 / 375, CSS-transform scaled to
  fit the workspace (Figma-style zoom; show the zoom %). Selection overlays
  must account for the scale.
- Preview mode: same iframe without runtime/outlines — exactly the export.

### Builder page layout

- **Top bar**: back to dashboard · editable LP name · brand switcher
  (re-themes tokens live) · language badge · campaign chip (attach/detach) ·
  device toggle (Monitor/Tablet/Smartphone icons, 1920/1199/375) · undo/redo ·
  auto-save status ("Saved · 12:04") · Preview toggle · **Export ZIP** button.
- **Left panel**, two tabs:
  - *Add*: the section library grouped by category (Hero, Content, Social
    proof, Conversion, Legal), thumbnail + name per section, drag onto the
    canvas (insertion line between sections) or click ＋ to append.
  - *Structure*: ordered list of the page's sections — drag to reorder,
    duplicate, delete (confirm), per-device eye toggle, click to select.
  - *Assets* tab appears when a campaign is attached OR uploads exist:
    campaign hero / avatars / cards / advertorial images + "Upload image";
    drag onto any image slot or use as section background.
- **Right panel**: Figma-style properties for the selection with breadcrumb
  (`Section / Element`): grouped controls per the whitelist above, device
  chip showing which breakpoint is being edited, override badges + reset.
  Nothing selected → page settings (name, brand, language, tokens override,
  form action URL, success URL, fonts strategy, meta title/description).
- **Undo/redo**: snapshot the project JSON per mutation (coalesce typing),
  Ctrl+Z / Ctrl+Shift+Z, cap 50 steps, session-local.
- **Auto-save**: debounced ~1.5s PUT; optimistic UI, "Saving…/Saved" status;
  never lose keystrokes on response races (same guard as sizes manager).

### Dashboard (tool home)

Same design language as LP Materials: stats tiles (projects, exported,
languages in use), search + brand filter + sort, "New landing page" as the
blue-dark popup modal (name + brand + language + optional campaign), grid of
project cards (page thumbnail placeholder or first-section snapshot, name,
brand chip, language, creator, updated date; open on click; ⋯ menu: duplicate,
duplicate to language…, export, delete owner/admin-only).

### Admin template manager (admin-only tab inside LP Builder, like Sizes settings)

- Section list grouped by category: position (drag), enabled toggle, built-in
  badge, "Edit" / "Clone".
- Section editor: split view — HTML editor + CSS editor (plain textareas with
  mono font are fine) + live preview iframe with the 3-device toggle; a
  DETECTED FIELDS panel (parsed `data-lp-*` list, warns on duplicates/unknown
  attrs); per-language default texts (language tabs + "add language", flags
  missing keys per language); attached materials manager (upload images bound
  to `data-lp-img` defaults); category + name + position; Save (validation:
  HTML parses, no `<script>`, CSS compiles trivially — reject on failure).
- Languages manager: global language list (code + label), add/remove
  (removal blocked while any template/project uses it).
- Sanitization: strip `<script>`, `on*=` handlers and `javascript:` URLs from
  section HTML on save — sections are style + structure only; behavior comes
  exclusively from the fixed export runtime.

### Export

`GET /api/tools/lp-builder/projects/{id}/export.zip` composes and streams:

- `index.html` — doctype, `<html lang>`, meta viewport + title/description,
  composed sections in order (data-lp-* attributes STRIPPED, editor runtime
  absent), form `action` set from project.form, honest `<!-- generated by
  Internovus Creative Builder -->` stamp.
- `styles.css` — token block (`:root { --lp-primary: … }`), used sections'
  CSS only, override block, all media queries intact.
- `script.js` — only the behaviors actually used on the page (accordion,
  mobile menu, form validation + fetch POST to action URL with success/error
  states + optional redirect to success_url, smooth scroll). Zero deps.
- `assets/` — every referenced image copied with content-hash filenames;
  `assets/fonts/` with bundled woff2 when fonts=bundled (Latin set: Inter +
  Space Grotesk). fonts=google emits a Google Fonts `<link>` instead (needed
  for Thai/Japanese scripts).
- Export must render pixel-identical to Preview mode. Verify by opening the
  exported index.html from disk (file://) — everything must work offline
  (except fonts=google).

### Backend API (mounted at /api/tools/lp-builder)

```
GET    /sections                     all enabled sections + fields + languages present
POST   /sections                     admin: create (clone or blank)
PUT    /sections/{key}               admin: update html/css/texts/assets/position/enabled
DELETE /sections/{key}               admin: delete custom (built-ins: disable only)
GET    /languages                    global language list
PUT    /languages                    admin
GET    /projects                     shared list, newest first
POST   /projects                     {name, brand_id, language, campaign_id?}
GET    /projects/{id}
PUT    /projects/{id}                full-document autosave (owner/admin)
POST   /projects/{id}/duplicate      {language?} — plain copy or duplicate-to-language
DELETE /projects/{id}                owner/admin
POST   /assets                       upload image -> {id, url, width, height}
GET    /assets/{id}.png              serve
GET    /projects/{id}/export.zip     the ZIP
```

Reuse `require_user` / admin checks, rate limiting, and the LP Materials
campaign store for the campaign chip (`GET /tools/lp-materials/campaigns`).

## The 12 built-in sections (finance-LP standard set)

Ship these polished — they ARE the product's first impression. Real copy
defaults in `en` (finance/trading flavored, compliant tone), professional
spacing/typography, all built on tokens, all responsive at the three widths.

1. **Hero / image** — eyebrow, headline, subheadline, CTA button, hero image
   right; trust chips row.  2. **Hero / form** — same left column, signup form
   card right (name/email/phone, consent, submit).
3. **Stats bar** — 3–4 repeatable stat items (value + label).
4. **Benefits grid** — repeatable cards (icon slot, title, text), 3-col →
   1-col on mobile.
5. **How it works** — 3–4 numbered steps, horizontal → vertical on mobile.
6. **Image + text split** — media object, image slot + rich text + CTA;
   `flip` prop for L/R.
7. **Advertorial block** — long-form rich text with inline image + pull-quote
   (pairs with LP Materials advertorial images).
8. **Testimonials** — repeatable review cards: avatar image slot, name, stars,
   quote (pairs with LP Materials customer avatars).
9. **Section cards strip** — 4 image cards with captions (pairs with LP
   Materials section cards).
10. **FAQ accordion** — repeatable Q/A items (script.js toggle).
11. **CTA banner** — big statement + button on token-primary background.
12. **Signup form + legal + footer** — standalone form section; risk
    warning/disclaimer rich block; footer (logo slot, links, copyright).

Every section needs at least `en` defaults; add `ms`, `th`, `ja`, `sv` for
the hero, form, FAQ and footer to prove the language mechanism end-to-end.

## Build order

- **Phase A — foundation**: backend stores (sections/languages/projects/
  assets) + built-in library + dashboard + create-modal; builder shell with
  iframe canvas, drag-insert/reorder from Add tab, Structure tab, selection +
  properties panel (text/image/button/section base props), inline text edit,
  device toggle, auto-save, undo/redo.
- **Phase B — depth**: per-breakpoint overrides + badges/reset, repeatable
  items add/remove/reorder, brand token switcher, language variants +
  duplicate-to-language, campaign attach + Assets tab.
- **Phase C — output**: Preview mode, export ZIP (html/css/js/assets/fonts),
  form action wiring, file:// offline verification.
- **Phase D — admin**: template manager (list, editor with live preview,
  detected fields, per-language defaults, materials, sanitization), languages
  manager, per-tool How-it-works help for Builder.

## Verification checklist (live, before release)

- Create LP from dashboard modal (brand BrainTrade, language ms, campaign
  attached) → hero drops in, drag 5 more sections, reorder, duplicate, delete.
- Double-click headline → type → canvas + panel stay in sync; undo restores.
- Device toggle: mobile shows 375 layout; override headline font size on
  mobile → badge appears; desktop unaffected; reset works.
- Brand switch re-themes all tokens live; per-element color override wins.
- Attach campaign → avatars appear in Assets; drop one into a testimonial
  card slot.
- FAQ add/remove items; form action URL set in panel.
- Export ZIP → unzip → open index.html from disk: pixel-match vs Preview at
  all three widths, accordion + form validation work offline, no data-lp-*
  attributes or editor code in the output, assets all local.
- Admin: clone hero, edit its CSS, disable a built-in → library reflects it;
  non-admin sees no admin tab. Restart backend → sections/projects rehydrate.
- Session survives tool switching mid-edit (same expectation as Banner Edit).

## Out of scope for v1 (do not build)

Multi-page sites, hosting/custom domains, A/B tests, revision history,
live multi-user co-editing, free-form positioning, template marketplace,
AI copywriting inside the builder (later: "translate this LP" via GPT),
importing arbitrary external HTML.

# Supabase migration — plan and state

Target: data in Supabase Postgres, images in Supabase Storage, Microsoft SSO
via Supabase Auth, n8n + Monday automations on top. Phased so nothing breaks
mid-flight; each phase is dormant until its secrets exist.

## Where things live

- **Project:** `CreativeOPS` (`doqmkqlxxarralnzdbix`, eu-west-2) in the
  Tiebreak Solutions org — the org's existing ops hub, chosen over a new
  project (no extra cost, and n8n + Monday flows already point here).
- **That project is SHARED.** It already carries ad-metrics pipelines, an
  `entities`/`brand_assets`/`languages`/`markets` model from another tool,
  n8n tables and its own storage buckets. Rules of the road:
  - the builder never touches existing tables;
  - builder tables land in their own Postgres schema (`builder`) in Phase 3;
  - the builder's bucket is its own (`email-assets`).
- **Convergence note for Phase 3:** the org clearly models the same concepts
  twice (their `entities`/`languages`/`markets` vs our registry). Worth a
  deliberate alignment conversation before schema work — not a silent merge.

## Phase 1 — email images → Supabase Storage  ✅ code shipped, awaiting keys

- Bucket `email-assets` created (public read, 10MB cap, png/jpeg/svg only)
  via migration `create_email_assets_bucket`.
- `app/email_builder/storage.py` uploads with the service key and returns
  the public CDN URL as the stored value. Wired at every asset seam:
  uploads, generated heroes, rasterised/SVG logos, the placeholder.
- Dual-mode: without the secrets everything stays on the Render disk exactly
  as before, and any upload failure falls back to disk — a storage hiccup
  must never cost someone their upload. Existing disk assets keep serving
  from `/e` untouched.
- Effects once live: image URLs are absolute by construction (the
  PLATFORM_PUBLIC_BASE_URL warning disappears for new assets) and recipients
  load from the CDN, not the app.

**To activate — add to Render env AND the local `.env`:**

```
SUPABASE_URL=https://doqmkqlxxarralnzdbix.supabase.co
SUPABASE_SERVICE_KEY=<service_role key from the Supabase dashboard: Settings → API>
```

The service key is secret (it bypasses row security) — env vars only, never
the frontend, never git.

- [ ] Keys added on Render
- [ ] Keys added locally
- [ ] Real upload verified end to end (upload → CDN URL in composed HTML)
- [ ] Optional: one-time copy of existing `.runs/email-builder/assets` into
      the bucket (only needed if old campaigns must survive a disk loss)

## Phase 2 — Microsoft SSO (next)

Azure App Registration (redirect: the Supabase callback URL, restricted to
the company tenant) → enable the Azure provider in Supabase Auth →
"Sign in with Microsoft" in the frontend → backend `require_user` accepts
Supabase JWTs (roles from `ADMIN_EMAILS` env until Phase 3 adds a roles
table). Password login stays behind a flag during cutover, then dies —
including the local dev fixture.

## Phase 3 — data → Postgres (`builder` schema)

Swap the persistence layer only (`_flush_json` → upsert, `rehydrate` →
select); in-memory dicts, locks and every router stay. One-time import of
the `.runs` JSON. Tables: `builder.brands`, `builder.email_campaigns`,
`builder.email_blocks`, `builder.lp_projects`, `builder.lp_sections`,
`builder.languages`, `builder.feedback` — jsonb-heavy on purpose; normalise
later if queries demand it.

## Phase 4 — n8n + Monday

Outbound: database webhooks (e.g. `email_campaigns.active` → true) → n8n →
Monday item create/update (`monday_id` already lives on every campaign and
variant). Inbound: n8n calls the FastAPI API with a service bearer token so
every guardrail stays authoritative — n8n never writes to Postgres directly.

---

# How CreativeOPS did it (read 2026-07-21) — and what we mirror

CreativeOPS (`Desktop/Creative/catalog`, deployed at creativeops.internovus.com)
is a backend-less static app on the SAME Supabase project: supabase-js in the
browser, RLS as the only security boundary, Edge Functions for privileged
work, n8n bridged by database webhooks, Monday as source of truth. Its
conventions are the house style; where we differ it is deliberate and noted.

## Auth — Phase 2 is now much smaller than planned

- **SSO is already registered.** Microsoft Entra is wired as a SAML IdP on
  this project; login is `supabase.auth.signInWithSSO({ domain: 'tiebreak.dev' })`
  — no OAuth provider, no scopes, MFA lives entirely in Entra Conditional
  Access. **No Azure App Registration work is needed for us**: we reuse the
  registration, add our origins to Supabase Auth URL configuration, and call
  the same API.
- First login auto-creates `public.users` (trigger): role `viewer`,
  `access_status='pending'`, `monday_id='sso:'||id` — admins then grant
  access/sections. **Role truth is `public.users.role`** via SECURITY-DEFINER
  `auth_role()`/`is_admin()`, never the JWT claim.
- Our twist (we have a backend, they don't): the React app gets the session
  with supabase-js — with a **distinct `storageKey`** so we never stomp
  CreativeOPS's session — and sends the Supabase JWT to FastAPI;
  `require_user` verifies it (JWKS) and maps role from `public.users`
  (env-var admin list until Phase 3 gives us DB access). Password login stays
  as break-glass behind a flag, exactly like their `SSO_ENABLED` fallback.

## Storage — our public bucket stands, one convergence noted

- House pattern: ONE private bucket, direct browser uploads under the user
  JWT, admin-gated by RLS on `storage.objects`, reads via 1-hour signed URLs
  gated by a `file_is_public()` helper.
- **Email images are the legitimate exception**: a signed 1-hour URL is
  useless inside a sent email, so `email-assets` stays public — same
  reasoning as their public `entities-icons`.
- Convergence: the project already ships a **`compress-image` Edge Function**
  (Tinify, admin-gated, overwrites in place) with `TINIFY_API_KEY` already
  set as an edge secret. Our `compress.py` duplicates this locally for now —
  it needs a user-context Supabase JWT we won't have until Phase 2, so:
  short-term, copy the same Tinify key value into Render's `TINIFY_API_KEY`;
  after Phase 2, switch Approve-compression to invoke the shared function
  and delete our copy.

## n8n + Monday — our Phase 4 design matches the house pattern

- Events OUT: Supabase **database webhooks** with Header Auth
  (`Bearer N8N_WEBHOOK_SECRET`); the app never calls n8n directly.
- n8n IN: writes with the new-format `sb_secret_…` service key sent as BOTH
  `apikey` and `Authorization`.
- Monday ids are written back by n8n into the triggering row — our
  `email_campaigns.monday_id` is already shaped for this.
- Failures dead-letter into the shared `n8n_failures` table
  (+ `resolve_n8n_failures` RPC); wiring ours there puts builder failures in
  the same admin bell.

## Schema — Phase 3 rules confirmed, plus the alignment question sharpened

- House style: idempotent standalone SQL applied via MCP/SQL editor, RLS on
  every table, `is_admin()` write policies, `security_invoker=on` views,
  `_touch_updated_at` triggers, append-only `audit_log`, soft `text`
  taxonomy references (Monday sync must never reject on an unknown name).
- **The live DB is truth; committed SQL lags it** — always introspect before
  writing.
- The duplicate-modelling question is now concrete: their `entities` is
  name-keyed with kind in (brand|whitelabel|academy) — no `prop`, no design
  tokens; it is what Monday dropdowns self-heal against. Our registry is
  slug-keyed and carries the full design system. Likely landing: builder
  keeps its rich registry in the `builder` schema and syncs name+kind into
  `public.entities` (or reads it as the canonical name list) — to be agreed
  with the CreativeOPS maintainer, not decided silently.

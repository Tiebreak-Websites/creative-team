# Supabase migration — plan and state

**Scope decision (2026-07-22): the builder KEEPS its architecture as-is** —
FastAPI backend, same generation pipelines, same login. Supabase's job is
**Storage and Database only**. A full CreativeOPS-parity rewrite (Edge
Functions, static-only frontend, Azure pipeline) was considered and reverted:
it could not guarantee identical generation behaviour (PIL banner engine,
background jobs). SSO remains a possible later phase, not in scope now.

Target: data in Supabase Postgres, images in Supabase Storage, n8n + Monday
automations on top. Phased so nothing breaks mid-flight; each phase is
dormant until its secrets exist.

## Ground rule: the builder is STANDALONE

- **Project:** `Creative Builder` (`emoznmkqtlujyvzytztm`, eu-west-2,
  $10/month — cost confirmed 2026-07-21) in the Tiebreak Solutions org.
- **CreativeOPS (`doqmkqlxxarralnzdbix`) is a reference implementation, not
  shared infrastructure.** We copy its patterns (below); we do not share its
  database, buckets, users table or edge functions. No cross-project reads or
  writes, ever.
- Cleanup note: an `email-assets` bucket was briefly created in CreativeOPS
  before this rule was set. It is empty and has been made **private**;
  Supabase blocks SQL deletion of buckets, so the CreativeOPS maintainer
  should remove it from the dashboard (Storage → email-assets → Delete).

## Phase 1 — email images → Supabase Storage  ✅ code shipped, awaiting keys

- Bucket `email-assets` in **our** project (public read, 10MB cap,
  png/jpeg/svg only). Public on purpose: email recipients have no session,
  and a signed 1-hour URL inside a sent email is useless.
- `app/email_builder/storage.py` uploads with the service key and returns
  the public CDN URL as the stored value. Wired at every asset seam:
  uploads, generated heroes, rasterised/SVG logos, the placeholder.
- Dual-mode: without the secrets everything stays on the Render disk exactly
  as before, and any upload failure falls back to disk. Existing disk assets
  keep serving from `/e` untouched.

**To activate — add to Render env AND the local `.env`:**

```
SUPABASE_URL=https://emoznmkqtlujyvzytztm.supabase.co
SUPABASE_SERVICE_KEY=<service_role key — Creative Builder project dashboard → Settings → API>
```

The service key bypasses row security — env vars only, never the frontend,
never git.

- [ ] Keys added on Render  ← the remaining step
- [x] Keys added locally (2026-07-21)
- [x] Real upload verified end to end: upload → Supabase CDN URL stored →
      publicly fetchable → composed HTML carries only absolute URLs (logos,
      placeholder, uploads) and the relative-URL warning is gone

Frontend key for Phase 2 (safe to ship in the browser):
`sb_publishable_esM5Vcf8uAYkGa2U6SsiuA_0l-jApIk`

## Phase 2 — Microsoft SSO  (IN SCOPE again per 2026-07-22 — the step plan)

Same model as CreativeOPS: Entra SAML SSO, MFA via Conditional Access, the
app holds no passwords, role truth in `public.users` — driving the already-
shipped Settings → Users panel (pending gate, roles, sections).

Already in place: `users` table + `handle_new_user` auto-provision trigger
(viewer + pending), `auth_role()`/`is_admin()`, the admin Users API/panel,
the publishable key (safe for the browser):
`sb_publishable_esM5Vcf8uAYkGa2U6SsiuA_0l-jApIk`.

**Step 1 — IT ticket (user → IT).** Forward `platform/docs/for-it-entra-sso.md`
(builder-specific: a SECOND Enterprise App named "Creative Builder", our SP
URLs on project `emoznmkqtlujyvzytztm`). IT returns the App Federation
Metadata URL and confirms the sign-in domain (assumed `tiebreak.dev`).
  ⛳ Blocker for step 2; app code (step 3) proceeds in parallel.
  ✅ Plan checkpoint CLEARED (2026-07-22): both projects share the
  Tiebreak Solutions org (Pro), and
  `GET /v1/projects/emoznmkqtlujyvzytztm/config/auth/sso/providers`
  returned `{"items":[]}` — SAML live, no providers yet, no plan gate.

**Step 2 — register the IdP on our project (user, one command).** With a
personal access token (dashboard → Account → Tokens; token is a secret —
terminal only):
```bash
curl -X POST "https://api.supabase.com/v1/projects/emoznmkqtlujyvzytztm/config/auth/sso/providers" \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "saml",
    "metadata_url": "PASTE_THE_IT_METADATA_URL_HERE",
    "domains": ["tiebreak.dev"],
    "attribute_mapping": { "keys": {
      "email":      { "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" },
      "full_name":  { "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name" },
      "first_name": { "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname" },
      "last_name":  { "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname" }
    } }
  }'
```
GET the same URL to verify the provider id + domain.

**Step 3 — app code  ✅ SHIPPED (2026-07-22), dormant behind `PLATFORM_SSO=on`.**
The exchange design: the SPA signs in with Entra through Supabase
(`signInWithSSO`), then POSTs the access token to `/api/auth/sso-login`
ONCE; the backend verifies it against Supabase's `/auth/v1/user`, ensures
the `public.users` row, and issues the builder's own cookie — every other
request runs exactly as today. For SSO sessions `require_user` re-reads
role/access/sections from the users table (10s TTL, cache-busted by admin
PATCH), so Grant access applies without re-login. Password login is refused
while SSO is on unless `PLATFORM_PASSWORD_LOGIN=break-glass`. Frontend:
`/api/auth/config`-driven login card ("Sign in with Microsoft"), pending
gate screen ("Almost in" + Check again), supabase-js under a builder-specific
storageKey. Health reports `sso`.

Verified 2026-07-22 without Entra (temp Supabase auth user + real access
token): handle_new_user provisioned viewer+pending → exchange issued the
cookie → /me 403 pending_access → gate screen rendered → SQL grant → same
cookie 200 as `user` within the TTL → campaigns API 200, admin API 403 →
"Check again" entered the app. Flag off: config sso:false, password login
200, login page unchanged. Temp user deleted (cascade cleaned the profile).

**Step 4 — first admin + lockdown (user, after first sign-in).**
```sql
update public.users set role = 'admin', access_status = 'active'
 where email = 'sergey.magditch@tiebreak.dev';
```
Then in the dashboard: Authentication → Providers → disable Email
(password + magic link) so SSO is the only door.

**Step 5 — test matrix (together).** Incognito → Microsoft → MFA → lands
pending → admin grants access in Settings → Users → role/sections apply;
unassigned user rejected by Entra; break-glass flag off in prod.

## Phase 3 — data → Postgres  ✅ SHIPPED (2026-07-22)

**Schema applied** (migration `builder_core_schema`, 2026-07-21): `users`,
`brands`, `email_campaigns`, `email_blocks`, `lp_projects`, `lp_sections`,
`languages`, `feedback`, `audit_log` — RLS on all nine. Payload-first jsonb
with typed columns where queries/webhooks need them.

**Persistence mirror live** (`app/pgdb.py`): in-memory dicts and JSON disk
writes stay EXACTLY as before; every persist is also upserted to Postgres on
a single background writer thread (ordered per record, fire-and-forget — a
database hop can never slow or fail a save). Deletes mirror the same way.
On startup each store merges Postgres with disk, newest `updated_at` wins
per record, missing rows are pushed up (the one-time `.runs` import happens
automatically and idempotently), and records restored FROM the database are
written back to disk. Without the keys: yesterday's code path, unchanged.

Verified 2026-07-22: auto-import matched disk counts exactly (7 brands,
6 campaigns, 1 LP project, 2 sections, 15 languages); create → row in
seconds; local JSON deleted + restart → record restored from Postgres and
served by the API; API delete → row gone. `/api/health` now reports
`supabase_db`.

Both local dev and the deployed server share the one project database —
per-record last-write-wins, the same trade Storage makes for images.

House style to copy from CreativeOPS: idempotent standalone SQL applied via
MCP, RLS on every table with `is_admin()` write policies and a
SECURITY-DEFINER `auth_role()` reading `users.role`,
`security_invoker = on` views, `_touch_updated_at` triggers, append-only
`audit_log`, soft `text` taxonomy references.

## Phase 4 — n8n + Monday  ✅ builder side shipped, awaiting the workflow

- **Instance:** https://courses.n8n.plexop.dev (org n8n; instance sharing is
  fine, data sharing is not — the builder gets its own workflows + secrets).
- **The builder now EMITS events** (`app/events.py`): fire-and-forget POST
  with `Authorization: Bearer <secret>` — the same header-auth contract
  CreativeOPS's webhooks use. Dormant until env exists; an automation hop
  can never slow or fail a user's save. Delivery order between events is not
  guaranteed (independent threads) — switch on `event`, not order.

Event catalog (payload: `{event, source:"creative-builder", data}`):

| event | fired when | data |
|---|---|---|
| `email.campaign.created` | new campaign (incl. via gallery) | campaign snapshot |
| `email.campaign.approved` | Approved toggled ON | campaign snapshot |
| `email.campaign.unapproved` | Approved toggled OFF | campaign snapshot |
| `email.variants.created` | language fan-out | parent_id, languages, ids |

Snapshot fields: id, name, subject, brand_id, language, parent_id,
monday_id, approved.

**To activate — in n8n create a Webhook node (POST, Header Auth) and put its
URL + secret into Render env and `.env`:**

```
N8N_WEBHOOK_URL=<the n8n webhook URL>
N8N_WEBHOOK_SECRET=<the header-auth secret>
```

First workflow to build: `email.campaign.approved` → create/update the
Monday item → write the Monday id back via
`PATCH /api/tools/email-builder/campaigns/{id}` `{"monday_id": "..."}`
(n8n authenticates with a builder service token — small auth addition when
we get there).

Verified end to end 2026-07-21 against a local receiver: all four events
delivered with correct Bearer auth through the real create → approve →
un-approve → fan-out flow.

After Phase 3 (data in Postgres), these same events can move to Supabase
database webhooks without the n8n side changing shape.

## Patterns adopted from CreativeOPS (reference only)

- SAML SSO by email domain; MFA entirely in Entra Conditional Access.
- Role model: `users.role` (viewer/user/admin) + pending-access gate;
  UI gating is cosmetic, RLS is the boundary.
- Storage: public bucket only where the artefact is genuinely public
  (their icons, our email images); everything else private + signed URLs.
- Tinify compression as the post-upload squeeze (they run it in an edge
  function; ours runs in the backend on Approve — same vendor, own key).
- Migrations: idempotent SQL via MCP; live DB is truth over committed SQL.
- n8n: webhook-in with header auth, service-key-back, external ids written
  back onto the triggering row, failures dead-lettered to a table an admin
  bell reads.

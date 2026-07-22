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

## Phase 2 — Microsoft SSO  (parked — out of scope per the 2026-07-22 decision)

Our own SAML registration against the same Entra tenant — CreativeOPS proved
the path and left playbooks: `catalog/docs/sso-azure-setup.md` (Supabase
side) and `catalog/docs/for-it-entra-sso.md` (the IT ticket). Steps:
1. IT adds a second Enterprise Application (SAML SP = this project's
   `/auth/v1/sso/saml/metadata`), assigns the team.
2. Register the provider on our project
   (`supabase sso add --type saml --domains tiebreak.dev ...`).
3. Frontend: `signInWithSSO({ domain: 'tiebreak.dev' })`, session in a
   builder-specific `storageKey`.
4. FastAPI `require_user` verifies the Supabase JWT (JWKS) alongside the
   legacy cookie; password login stays as break-glass behind a flag, then
   dies — including the local dev fixture.
5. First login auto-provisions a `users` row (mirror CreativeOPS's
   `handle_new_user` trigger: role `viewer`, `access_status='pending'`) —
   role truth lives in the table, never the JWT claim.

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

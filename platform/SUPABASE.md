# Supabase migration — plan and state

Target: data in Supabase Postgres, images in Supabase Storage, Microsoft SSO
via Supabase Auth, n8n + Monday automations on top. Phased so nothing breaks
mid-flight; each phase is dormant until its secrets exist.

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

- [ ] Keys added on Render
- [ ] Keys added locally
- [ ] Real upload verified end to end (upload → CDN URL in composed HTML)

Frontend key for Phase 2 (safe to ship in the browser):
`sb_publishable_esM5Vcf8uAYkGa2U6SsiuA_0l-jApIk`

## Phase 2 — Microsoft SSO

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

## Phase 3 — data → Postgres (our own project, plain `public` schema)

**Schema is applied** (migration `builder_core_schema`, 2026-07-21): `users`
(+ `handle_new_user` trigger priming Phase 2, `auth_role()`/`is_admin()`
helpers), `brands`, `email_campaigns`, `email_blocks`, `lp_projects`,
`lp_sections`, `languages`, `feedback`, `audit_log` — RLS enabled on all
nine with read-for-signed-in / write-per-role policies. Payload-first jsonb;
indexed columns only where queries and webhooks need them (brand_id,
parent_id, monday_id via payload later if needed).

Remaining: swap the persistence layer only (`_flush_json` → upsert, `rehydrate` →
select); in-memory dicts, locks and every router stay. One-time import of
the `.runs` JSON. Tables: `brands`, `email_campaigns`, `email_blocks`,
`lp_projects`, `lp_sections`, `languages`, `feedback` — jsonb-heavy on
purpose; normalise later if queries demand it.

House style to copy from CreativeOPS: idempotent standalone SQL applied via
MCP, RLS on every table with `is_admin()` write policies and a
SECURITY-DEFINER `auth_role()` reading `users.role`,
`security_invoker = on` views, `_touch_updated_at` triggers, append-only
`audit_log`, soft `text` taxonomy references.

## Phase 4 — n8n + Monday

Same house pattern, our own wiring: database webhooks OUT of our project
(Header Auth `Bearer <secret>`) → n8n workflows dedicated to the builder;
n8n writes back with **our** project's service key; Monday item ids land in
`email_campaigns.monday_id` / LP `monday_id`. The org's n8n instance can
host the workflows — instance sharing is fine, data sharing is not.

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

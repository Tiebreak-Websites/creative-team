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

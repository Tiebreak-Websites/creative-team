# Publish — Cloudflare Tunnel (public website) + installable web-app

This publishes the **whole Creative Tools platform** (FastAPI backend + built React
SPA) from one machine you control. A **named Cloudflare Tunnel** gives it a real
HTTPS web address reachable from anywhere; the app's **own email/password login**
protects it — so it behaves like a normal website. You (and teammates) can then
**install it as a desktop web-app** that opens in its own window. Optionally, you
can lock it down further with Cloudflare Access (Step 8).

```
Browser ──HTTPS──► Cloudflare edge ──► Tunnel ──► cloudflared ──► 127.0.0.1:8000
  tools.<your-domain>                                (your machine)  FastAPI: /api/* + SPA
                                                                      ▲ app login gates access
```

Why one origin: the backend serves the built SPA itself (`app/main._mount_frontend`),
so a single ingress rule covers the API and the UI, the session cookie is
first-party, and there is no CORS to configure.

> **The backend cannot run on Cloudflare itself** — it has long-running OpenAI
> jobs, thread pools, and on-disk run artifacts. Cloudflare only fronts it, so the
> machine running the backend must stay on while the app is in use.

---

## Prerequisites

- A machine that stays on (your workstation or a small VM) with **Python 3** and
  **Node 18+**.
- A **Cloudflare account** (free is fine) and a **domain you own**. The hostname and
  the tunnel route need a domain that lives in a Cloudflare zone — quick
  `*.trycloudflare.com` tunnels are ephemeral (a new random URL each run), so they
  don't work for a stable site.

Throughout, replace `tools.<your-domain>` with the hostname you'll publish, e.g.
`tools.tiebreak.solutions`.

---

## Step 1 — Put your domain in Cloudflare (one-time)

1. Cloudflare dashboard → **Add a site** → enter your domain → pick the **Free** plan.
2. Cloudflare shows two **nameservers**. At your registrar, replace the domain's
   nameservers with those two. (Don't want to move the whole domain? Register a
   throwaway domain just for internal tools and point it here instead.)
3. Wait for the dashboard to show the zone **Active** (minutes to a few hours).

You do **not** need to pre-create the DNS record for `tools.*` — Step 6 does that.

---

## Step 2 — Build the frontend

```powershell
cd platform\frontend
npm install
npm run build        # → platform\frontend\dist  (gitignored; build on the host)
```

The backend auto-detects `frontend\dist` and serves it, including the PWA manifest,
icons, and service worker. (Override the location with `PLATFORM_FRONTEND_DIST`.)

---

## Step 3 — Configure the production env

Copy `platform\deploy\.env.production.example` and fill it in. Apply the values
either by adding them to the repo-root `.env` (gitignored) or by setting them as
real environment variables for the backend process. The essentials:

| Var | Why it matters for a public deploy |
| --- | --- |
| `PLATFORM_HOST=127.0.0.1` | Bind to loopback — only `cloudflared` should reach it. |
| `PLATFORM_COOKIE_SECURE=true` | The site is HTTPS; the session cookie must be `Secure`. |
| `PLATFORM_DOCS=false` | Hide `/docs` + `/openapi.json` so anonymous visitors only see the login. |
| `PLATFORM_SECRET_KEY` | Long random JWT signing key so sessions survive restarts. |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` | **Change the default admin login** — the site is public. |
| `OPENAI_API_KEY` | Required for the Banner Builder. `ANTHROPIC_API_KEY` / `FIGMA_API_KEY` optional. |

Generate the two secrets:

```powershell
# Signing key
python -c "import secrets; print(secrets.token_urlsafe(48))"
# Admin password hash (bcrypt, matches auth.py)
python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('YOUR-PASSWORD'))"
```

> ⚠️ The app ships with a seeded admin (`ADMIN_EMAIL` / password `parola`). On a
> public site you **must** override these before anyone can reach the URL.

---

## Step 4 — Run the backend (production)

```powershell
cd platform\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000   # NO --reload in prod
```

Sanity check locally before exposing it: open `http://127.0.0.1:8000/` (login page)
and `http://127.0.0.1:8000/api/health` (`{"status":"ok",...}`).

To keep it running unattended, install it as a service (e.g. [NSSM](https://nssm.cc/)
wrapping the uvicorn command, or a Task Scheduler "at startup" task).

---

## Step 5 — Install cloudflared

```powershell
winget install --id Cloudflare.cloudflared
# or: choco install cloudflared
cloudflared --version
```

---

## Step 6 — Create and route the tunnel

```powershell
# Opens a browser to authorize cloudflared against your Cloudflare account + zone.
cloudflared tunnel login

# Create a named tunnel; prints a UUID and writes a credentials .json under ~\.cloudflared
cloudflared tunnel create creative-tools

# Map your public hostname to the tunnel (creates the DNS CNAME for you).
cloudflared tunnel route dns creative-tools tools.<your-domain>
```

Then create the config file. Copy `platform\deploy\cloudflared\config.example.yml`
to `C:\Users\<you>\.cloudflared\config.yml` and fill in the tunnel UUID, the
credentials-file path, and `hostname: tools.<your-domain>`.

---

## Step 7 — Run the tunnel

```powershell
cloudflared tunnel run creative-tools
```

Once it connects, `https://tools.<your-domain>` reaches your app. To keep it up,
install it as a Windows service:

```powershell
cloudflared service install
# Reads C:\Users\<you>\.cloudflared\config.yml; manage via services.msc.
```

> ⚠️ The site is now **public** — anyone with the URL hits the login page. Make sure
> you changed the admin credentials (Step 3) **before** sharing the link.

---

## Step 8 — (Optional) Restrict to your team with Cloudflare Access

The app login already protects it. If you also want a **network gate** so only your
team's identities can even load the page:

1. **Zero Trust** dashboard (`one.dash.cloudflare.com`) → pick a team name + the Free plan.
2. *(Optional)* **Settings → Authentication** → add Google / Microsoft SSO (otherwise
   Cloudflare emails a one-time PIN).
3. **Access → Applications → Add an application → Self-hosted**, domain
   `tools.<your-domain>`, with an **Allow** policy that includes your team (e.g.
   *Emails ending in* `@tiebreak.solutions`).

> If you enable Access, the public `/api/plugin/*` bridge (used by the in-Figma
> plugin iframe) will be blocked by the gate. The server-side Figma QA / Translate
> tools use `FIGMA_API_KEY` and are unaffected — only the in-Figma *plugin UI*
> talking to this host would break. Add an Access **Service Auth / Bypass** policy
> scoped to `/api/plugin` if you need it.

---

## Step 9 — Install it as a desktop web-app (PWA)

Once the site is on HTTPS (the tunnel) — or even on `http://localhost` during
testing — it's installable:

- **Chrome / Edge (Windows):** open the URL → click the **Install** icon in the
  address bar, or **⋮ menu → Apps → Install this site as an app** /
  **Install Creative Tools…**. Or use the **Install** button that appears in the
  app's top-right nav when installation is available.
- The app opens in its own frameless window with a **Start-menu / desktop icon**
  (the mint crescent), separate from your browser tabs.
- **Uninstall:** in the installed window, **⋮ → Uninstall Creative Tools**.

The service worker caches the app shell so it launches fast and survives a brief
network blip; it never caches `/api/*`, so logins and tool runs always hit the live
backend.

---

## Verify

1. Open `https://tools.<your-domain>` in a fresh/incognito window → you should land on
   the app's **login** page over HTTPS (no `/docs` reachable).
2. Log in with your admin credentials → the dashboard loads and tools run.
3. In Chrome/Edge, confirm the **Install** affordance appears (address-bar icon or the
   in-app button) and that installing opens a standalone window with the crescent icon.
4. *(If you did Step 8)* From a non-allowed identity, Access blocks you before the app loads.

---

## Operations

- **Updating a deploy:** `git pull` → rebuild the frontend (Step 2) → restart the
  backend. The tunnel config doesn't change. If you changed the app shell and want
  installed PWAs to refresh immediately, bump the `CACHE` constant in
  `frontend/public/sw.js`.
- **Run artifacts** (`platform/backend/.runs/`) accumulate generated PNGs on the
  host — prune periodically.
- **Logs:** backend logs go to the uvicorn process; tunnel logs to the cloudflared
  service; Access logs (if enabled) under Zero Trust → **Logs → Access**.
- **Regenerating PWA icons** (if branding changes): `frontend/scripts/gen-pwa-icons.py`
  (needs `Pillow` + `svg.path`, dev-only).

import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  HardDrive,
  HelpCircle,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  Globe,
  Languages as LanguagesIcon,
  ArrowUpRight,
  Mail,
  MapPin,
  PanelsTopLeft,
  PenLine,
  RefreshCw,
  Ruler, UsersRound,
  Settings,
  Sparkles,
  Tag,
} from 'lucide-react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { BannerEdit } from './bannerBuilder/BannerEdit'
import { HelpModal, type HelpTool } from './bannerBuilder/HelpModal'
import { LPBuilder } from './lpBuilder/LPBuilder'
import { LPMaterials } from './lpMaterials/LPMaterials'
import { EmailBuilder } from './emailBuilder/EmailBuilder'
import { Home } from './home/Home'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { PendingGate } from './auth/PendingGate'
import { UserMenu } from './auth/UserMenu'
import { Logo } from './components/Logo'
import { FullScreenLoader, LogoLoader } from './components/LogoLoader'
import { ThemeToggle } from './components/ThemeToggle'
import { FeedbackWidget } from './components/FeedbackWidget'
import { InstallButton } from './components/InstallButton'
import { VersionBadge } from './components/VersionBadge'
import { BrandsSettings } from './admin/BrandsSettings'
import { UsersSettings } from './admin/UsersSettings'
import { SizesSettings } from './admin/SizesSettings'
import { LanguagesSettings } from './admin/LanguagesSettings'
import { MarketsSettings } from './admin/MarketsSettings'
import { DomainsSettings } from './admin/DomainsSettings'
import { DiskManager } from './admin/DiskManager'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function App() {
  return (
    <AuthProvider>
      <Gate />
      <UpdatePrompt />
    </AuthProvider>
  )
}

/**
 * Detects a new deploy so users are never stuck on a stale cached bundle (the
 * cause of "the spinner runs forever after an update"). The backend's
 * /api/app-build returns the deployed SPA's content-hashed bundle name; /api/* is
 * network-only in the service worker, so it's always fresh. When it changes, we
 * surface a one-click reload. Checked on focus and every couple of minutes.
 */
function UpdatePrompt() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    let baseline: string | null = null
    let cancelled = false
    const fetchBundle = (): Promise<string | null> =>
      fetch('/api/app-build', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => (d?.bundle as string) ?? null)
        .catch(() => null)
    fetchBundle().then((b) => {
      baseline = b
    })
    const check = async () => {
      const b = await fetchBundle()
      if (!cancelled && b && baseline && b !== baseline) setStale(true)
    }
    const iv = window.setInterval(check, 120_000)
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.clearInterval(iv)
      window.removeEventListener('focus', check)
    }
  }, [])
  if (!stale) return null
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="animate-fade-up fixed bottom-4 left-1/2 z-[100] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/50 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
    >
      <RefreshCw className="h-4 w-4" /> New version available — reload
    </button>
  )
}

/** Header disk-usage gauge. For admins it's a button that opens the Disk Manager. */
function StorageBadge({ onOpen, active }: { onOpen?: () => void; active?: boolean }) {
  const [s, setS] = useState<{ used_bytes: number; total_bytes: number; free_bytes: number } | null>(null)
  useEffect(() => {
    const load = () =>
      fetch('/api/tools/banner-builder/storage')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setS(d))
        .catch(() => {})
    load()
    const iv = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('focus', load)
    }
  }, [])
  if (!s || !s.total_bytes) return null
  const pct = Math.min(100, Math.round((s.used_bytes / s.total_bytes) * 100))
  const human = (b: number) =>
    b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`
  const bar = pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-amber-500' : 'bg-primary'
  const usage = `${human(s.used_bytes)} of ${human(s.total_bytes)} used · ${human(s.free_bytes)} free`
  const inner = (
    <>
      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className="hidden text-[11px] tabular-nums text-muted-foreground 2xl:inline">
        {human(s.used_bytes)}/{human(s.total_bytes)}
      </span>
    </>
  )
  // Always visible (it's the admin's entry to the Disk Manager); numbers collapse
  // on very small screens, leaving a tappable icon + bar.
  const base = 'flex items-center gap-1.5 rounded-md border px-2 py-1'
  // Admins: the gauge IS the entry to the Disk Manager. Everyone else: read-only.
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={`Open Disk Manager — ${usage}`}
        aria-label="Open Disk Manager"
        className={cn(
          base,
          'transition-colors hover:border-foreground/30 hover:bg-secondary',
          active ? 'border-primary/60 bg-secondary' : 'border-border bg-secondary/50',
        )}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className={cn(base, 'border-border bg-secondary/50')} title={`Banner storage — ${usage}`}>
      {inner}
    </div>
  )
}

function Gate() {
  const { user, loading, pending } = useAuth()
  if (loading) {
    return <FullScreenLoader label="Starting Internovus…" />
  }
  if (!user) return pending ? <PendingGate /> : <Login />
  return <Workspace />
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 font-display text-sm font-medium transition-[transform,background-color,color] active:scale-95 ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// The two PRODUCTS in the header switcher, each with its own sub-tools shown
// in the header nav. The last product+tool persists and lives in the URL
// (?app=&tool=) so a refresh or deep-link restores the exact workspace.
type ProductId = 'banner' | 'lp' | 'email'
type ToolIcon = ComponentType<{ className?: string }>
const PRODUCTS: {
  id: ProductId
  label: string
  /** Segment label; `nav` from 2xl up, `navShort` from md up (icon-only below). */
  nav: string
  navShort: string
  icon: ToolIcon
  /** One-liner + accent, used by the home screen's cards. */
  blurb: string
  accent: string
  /** No working tools yet — the product renders a placeholder and has no help entry. */
  soon?: boolean
  tools: { id: string; label: string; icon: ToolIcon }[]
}[] = [
  {
    id: 'banner',
    label: 'Banner Builder',
    nav: 'Banners',
    navShort: 'Banners',
    icon: ImageIcon,
    blurb: 'Describe an idea and the AI designs it, in every size you need.',
    accent: '#2563EB',
    tools: [
      { id: 'generate', label: 'Generate', icon: Sparkles },
      { id: 'edit', label: 'Edit', icon: PenLine },
    ],
  },
  {
    id: 'lp',
    label: 'Landing Page Builder',
    nav: 'Landing Pages',
    navShort: 'LPs',
    icon: PanelsTopLeft,
    blurb: 'Assemble a page from brand templates and export a ready-to-host site.',
    accent: '#7C3AED',
    tools: [
      { id: 'builder', label: 'Builder', icon: LayoutTemplate },
      { id: 'materials', label: 'Materials', icon: Images },
    ],
  },
  {
    id: 'email',
    label: 'CRM Emails',
    nav: 'CRM',
    navShort: 'CRM',
    icon: Mail,
    blurb: 'Build campaign emails that render everywhere, from your brand templates.',
    accent: '#0D9488',
    tools: [{ id: 'builder', label: 'Builder', icon: LayoutTemplate }],
  },
]

// Copywriters get a single-product workspace: the LP Builder, builder tool only.
const LP_ONLY = PRODUCTS.filter((p) => p.id === 'lp').map((p) => ({
  ...p,
  tools: p.tools.filter((t) => t.id === 'builder'),
}))

function readWorkspaceFromUrl(): { app: ProductId; tool: string } | null {
  try {
    const p = new URLSearchParams(window.location.search)
    const app = p.get('app')
    const product = PRODUCTS.find((x) => x.id === app)
    if (!product) return null
    const tool = p.get('tool') || ''
    return {
      app: product.id,
      tool: product.tools.some((t) => t.id === tool) ? tool : product.tools[0].id,
    }
  } catch {
    return null
  }
}

/** Start on the home screen unless the URL names a product — so a fresh visit
 * gets the "what do you want to create?" picker rather than being dropped into
 * whichever builder happens to be first. A deep link or a refresh inside a
 * builder still lands where it should. */
function initialView(): 'home' | 'tool' {
  return readWorkspaceFromUrl() ? 'tool' : 'home'
}

function initialWorkspace(): { app: ProductId; tool: string } {
  const fromUrl = readWorkspaceFromUrl()
  if (fromUrl) return fromUrl
  try {
    const app = localStorage.getItem('inv:app')
    const tool = localStorage.getItem('inv:tool') || ''
    const product = PRODUCTS.find((x) => x.id === app)
    if (product) {
      return {
        app: product.id,
        tool: product.tools.some((t) => t.id === tool) ? tool : product.tools[0].id,
      }
    }
  } catch {
    /* best-effort */
  }
  return { app: 'banner', tool: 'generate' }
}

// Two products in the header switcher; the header nav is the ACTIVE product's
// sub-tool bar. Admins also get the Disk Manager (via the storage gauge) and
// the Settings surface (brands + sizes) — those stay global.
function Workspace() {
  const { user } = useAuth()
  // Copywriters see ONLY the LP Builder and always start inside it.
  const isCopywriter = user?.role === 'copywriter'
  const products = isCopywriter ? LP_ONLY : PRODUCTS
  const [ws, setWs] = useState<{ app: ProductId; tool: string }>(() =>
    isCopywriter ? { app: 'lp', tool: 'builder' } : initialWorkspace())
  const [disk, setDisk] = useState(false)
  const [view, setView] = useState<'home' | 'tool' | 'settings'>(() =>
    isCopywriter ? 'tool' : initialView())
  const [settingsTab, setSettingsTab] =
    useState<'brands' | 'users' | 'languages' | 'markets' | 'domains' | 'sizes'>('brands')
  const [tool, setTool] = useState<Tool | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The banner "Generate" tool's view (Build canvas vs Library shelf) — lifted
  // here so its switch can sit in the top category bar next to Generate/Edit.
  const [bannerView, setBannerView] = useState<'build' | 'library'>('build')

  useEffect(() => {
    Promise.all([fetchTools(), fetchMeta()])
      .then(([t, m]) => {
        setTool(t.tools.find((x) => x.id === 'banner-builder') ?? null)
        setMeta(m)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Persist + mirror the workspace to the URL so refresh/deep-links restore it.
  // `inv:tool:<app>` remembers the last sub-tool PER product, so switching
  // products brings you back to where you left off in each.
  //
  // On the home screen the params are STRIPPED instead: leaving ?app= behind
  // would make a refresh skip the picker and reopen the last builder, which is
  // exactly the behaviour the home screen replaces.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (view === 'home') {
        url.searchParams.delete('app')
        url.searchParams.delete('tool')
      } else {
        localStorage.setItem('inv:app', ws.app)
        localStorage.setItem('inv:tool', ws.tool)
        localStorage.setItem(`inv:tool:${ws.app}`, ws.tool)
        url.searchParams.set('app', ws.app)
        url.searchParams.set('tool', ws.tool)
      }
      window.history.replaceState(null, '', url.toString())
    } catch {
      /* best-effort */
    }
  }, [ws, view])

  const isAdmin = user?.role === 'admin'
  const product = products.find((p) => p.id === ws.app) ?? products[0]
  const inTool = view === 'tool' && !disk
  function goTool(app: ProductId, toolId: string) {
    setWs({ app, tool: toolId })
    setDisk(false)
    setView('tool')
  }
  function goProduct(p: (typeof PRODUCTS)[number]) {
    let last: string | null = null
    try {
      last = localStorage.getItem(`inv:tool:${p.id}`)
    } catch {
      /* best-effort */
    }
    goTool(p.id, last && p.tools.some((t) => t.id === last) ? last : p.tools[0].id)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* relative z-50: the header owns a stacking context ABOVE the workspace
          panes, so header dropdowns (e.g. the user menu, which hangs below the
          64px header into <main>'s territory) paint on top of everything. */}
      <header className="relative z-50 flex h-16 shrink-0 items-center gap-2 bg-card/70 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
        {/* The brand mark doubles as the way back to the home picker. */}
        <button
          type="button"
          onClick={() => { setDisk(false); setView('home') }}
          className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Internovus — Creative Builder · back to home"
          aria-label="Back to home"
        >
          <Logo className="h-7 w-auto sm:h-8" />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <StorageBadge
            onOpen={isAdmin ? () => { setDisk(true); setView('tool') } : undefined}
            active={disk && view === 'tool'}
          />
          <span className="hidden sm:inline-flex">
            <VersionBadge />
          </span>
          {/* Sibling platform — the catalogue the finished work is uploaded to.
              New tab so an in-flight generation is never abandoned. */}
          <Button asChild variant="ghost" size="sm" className="font-display">
            <a
              href="https://creativeops.internovus.com/"
              target="_blank"
              rel="noopener noreferrer"
              title="Open CreativeOPS — the creative catalogue"
            >
              <ArrowUpRight className="h-4 w-4" />
              <span className="hidden xl:inline">CreativeOPS</span>
            </a>
          </Button>
          {isAdmin && (
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              className="font-display"
              title="Admin — brands, users, languages, markets & domains"
              onClick={() => setView((v) => (v === 'settings' ? 'tool' : 'settings'))}
            >
              <Settings className="h-4 w-4" />
              <span className="hidden 2xl:inline">Admin</span>
            </Button>
          )}
          <span className="hidden sm:inline-flex">
            <InstallButton />
          </span>
          {inTool && !product.soon && (
            <Button
              variant="ghost"
              size="icon"
              title="How it works"
              aria-label="How it works"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          )}
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      {/* Category bar — the primary nav. Out of the header so the labels can be
          full-size and always visible; z-40 keeps it under the header's menus.
          Scrolls horizontally rather than collapsing to icons on narrow screens. */}
      <div className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3 backdrop-blur-md sm:px-5">
        <nav
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Categories"
        >
          {products.map((p) => {
            // Nothing is "current" on the home screen — the picker is.
            const active = view !== 'home' && p.id === product.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => goProduct(p)}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 font-display text-[15px] transition-colors active:scale-95 sm:px-4 ${
                  active
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
              >
                <p.icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-primary' : ''}`} />
                <span>{p.nav}</span>
                {p.soon && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Soon
                  </span>
                )}
                {active && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                    aria-hidden
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* Banner Build ↔ Library view switch — moved up here (was a separate row
            in the workspace) so it sits with the tool nav and the canvas stays
            clean. Only for the banner Generate tool. */}
        {inTool && product.id === 'banner' && ws.tool === 'generate' && (
          <span className="inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5">
            {(['build', 'library'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setBannerView(m)}
                aria-pressed={bannerView === m}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-semibold transition-all',
                  bannerView === m
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'build' ? 'Build' : 'Library'}
              </button>
            ))}
          </span>
        )}

        {/* Sub-tools of the active category. Hidden on home (no category is
            active) and for a category with a single tool (nothing to switch). */}
        {view !== 'home' && product.tools.length > 1 && (
          <nav
            className="flex shrink-0 items-center gap-1"
            aria-label={`${product.label} tools`}
          >
            {product.tools.map((t) => (
              <Tab
                key={t.id}
                active={inTool && ws.tool === t.id}
                onClick={() => goTool(product.id, t.id)}
              >
                <t.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t.label}</span>
              </Tab>
            ))}
          </nav>
        )}
      </div>

      <main className="min-h-0 flex-1 overflow-hidden">
        {view === 'home' ? (
          <Home
            options={products.map((p) => ({
              id: p.id,
              label: p.label,
              blurb: p.blurb,
              icon: p.icon,
              accent: p.accent,
              soon: p.soon,
            }))}
            onPick={(id) => {
              const p = products.find((x) => x.id === id)
              if (p) goProduct(p)
            }}
          />
        ) : view === 'settings' ? (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex max-w-6xl gap-6 p-5">
              {/* CreativeOPS-style admin nav: one column of categories, the
                  active one highlighted as a tinted pill. */}
              <aside className="w-56 shrink-0">
                <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Admin
                </p>
                <nav className="mt-2 space-y-1">
                  {([
                    ['brands', 'Brands', Tag],
                    ['users', 'Users', UsersRound],
                    ['languages', 'Languages', LanguagesIcon],
                    ['markets', 'Target Markets', MapPin],
                    ['domains', 'Domains', Globe],
                    ['sizes', 'Banner sizes', Ruler],
                  ] as const).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSettingsTab(key)}
                      aria-current={settingsTab === key ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                        settingsTab === key
                          ? 'bg-primary/10 font-semibold text-primary'
                          : 'text-foreground/80 hover:bg-secondary/70 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </button>
                  ))}
                </nav>
              </aside>

              <main className="min-w-0 flex-1 pb-8">
                {settingsTab === 'brands' ? <BrandsSettings />
                  : settingsTab === 'users' ? <UsersSettings />
                  : settingsTab === 'languages' ? <LanguagesSettings />
                  : settingsTab === 'markets' ? <MarketsSettings />
                  : settingsTab === 'domains' ? <DomainsSettings />
                  : <SizesSettings />}
              </main>
            </div>
          </div>
        ) : disk && isAdmin ? (
          <div className="h-full overflow-y-auto">
            <DiskManager />
          </div>
        ) : ws.app === 'email' ? (
          <EmailBuilder />
        ) : ws.app === 'lp' ? (
          ws.tool === 'materials' ? <LPMaterials /> : <LPBuilder />
        ) : ws.tool === 'edit' ? (
          <BannerEdit />
        ) : loadError ? (
          <div className="p-6">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Could not reach the backend: {loadError}.
            </div>
          </div>
        ) : tool && meta ? (
          <BannerBuilder meta={meta} view={bannerView} onViewChange={setBannerView} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <LogoLoader label="Loading the builder…" />
          </div>
        )}
      </main>
      <FeedbackWidget />
      {/* Products with no tools yet have no HelpModal entry — keep it unmounted
          so switching to one while help is open can't index TITLES by their id. */}
      {!product.soon && (
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        tool={
          (ws.app === 'banner'
            ? ws.tool === 'edit'
              ? 'edit'
              : 'generate'
            : ws.tool === 'materials'
              ? 'materials'
              : 'lp-builder') as HelpTool
        }
      />
      )}
    </div>
  )
}

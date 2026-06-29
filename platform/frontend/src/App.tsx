import { useEffect, useState, type ReactNode } from 'react'
import { HardDrive, HelpCircle, RefreshCw, Settings, Tag } from 'lucide-react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { HelpModal } from './bannerBuilder/HelpModal'
import { LPBuilder } from './lpBuilder/LPBuilder'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { UserMenu } from './auth/UserMenu'
import { Logo } from './components/Logo'
import { FullScreenLoader, LogoLoader } from './components/LogoLoader'
import { ThemeToggle } from './components/ThemeToggle'
import { InstallButton } from './components/InstallButton'
import { VersionBadge } from './components/VersionBadge'
import { BrandsSettings } from './admin/BrandsSettings'
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

/** Compact disk-usage gauge for the header — the shared banner artifact disk. */
function StorageBadge() {
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
  return (
    <div
      className="hidden items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2 py-1 sm:flex"
      title={`Banner storage — ${human(s.used_bytes)} of ${human(s.total_bytes)} used · ${human(s.free_bytes)} free`}
    >
      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {human(s.used_bytes)}/{human(s.total_bytes)}
      </span>
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return <FullScreenLoader label="Starting Internovus…" />
  }
  if (!user) return <Login />
  return <Workspace />
}

type Page = 'banner' | 'lp'

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
      className={`rounded-md px-3 py-1.5 font-display text-sm font-medium transition-[transform,background-color,color] active:scale-95 ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// Two tools, no home page: Banner Builder + LP Builder (placeholder).
// Admins also get a Settings surface (Brands).
function Workspace() {
  const { user } = useAuth()
  const [page, setPage] = useState<Page>('banner')
  const [view, setView] = useState<'tool' | 'settings'>('tool')
  const [settingsTab, setSettingsTab] = useState<'disk' | 'brands'>('disk')
  const [tool, setTool] = useState<Tool | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchTools(), fetchMeta()])
      .then(([t, m]) => {
        setTool(t.tools.find((x) => x.id === 'banner-builder') ?? null)
        setMeta(m)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  const isAdmin = user?.role === 'admin'
  const bannerActive = page === 'banner' && view === 'tool'
  const lpActive = page === 'lp' && view === 'tool'
  function goBanner() {
    setPage('banner')
    setView('tool')
  }
  function goLp() {
    setPage('lp')
    setView('tool')
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center gap-2 bg-card/70 px-3 backdrop-blur-md sm:gap-5 sm:px-5">
        <button
          type="button"
          className="group flex items-center"
          onClick={goBanner}
          title="Internovus - Creative Builder"
          aria-label="Internovus - Creative Builder — go to Banner Builder"
        >
          <Logo className="h-8 w-auto transition-transform duration-200 group-hover:scale-[1.03]" />
        </button>
        <nav className="flex items-center gap-1">
          <Tab active={bannerActive} onClick={goBanner}>
            <span className="sm:hidden">Banner</span>
            <span className="hidden sm:inline">Banner Builder</span>
          </Tab>
          <Tab active={lpActive} onClick={goLp}>
            <span className="sm:hidden">LP</span>
            <span className="hidden sm:inline">LP Builder</span>
          </Tab>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <StorageBadge />
          <span className="hidden sm:inline-flex">
            <VersionBadge />
          </span>
          {isAdmin && (
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              className="font-display"
              onClick={() => setView((v) => (v === 'settings' ? 'tool' : 'settings'))}
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          )}
          <span className="hidden sm:inline-flex">
            <InstallButton />
          </span>
          {bannerActive && (
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

      <main className="min-h-0 flex-1 overflow-hidden">
        {view === 'settings' ? (
          <div className="h-full overflow-y-auto">
            <div className="px-5 pt-5">
              <div className="inline-flex items-center rounded-lg border border-border bg-secondary p-0.5">
                {(
                  [
                    { id: 'disk', label: 'Disk Manager', icon: <HardDrive className="h-4 w-4" /> },
                    { id: 'brands', label: 'Brands', icon: <Tag className="h-4 w-4" /> },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettingsTab(t.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-display text-[13px] font-medium transition-colors',
                      settingsTab === t.id
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {settingsTab === 'disk' ? (
              <DiskManager />
            ) : (
              <div className="p-5">
                <BrandsSettings />
              </div>
            )}
          </div>
        ) : page === 'lp' ? (
          <LPBuilder />
        ) : loadError ? (
          <div className="p-6">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Could not reach the backend: {loadError}.
            </div>
          </div>
        ) : tool && meta ? (
          <BannerBuilder meta={meta} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <LogoLoader label="Loading the builder…" />
          </div>
        )}
      </main>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

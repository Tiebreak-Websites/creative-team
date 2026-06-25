import { useEffect, useState, type ReactNode } from 'react'
import { HelpCircle, RefreshCw, Settings } from 'lucide-react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { HelpModal } from './bannerBuilder/HelpModal'
import { LPBuilder } from './lpBuilder/LPBuilder'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { UserMenu } from './auth/UserMenu'
import { Logo } from './components/Logo'
import { ThemeToggle } from './components/ThemeToggle'
import { InstallButton } from './components/InstallButton'
import { VersionBadge } from './components/VersionBadge'
import { BrandsSettings } from './admin/BrandsSettings'
import { Button } from '@/components/ui/button'

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

function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        Loading…
      </div>
    )
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
      className={`rounded-md px-3 py-1.5 font-display text-sm font-medium transition-colors ${
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
      <header className="flex h-16 shrink-0 items-center gap-3 bg-card/70 px-5 backdrop-blur-md sm:gap-5">
        <button
          type="button"
          className="group flex items-center"
          onClick={goBanner}
          title="Internovus - Creative Builder"
        >
          <Logo className="h-8 w-auto transition-transform duration-200 group-hover:scale-[1.03]" />
        </button>
        <nav className="flex items-center gap-1">
          <Tab active={bannerActive} onClick={goBanner}>
            Banner Builder
          </Tab>
          <Tab active={lpActive} onClick={goLp}>
            LP Builder
          </Tab>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <VersionBadge />
          {bannerActive && (
            <Button variant="ghost" size="sm" className="font-display" onClick={() => setHelpOpen(true)}>
              <HelpCircle className="h-4 w-4" />
              Help
            </Button>
          )}
          {isAdmin && (
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              className="font-display"
              onClick={() => setView((v) => (v === 'settings' ? 'tool' : 'settings'))}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          )}
          <InstallButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {view === 'settings' ? (
          <div className="h-full overflow-y-auto">
            <BrandsSettings />
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
          <BannerBuilder tool={tool} meta={meta} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            Loading…
          </div>
        )}
      </main>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

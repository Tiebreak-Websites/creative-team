import { useEffect, useState } from 'react'
import { HelpCircle, Settings } from 'lucide-react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { HelpModal } from './bannerBuilder/HelpModal'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { UserMenu } from './auth/UserMenu'
import { ToolSettings } from './admin/ToolSettings'
import { BrandMark } from './components/BrandMark'
import { Button } from '@/components/ui/button'

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
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

// Single-purpose app: the Banner Builder. No home page, no tool switcher.
function Workspace() {
  const { user } = useAuth()
  const [tool, setTool] = useState<Tool | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [view, setView] = useState<'tool' | 'settings'>('tool')
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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center gap-3 bg-card/70 px-5 backdrop-blur-md">
        <button
          type="button"
          className="group flex items-center gap-3"
          onClick={() => setView('tool')}
          title="Banner Builder"
        >
          <BrandMark size={30} className="transition-transform duration-200 group-hover:scale-105" />
          <span className="flex flex-col items-start leading-none">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              tiebreak
            </span>
            <span className="font-display text-[17px] font-bold tracking-tight text-foreground">
              Banner Builder
            </span>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="font-display" onClick={() => setHelpOpen(true)}>
            <HelpCircle className="h-4 w-4" />
            Help
          </Button>
          {isAdmin && (
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              className="font-display"
              onClick={() => setView(view === 'settings' ? 'tool' : 'settings')}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          )}
          <UserMenu />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {loadError ? (
          <div className="p-6">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Could not reach the backend: {loadError}. Is it running on port 8001?
            </div>
          </div>
        ) : view === 'settings' && tool ? (
          <div className="h-full overflow-y-auto">
            <ToolSettings tools={[tool]} />
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

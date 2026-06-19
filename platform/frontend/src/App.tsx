import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { UserMenu } from './auth/UserMenu'
import { ToolSettings } from './admin/ToolSettings'
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
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
        <button
          type="button"
          className="flex items-center gap-2.5"
          onClick={() => setView('tool')}
          title="Banner Builder"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Banner Builder</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
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
              Could not reach the backend: {loadError}. Is it running on port 8000?
            </div>
          </div>
        ) : view === 'settings' && tool ? (
          <div className="h-full overflow-y-auto">
            <ToolSettings tools={[tool]} />
          </div>
        ) : tool && meta ? (
          <BannerBuilder tool={tool} meta={meta} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        )}
      </main>
    </div>
  )
}

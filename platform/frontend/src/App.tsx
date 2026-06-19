import { useEffect, useMemo, useState } from 'react'
import { fetchMeta, fetchTools } from './api'
import type { Meta, Tool } from './types'
import { TopNav } from './shell/TopNav'
import { Welcome, ComingSoon, DesktopOnly } from './shell/States'
import { GenericToolForm } from './shell/GenericToolForm'
import { BannerBuilder } from './bannerBuilder/BannerBuilder'
import { FigmaQa } from './figmaQa/FigmaQa'
import { CreativeSummary } from './creativeSummary/CreativeSummary'
import { Translate } from './translate/Translate'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './auth/Login'
import { ToolSettings } from './admin/ToolSettings'
import { ToolInstructions } from './components/ToolInstructions'

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

// Gate the whole app behind login.
function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="app">
        <main className="main">
          <div className="page">
            <div className="page-inner muted">Loading…</div>
          </div>
        </main>
      </div>
    )
  }
  if (!user) return <Login />
  return <Workspace />
}

function Workspace() {
  const [tools, setTools] = useState<Tool[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'tools' | 'settings'>('tools')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchTools(), fetchMeta()])
      .then(([t, m]) => {
        setTools(t.tools)
        setMeta(m)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  const selected = useMemo(
    () => tools.find((t) => t.id === selectedId) ?? null,
    [tools, selectedId],
  )

  function openTool(id: string | null) {
    setView('tools')
    setSelectedId(id)
  }

  return (
    <div className="app">
      <TopNav
        tools={tools}
        selectedId={view === 'tools' ? selectedId : null}
        onSelect={openTool}
        onOpenSettings={() => setView('settings')}
      />
      <main className="main">
        {loadError ? (
          <div className="page">
            <div className="page-inner">
              <div className="alert err">
                Could not reach the backend: {loadError}. Is it running on port 8000?
              </div>
            </div>
          </div>
        ) : view === 'settings' ? (
          <ToolSettings tools={tools} />
        ) : !selected ? (
          <Welcome tools={tools} onSelect={openTool} />
        ) : (
          <ToolView tool={selected} meta={meta} />
        )}
      </main>
    </div>
  )
}

function ToolView({ tool, meta }: { tool: Tool; meta: Meta | null }) {
  if (tool.status === 'coming-soon') return <ComingSoon tool={tool} />
  if (tool.status === 'desktop-only') return <DesktopOnly tool={tool} />
  if (tool.id === 'banner-builder') {
    if (!meta)
      return (
        <div className="page">
          <div className="page-inner muted">Loading…</div>
        </div>
      )
    // Banner uses a full-height two-pane workspace; no instructions banner so it isn't squeezed.
    return <BannerBuilder tool={tool} meta={meta} />
  }
  // Page-based tools: show the admin-edited instructions above the tool body.
  const body =
    tool.id === 'qa' ? (
      <FigmaQa tool={tool} />
    ) : tool.id === 'creative-summary' ? (
      <CreativeSummary tool={tool} />
    ) : tool.id === 'translate-figma' ? (
      <Translate tool={tool} />
    ) : (
      <GenericToolForm tool={tool} />
    )
  return (
    <>
      <ToolInstructions toolId={tool.id} />
      {body}
    </>
  )
}

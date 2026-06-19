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

export function App() {
  const [tools, setTools] = useState<Tool[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  return (
    <div className="app">
      <TopNav tools={tools} selectedId={selectedId} onSelect={setSelectedId} />
      <main className="main">
        {loadError ? (
          <div className="page">
            <div className="page-inner">
              <div className="alert err">
                Could not reach the backend: {loadError}. Is it running on port 8000?
              </div>
            </div>
          </div>
        ) : !selected ? (
          <Welcome tools={tools} onSelect={setSelectedId} />
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
    return <BannerBuilder tool={tool} meta={meta} />
  }
  if (tool.id === 'qa') return <FigmaQa tool={tool} />
  if (tool.id === 'creative-summary') return <CreativeSummary tool={tool} />
  if (tool.id === 'translate-figma') return <Translate tool={tool} />
  return <GenericToolForm tool={tool} />
}

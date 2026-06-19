import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import type { Tool } from '../types'

export function Toolbar({ tool, actions }: { tool: Tool; actions?: ReactNode }) {
  return (
    <header className="toolbar">
      <div className="ttitle">
        <h1>{tool.title}</h1>
        <span className="pill ver">v{tool.version}</span>
      </div>
      <div className="toolbar-actions">{actions}</div>
    </header>
  )
}

export function Welcome({
  tools,
  onSelect,
}: {
  tools: Tool[]
  onSelect: (id: string) => void
}) {
  return (
    <div className="page">
      <div className="page-inner">
        <div className="hero">
          <h1>Creative Tools</h1>
          <p>
            Your team's tools, in one workspace — generate, manage, and export without leaving the
            browser. Pick a tool to get started.
          </p>
        </div>
        <div className="tool-cards">
          {tools.map((t) => {
            const pill =
              t.status === 'coming-soon'
                ? { cls: 'soon', label: 'Soon' }
                : t.status === 'desktop-only'
                ? { cls: 'desktop', label: 'Desktop' }
                : null
            return (
              <button
                key={t.id}
                className={`tool-card ${t.status !== 'available' ? 'disabled' : ''}`}
                onClick={() => onSelect(t.id)}
              >
                <div className="tc-ico">
                  <Icon name={t.icon} size={18} />
                </div>
                <h4>
                  {t.title} {pill && <span className={`pill ${pill.cls}`}>{pill.label}</span>}
                </h4>
                <p>{t.description}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function ComingSoon({ tool }: { tool: Tool }) {
  return (
    <div className="tool">
      <Toolbar tool={tool} actions={<span className="pill soon">Coming soon</span>} />
      <div className="page">
        <div className="page-inner">
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Coming soon</h3>
            <p className="muted" style={{ margin: 0 }}>
              {tool.description} It already runs as a Claude Code command — the web version is on the
              roadmap.
            </p>
            {tool.docs_url && (
              <p className="muted" style={{ marginTop: 12 }}>
                Spec: <code className="inline">{tool.docs_url}</code>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DesktopOnly({ tool }: { tool: Tool }) {
  return (
    <div className="tool">
      <Toolbar tool={tool} actions={<span className="pill desktop">Desktop only</span>} />
      <div className="page">
        <div className="page-inner">
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Runs in Claude Code</h3>
            <p className="muted" style={{ margin: 0 }}>
              {tool.description} It needs Figma/Higgsfield MCP access or local Git, so it runs from
              Claude Code on your machine rather than the web platform.
            </p>
            {tool.docs_url && (
              <p className="muted" style={{ marginTop: 12 }}>
                Run it with its slash command — see <code className="inline">{tool.docs_url}</code>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MissingSecret({
  secrets,
}: {
  secrets: { env: string; label: string; docs_url: string }[]
}) {
  return (
    <div className="alert warn">
      A required key isn't set. Add it to your <code>.env</code> and restart the backend:
      <ul>
        {secrets.map((s) => (
          <li key={s.env}>
            <code>{s.env}</code> — {s.label}
            {s.docs_url && (
              <>
                {' '}
                (
                <a className="link" href={s.docs_url} target="_blank" rel="noreferrer">
                  get one
                </a>
                )
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

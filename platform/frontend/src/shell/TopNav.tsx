import { Icon } from '../components/Icon'
import type { Tool } from '../types'

const STATUS_PILL: Record<string, { cls: string; label: string } | null> = {
  available: null,
  'coming-soon': { cls: 'soon', label: 'Soon' },
  'desktop-only': { cls: 'desktop', label: 'Desktop' },
}

export function TopNav({
  tools,
  selectedId,
  onSelect,
}: {
  tools: Tool[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <header className="topnav">
      <button className="brand" onClick={() => onSelect(null)} title="Home">
        <span className="logo">C</span>
        <span className="name">Creative Tools</span>
      </button>
      <nav className="nav-tabs">
        {tools.map((t) => {
          const pill = STATUS_PILL[t.status]
          return (
            <button
              key={t.id}
              className={`nav-item ${t.id === selectedId ? 'active' : ''}`}
              onClick={() => onSelect(t.id)}
              title={t.description}
            >
              <Icon name={t.icon} size={16} />
              <span className="label">{t.title}</span>
              {pill && <span className={`pill ${pill.cls}`}>{pill.label}</span>}
            </button>
          )
        })}
      </nav>
      <div className="nav-right">
        <span className="dot live" />
        <span>Local</span>
      </div>
    </header>
  )
}

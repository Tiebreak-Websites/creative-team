import { Icon } from '../components/Icon'
import { InstallButton } from '../components/InstallButton'
import type { Tool } from '../types'
import { useAuth } from '../auth/AuthContext'
import { UserMenu } from '../auth/UserMenu'

const STATUS_PILL: Record<string, { cls: string; label: string } | null> = {
  available: null,
  'coming-soon': { cls: 'soon', label: 'Soon' },
  'desktop-only': { cls: 'desktop', label: 'Desktop' },
}

export function TopNav({
  tools,
  selectedId,
  onSelect,
  onOpenSettings,
}: {
  tools: Tool[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenSettings: () => void
}) {
  const { user } = useAuth()
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
        <InstallButton />
        {user?.role === 'admin' && (
          <button className="nav-item" onClick={onOpenSettings} title="Tool settings (admin)">
            <Icon name="wrench" size={16} />
            <span className="label">Settings</span>
          </button>
        )}
        <span className="dot live" />
        <UserMenu />
      </div>
    </header>
  )
}

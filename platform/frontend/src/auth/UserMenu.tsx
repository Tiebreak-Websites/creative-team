import { useState, type CSSProperties } from 'react'
import { useAuth } from './AuthContext'

// Compact top-nav widget: signed-in email + Logout. Reuses shared classes
// (.btn.sm.secondary, .muted); only layout is scoped inline.
const wrap: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const emailStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-2)',
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function UserMenu() {
  const { user, logout } = useAuth()
  const [busy, setBusy] = useState(false)

  if (!user) return null

  async function onLogout() {
    setBusy(true)
    try {
      await logout()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap}>
      <span style={emailStyle} title={user.email}>
        {user.email}
      </span>
      <button className="btn sm secondary" onClick={onLogout} disabled={busy}>
        {busy ? 'Signing out…' : 'Logout'}
      </button>
    </div>
  )
}

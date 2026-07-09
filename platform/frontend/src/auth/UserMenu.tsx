import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from './AuthContext'
import { Button } from '@/components/ui/button'

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
    <div className="flex items-center gap-2">
      <span
        className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:inline"
        title={user.email}
      >
        {user.email}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onLogout}
        disabled={busy}
        title={busy ? 'Signing out…' : 'Log out'}
        aria-label="Log out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}

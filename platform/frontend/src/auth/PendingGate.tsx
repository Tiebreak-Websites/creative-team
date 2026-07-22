// The waiting room. A first Microsoft sign-in lands here: the account exists
// (viewer + pending) but an admin hasn't opened the door yet in Admin →
// Users. Approval applies within seconds of being granted — "Check again"
// re-asks, no re-login needed.

import { useState } from 'react'
import { Hourglass, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from './AuthContext'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'

export function PendingGate() {
  const { recheck, logout } = useAuth()
  const [checking, setChecking] = useState(false)

  async function onCheck() {
    setChecking(true)
    try {
      await recheck()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-[130px]"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)' }}
      />
      <div className="relative z-10 w-full max-w-sm animate-fade-up">
        <div className="rounded-2xl border border-border bg-card p-9 text-center shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
          <Logo className="mx-auto h-11 w-auto" />
          <Hourglass className="mx-auto mt-7 h-8 w-8 text-primary" />
          <h1 className="mt-4 font-display text-lg font-bold">Almost in</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Your Microsoft sign-in worked and your account is created — an admin
            just needs to approve it in <span className="font-medium text-foreground">Admin → Users</span>.
            Approval applies immediately; no need to sign in again.
          </p>
          <div className="mt-7 space-y-2">
            <Button size="lg" className="w-full font-display" onClick={onCheck} disabled={checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Check again
            </Button>
            <Button size="lg" variant="outline" className="w-full" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">Internovus · Creative Builder</p>
      </div>
    </div>
  )
}

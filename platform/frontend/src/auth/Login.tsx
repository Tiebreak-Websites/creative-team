import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/Logo'

/** Microsoft's four-square mark, inline so the login page needs no assets. */
function MicrosoftMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

export function Login() {
  const { login, loginSSO, config } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  // With SSO on, the password form stays hidden behind an explicit click even
  // when break-glass allows it — Microsoft is the door.
  const [showPassword, setShowPassword] = useState(false)

  const sso = config?.sso === true
  const passwordAllowed = config ? config.password_login : true
  const passwordVisible = !sso || (passwordAllowed && showPassword)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function onSSO() {
    setError(null)
    setRedirecting(true)
    try {
      await loginSSO() // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microsoft sign-in failed')
      setRedirecting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-[130px]"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)' }}
      />
      <div className="relative z-10 w-full max-w-sm animate-fade-up">
        <div className="rounded-2xl border border-border bg-card p-9 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)]">
          <div className="flex flex-col items-center text-center">
            <Logo className="h-11 w-auto" />
            <p className="mt-5 text-sm text-muted-foreground">Sign in to continue</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {sso && (
            <div className="mt-7">
              <Button
                type="button"
                size="lg"
                className="w-full font-display tb-glow"
                onClick={onSSO}
                disabled={redirecting}
              >
                {redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MicrosoftMark />}
                {redirecting ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Your Tiebreak work account — MFA included.
              </p>
              {passwordAllowed && !showPassword && (
                <p className="mt-4 text-center">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setShowPassword(true)}
                  >
                    Use a password instead
                  </button>
                </p>
              )}
            </div>
          )}

          {passwordVisible && (
            <form onSubmit={onSubmit} className={sso ? 'mt-5 space-y-4' : 'mt-7 space-y-4'}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus={!sso}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@internovus.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full font-display tb-glow" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">Internovus · Creative Builder</p>
      </div>
    </div>
  )
}

import { useState, type CSSProperties, type FormEvent } from 'react'
import { useAuth } from './AuthContext'

// Scoped inline styles only — no new global CSS. Everything else reuses the
// shared design classes (.card/.field/.input/.btn/.alert/.spinner/.muted).
const screen: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '24px',
  background: 'var(--bg)',
}
const card: CSSProperties = { width: '100%', maxWidth: 380, margin: 0 }
const head: CSSProperties = { textAlign: 'center', marginBottom: 20 }
const logo: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 18,
  marginBottom: 12,
}

export function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <div style={screen}>
      <form className="card" style={card} onSubmit={onSubmit}>
        <div style={head}>
          <span style={logo}>C</span>
          <h1 style={{ fontSize: 20 }}>Creative Tools</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Sign in to continue
          </p>
        </div>

        {error && <div className="alert err">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@tiebreak.dev"
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>

        <button
          className="btn block"
          type="submit"
          disabled={submitting}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {submitting && <span className="spinner light" />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

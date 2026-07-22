import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getSupa, type AuthConfig } from './supaClient'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export interface AuthUser {
  email: string
  role: string
  name?: string
  sections?: string[] | null
  sso?: boolean
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  /** Signed in with Microsoft but not yet approved by an admin. */
  pending: boolean
  /** What the login screen should offer (null until /auth/config answers). */
  config: AuthConfig | null
  login: (email: string, password: string) => Promise<void>
  loginSSO: () => Promise<void>
  /** Re-check access — the pending screen's "Check again". */
  recheck: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function fetchMe(): Promise<{ user: AuthUser | null; pending: boolean }> {
  const r = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
  if (r.ok) {
    const data = await r.json().catch(() => ({}))
    return { user: data?.user ?? null, pending: false }
  }
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}))
    const code = body?.detail?.code
    if (code === 'pending_access' || code === 'deactivated') {
      return { user: null, pending: true }
    }
  }
  return { user: null, pending: false }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [config, setConfig] = useState<AuthConfig | null>(null)

  // Bootstrap: learn what login looks like, catch a returning SSO redirect,
  // then ask the backend who we are.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let cfg: AuthConfig | null = null
      try {
        const r = await fetch(`${BASE}/auth/config`, { credentials: 'include' })
        if (r.ok) cfg = await r.json()
      } catch {
        /* config endpoint missing → password login, as always */
      }
      if (cancelled) return
      setConfig(cfg)

      // If Entra just redirected back, a Supabase session is sitting in the
      // URL. Initializing the client captures it; then we exchange it for the
      // builder's own cookie — once — and the URL is left clean.
      if (cfg?.sso) {
        try {
          const supa = getSupa(cfg)
          const { data } = await supa.auth.getSession()
          const token = data.session?.access_token
          if (token) {
            const me = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
            if (me.status === 401) {
              const ex = await fetch(`${BASE}/auth/sso-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ access_token: token }),
              })
              if (ex.ok) {
                const d = await ex.json().catch(() => ({}))
                if (!cancelled) {
                  if (d?.pending) setPending(true)
                  else setUser(d?.user ?? null)
                  setLoading(false)
                }
                if (window.location.hash) {
                  history.replaceState(null, '', window.location.pathname)
                }
                return
              }
            }
          }
        } catch {
          /* fall through to the normal me() check */
        }
      }

      const state = await fetchMe()
      if (!cancelled) {
        setUser(state.user)
        setPending(state.pending)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(
        (typeof body?.detail === 'string' && body.detail) || 'Invalid email or password')
    }
    const data = await r.json()
    setPending(false)
    setUser(data.user)
  }, [])

  const loginSSO = useCallback(async () => {
    if (!config?.sso) throw new Error('SSO is not enabled.')
    const supa = getSupa(config)
    const { data, error } = await supa.auth.signInWithSSO({
      domain: config.sso_domain,
      options: { redirectTo: window.location.origin },
    })
    if (error) throw new Error(error.message)
    if (data?.url) window.location.href = data.url
    else throw new Error('The sign-in service returned no redirect URL.')
  }, [config])

  const recheck = useCallback(async () => {
    const state = await fetchMe()
    setUser(state.user)
    setPending(state.pending)
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
      if (config?.sso) {
        // Clear the local Supabase session too (Entra's own session survives —
        // that's IT's domain, and it makes the next sign-in one click).
        await getSupa(config).auth.signOut().catch(() => {})
      }
    } finally {
      setUser(null)
      setPending(false)
    }
  }, [config])

  return (
    <AuthContext.Provider
      value={{ user, loading, pending, config, login, loginSSO, recheck, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

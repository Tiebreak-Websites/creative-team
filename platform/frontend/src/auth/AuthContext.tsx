import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export interface AuthUser {
  email: string
  role: string
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, ask the backend who we are (valid session cookie → user).
  useEffect(() => {
    let cancelled = false
    fetch(`${BASE}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setUser(data?.user ?? null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
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
      throw new Error(body?.detail ?? 'Invalid email or password')
    }
    const data = await r.json()
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    } finally {
      setUser(null)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

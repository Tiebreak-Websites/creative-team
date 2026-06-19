import { useCallback, useEffect, useState } from 'react'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** Per-tool config shape served by GET /api/tools/{id}/config. */
export interface ToolConfig {
  instructions: string
  options: Record<string, unknown>
}

export interface UseToolConfig {
  config: ToolConfig | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Load a tool's admin-editable config. Cookies are first-party (same-origin via
 * the Vite proxy), but we send credentials explicitly so the logged-in session
 * is always attached.
 */
export function useToolConfig(toolId: string): UseToolConfig {
  const [config, setConfig] = useState<ToolConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${BASE}/tools/${toolId}/config`, {
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`Failed to load config (HTTP ${r.status})`)
      const data = (await r.json()) as ToolConfig
      setConfig(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [toolId])

  useEffect(() => {
    load()
  }, [load])

  return { config, loading, error, reload: load }
}

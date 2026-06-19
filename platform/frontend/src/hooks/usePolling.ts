import { useEffect, useRef, useState } from 'react'

/**
 * Poll `fn` every `intervalMs` while `active` is true. Stops on cleanup and
 * whenever `active` flips to false (the caller flips it off once the run
 * reaches a terminal status).
 */
export function usePolling<T>(fn: () => Promise<T>, active: boolean, intervalMs = 2000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const d = await fnRef.current()
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
      if (!cancelled) timer = window.setTimeout(tick, intervalMs)
    }
    tick()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [active, intervalMs])

  return { data, error, setData }
}

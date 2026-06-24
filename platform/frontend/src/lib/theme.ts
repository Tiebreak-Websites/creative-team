import { useEffect, useState } from 'react'

/**
 * Light/dark theme. Default follows the OS; once the user toggles, their choice
 * is stored and wins. The initial class is set by an inline script in index.html
 * (no flash); this hook keeps it in sync and re-applies on change.
 */
export type Theme = 'light' | 'dark'
const KEY = 'theme'

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}
function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}
function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => stored() ?? (systemDark() ? 'dark' : 'light'))

  useEffect(() => apply(theme), [theme])

  // Track the OS until the user makes an explicit choice.
  useEffect(() => {
    if (stored()) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (!stored()) setThemeState(mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function setTheme(next: Theme) {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* ignore */
    }
    setThemeState(next)
  }

  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}

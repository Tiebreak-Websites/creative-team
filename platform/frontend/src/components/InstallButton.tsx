import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/**
 * "Install" affordance for the PWA. The browser fires `beforeinstallprompt`
 * when the app is installable; we stash that event and show a button that
 * triggers the native install dialog. Renders nothing when install isn't
 * offered or the app is already running standalone (installed).
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<any>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // keep the event so we can trigger it from our button
      setDeferred(e)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const standalone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches
  if (standalone || !deferred) return null

  return (
    <button
      className="nav-item"
      title="Install Creative Tools as a desktop app"
      onClick={async () => {
        deferred.prompt()
        await deferred.userChoice
        setDeferred(null)
      }}
    >
      <Icon name="download" size={16} />
      <span className="label">Install</span>
    </button>
  )
}

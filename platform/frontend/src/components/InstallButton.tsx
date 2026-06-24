import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * "Install" affordance for the PWA. The browser fires `beforeinstallprompt` when
 * the app is installable; we stash it and show a button that triggers the native
 * install dialog. Renders nothing when install isn't offered or the app already
 * runs standalone (installed).
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<any>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
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
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  if (standalone || !deferred) return null

  return (
    <Button
      variant="ghost"
      size="sm"
      className="font-display"
      title="Install Internovus - Creative Builder as a desktop app"
      onClick={async () => {
        deferred.prompt()
        await deferred.userChoice
        setDeferred(null)
      }}
    >
      <Download className="h-4 w-4" />
      Install
    </Button>
  )
}

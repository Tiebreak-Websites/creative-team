import { Logo } from './Logo'
import { cn } from '@/lib/utils'

/**
 * Branded loader: the Internovus wordmark over a slim indeterminate sweep bar in
 * the brand colour. The logo itself stays still — the moving bar is the "real"
 * loader, so it reads as actively loading without spinning the mark.
 */
export function LogoLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <Logo className="h-9 w-auto animate-fade-in" />
      <div
        role="status"
        aria-label={label || 'Loading'}
        className="h-[3px] w-44 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full w-1/3 rounded-full bg-primary animate-loader-sweep" />
      </div>
      {label && <span className="animate-fade-in text-xs font-medium text-muted-foreground">{label}</span>}
    </div>
  )
}

/** Full-screen centered branded loader (app boot / auth check). */
export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background animate-fade-in">
      <LogoLoader label={label} />
    </div>
  )
}

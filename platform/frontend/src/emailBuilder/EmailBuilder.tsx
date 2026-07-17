import { Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * Email Builder — placeholder for the CRM team's tool while it's being built.
 *
 * Mirrors the platform's `coming-soon` tool status: reachable from the header so
 * the team can find it, with nothing to run yet. The header's "How it works"
 * button is hidden for this product — HelpModal has no entry for it.
 */
export function EmailBuilder() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="animate-fade-up mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground">
          <Mail className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <h1 className="font-display text-xl font-semibold">Email Builder</h1>
            <Badge variant="soft">Coming soon</Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Campaign emails for the CRM team. This is where the builder will live — nothing to
            run just yet.
          </p>
        </div>
      </div>
    </div>
  )
}

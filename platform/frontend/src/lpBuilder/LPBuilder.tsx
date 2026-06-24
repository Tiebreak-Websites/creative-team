import { BrandMark } from '@/components/BrandMark'

/** Placeholder page — the LP (landing-page) Builder tool is not built yet. */
export function LPBuilder() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center animate-fade-up">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <BrandMark size={36} />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">LP Builder</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          We're building this tool. Landing-page generation is coming soon — check back shortly.
        </p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          In progress
        </span>
      </div>
    </div>
  )
}

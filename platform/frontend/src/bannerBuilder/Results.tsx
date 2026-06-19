import type { CSSProperties } from 'react'
import { Download, ExternalLink, ImageIcon, Loader2, Sparkles } from 'lucide-react'
import type { Banner, RunData } from '../types'
import { assetUrl, zipAllUrl } from '../api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const RUNNING = ['queued', 'directing', 'running_master', 'running_recomp']

/** Sort a concept's banners: master first, then by pixel area ascending. */
function sortBanners(banners: Banner[]): Banner[] {
  const area = (size: string) => {
    const [w, h] = size.split('x').map(Number)
    return (w || 0) * (h || 0)
  }
  return [...banners].sort((a, b) => {
    const ma = a.phase === 'master' ? 0 : 1
    const mb = b.phase === 'master' ? 0 : 1
    if (ma !== mb) return ma - mb
    return area(a.size) - area(b.size)
  })
}

interface ConceptGroup {
  id: string
  number: number
  title: string
  banners: Banner[]
  genMs: number
  ok: number
  total: number
  running: boolean
}

/** Flatten all runs into per-concept groups (newest run first). */
function buildGroups(runs: RunData[]): ConceptGroup[] {
  const groups: ConceptGroup[] = []
  for (const run of [...runs].reverse()) {
    const byConcept = new Map<string, Banner[]>()
    const order: string[] = []
    for (const b of run.banners) {
      if (!byConcept.has(b.concept)) {
        byConcept.set(b.concept, [])
        order.push(b.concept)
      }
      byConcept.get(b.concept)!.push(b)
    }
    order.forEach((ck, i) => {
      const bs = sortBanners(byConcept.get(ck)!)
      const m = /(\d+)/.exec(ck)
      const genMs = bs.reduce((acc, b) => acc + (b.status === 'ok' && b.gen_ms ? b.gen_ms : 0), 0)
      groups.push({
        id: `${run.run_id}:${ck}`,
        number: m ? parseInt(m[1], 10) : i + 1,
        title: bs.find((b) => b.title)?.title ?? '',
        banners: bs,
        genMs,
        ok: bs.filter((b) => b.status === 'ok').length,
        total: bs.length,
        running: RUNNING.includes(run.status),
      })
    })
  }
  return groups
}

function fmtTime(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function OutputPane({ runs }: { runs: RunData[] }) {
  if (!runs.length) return <EmptyOutput />
  const groups = buildGroups(runs)
  const firstError = runs.map((r) => r.error).find(Boolean)
  return (
    <div className="flex min-h-full flex-col">
      <OverviewBar runs={runs} />
      <div className="space-y-7 p-5">
        {firstError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {firstError}
          </div>
        )}
        {groups.map((g) => (
          <ConceptGroupBlock key={g.id} g={g} />
        ))}
      </div>
    </div>
  )
}

function OverviewBar({ runs }: { runs: RunData[] }) {
  const total = runs.reduce((a, r) => a + r.total, 0)
  const ready = runs.reduce((a, r) => a + r.completed, 0)
  const pct = total ? Math.round((ready / total) * 100) : 0
  const running = runs.some((r) => RUNNING.includes(r.status))
  const failed = runs.some((r) => r.status === 'failed')
  const directed = runs.some((r) => r.director?.used)
  const okRunIds = runs.filter((r) => r.banners.some((b) => b.status === 'ok')).map((r) => r.run_id)
  const label =
    runs.length === 1
      ? statusLabel(runs[0].status)
      : running
        ? 'Generating…'
        : failed
          ? 'Some runs failed'
          : 'All banners ready'

  return (
    <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background/80 px-5 py-3 backdrop-blur">
      <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <span className={cn('h-2.5 w-2.5 rounded-full', failed ? 'bg-destructive' : 'bg-primary')} />
        )}
        {label}
      </span>

      <div className="hidden h-1.5 max-w-[280px] flex-1 overflow-hidden rounded-full bg-muted sm:block">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {ready}/{total} ready
      </span>

      {directed && (
        <Badge variant="soft" className="shrink-0 gap-1">
          <Sparkles className="h-3 w-3" /> GPT-5.5
        </Badge>
      )}

      {okRunIds.length > 0 && (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <a href={zipAllUrl(okRunIds)}>
            <Download className="h-4 w-4" /> Download all
          </a>
        </Button>
      )}
    </div>
  )
}

function ConceptGroupBlock({ g }: { g: ConceptGroup }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">Concept {g.number}</h3>
        {g.title && <span className="text-sm text-muted-foreground">{g.title}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {g.running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {g.ok}/{g.total} ready
          </span>
          {g.genMs > 0 && (
            <span title="Total image render time across this concept's sizes">· {fmtTime(g.genMs)}</span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {g.banners.map((b) => (
          <AssetCard key={b.label} b={b} />
        ))}
      </div>
    </section>
  )
}

const CHECKER: CSSProperties = {
  backgroundImage:
    'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)',
  backgroundSize: '16px 16px',
}

function AssetCard({ b }: { b: Banner }) {
  const tag = b.phase === 'master' ? 'master' : 'recomposed'

  if (b.status === 'ok' && b.url) {
    const src = assetUrl(b.url)
    return (
      <div className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
        <div className="relative aspect-square" style={CHECKER}>
          <img src={src} alt={b.label} loading="lazy" className="h-full w-full object-contain" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-foreground/45 opacity-0 transition-opacity group-hover:opacity-100">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              title="Open full size"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-background/90 text-foreground shadow hover:bg-background"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={`${src}?download=1`}
              title="Download PNG"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-background/90 text-foreground shadow hover:bg-background"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between px-2.5 py-2 text-xs">
          <span className="font-medium">{b.size}</span>
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {tag}
          </Badge>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-border bg-muted/40">
      <div className="flex aspect-square flex-col items-center justify-center gap-1.5 p-3 text-center">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <StatusDot status={b.status} /> {b.size}
        </span>
        <span className="text-xs text-muted-foreground">{phLabel(b)}</span>
      </div>
      <div className="flex items-center justify-between px-2.5 py-2 text-xs">
        <span className="font-medium text-muted-foreground">{b.size}</span>
        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
          {tag}
        </Badge>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'ok'
      ? 'bg-primary'
      : status === 'running'
        ? 'animate-pulse bg-amber-500'
        : status === 'pending'
          ? 'bg-muted-foreground/40'
          : 'bg-destructive'
  return <span className={cn('h-2 w-2 rounded-full', cls)} />
}

function phLabel(b: Banner): string {
  if (b.status === 'pending') return 'Queued'
  if (b.status === 'running') return `Generating${b.attempts > 1 ? ` · attempt ${b.attempts}` : ''}…`
  return b.error ? `${b.status}: ${b.error}` : b.status
}

function statusLabel(s: string): string {
  switch (s) {
    case 'queued':
      return 'Queued…'
    case 'directing':
      return 'Art-directing with GPT-5.5…'
    case 'running_master':
      return 'Rendering master concepts…'
    case 'running_recomp':
      return 'Recomposing other sizes…'
    case 'completed':
      return 'All banners ready'
    case 'partial':
      return 'Done — some frames failed'
    case 'failed':
      return 'Run failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return s
  }
}

function EmptyOutput() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground shadow-sm">
          <ImageIcon className="h-6 w-6" />
        </div>
        <h3 className="text-base font-semibold">Your banners will appear here</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Fill in the brief on the left, pick your sizes, and hit Generate.
        </p>
      </div>
    </div>
  )
}

import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Check,
  Download,
  HelpCircle,
  ImageIcon,
  Loader2,
  Maximize2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { Banner, RunData } from '../types'
import { assetUrl, selectionZipUrl, versionZipUrl, zipAllUrl } from '../api'
import { BannerLibrary, type LibraryItem } from './BannerLibrary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const RUNNING = ['queued', 'classifying', 'directing', 'running_master', 'running_recomp', 'evaluating']

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
  runId: string
  concept: string
  number: number
  title: string
  banners: Banner[]
  genMs: number
  ok: number
  total: number
  running: boolean
  createdAt: string
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
        runId: run.run_id,
        concept: ck,
        number: m ? parseInt(m[1], 10) : i + 1,
        title: bs.find((b) => b.title)?.title ?? '',
        banners: bs,
        genMs,
        ok: bs.filter((b) => b.status === 'ok').length,
        total: bs.length,
        running: RUNNING.includes(run.status),
        createdAt: run.created_at,
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

/** Local clock time a run was requested (when Generate was pressed). */
function fmtRequested(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Filesystem-safe slug for download filenames. */
function slugify(s: string): string {
  return (s || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80)
}

export function OutputPane({
  runs,
  onHelp,
  onDeleteBanner,
  onCancel,
  onCancelRun,
}: {
  runs: RunData[]
  onHelp?: () => void
  onDeleteBanner?: (runId: string, label: string) => void
  onCancel?: () => void
  onCancelRun?: (runId: string) => void
}) {
  const [libOpen, setLibOpen] = useState(false)
  const [libIndex, setLibIndex] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  if (!runs.length) return <EmptyOutput onHelp={onHelp} />
  const groups = buildGroups(runs)
  const firstError = runs.map((r) => r.error).find(Boolean)
  const okRunIds = runs.filter((r) => r.banners.some((b) => b.status === 'ok')).map((r) => r.run_id)

  const styleByRun = new Map(runs.map((r) => [r.run_id, r.style ?? '']))
  // Flat list of every viewable banner — powers the library / lightbox.
  const libItems: LibraryItem[] = groups.flatMap((g) =>
    g.banners
      .filter((b) => b.status === 'ok' && b.url)
      .map((b) => {
        const slug = slugify(b.title)
        const fileName = `v${g.number}-${b.size}${slug ? `-${slug}` : ''}`
        const src = assetUrl(b.url as string)
        return {
          label: b.label,
          runId: g.runId,
          src,
          downloadHref: `${src}?download=1&name=${encodeURIComponent(fileName)}`,
          size: b.size,
          version: g.number,
          title: g.title,
          subtitle: b.subtitle,
          button: b.button,
          brief: b.brief,
          prompt: b.prompt ?? undefined,
          style: styleByRun.get(g.runId) ?? '',
        }
      }),
  )
  function openLibrary(runId: string, label: string) {
    // label (concept__size) repeats across runs — match BOTH so "view" opens the
    // exact banner the user clicked, not just the first one with that label.
    const i = libItems.findIndex((it) => it.runId === runId && it.label === label)
    if (i >= 0) {
      setLibIndex(i)
      setLibOpen(true)
    }
  }

  // Multi-select: keys are `${runId}|${label}` (runId/label never contain "|").
  function toggleSelect(runId: string, label: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = `${runId}|${label}`
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }
  const selectedItems = [...selected].map((k) => {
    const i = k.indexOf('|')
    return { runId: k.slice(0, i), label: k.slice(i + 1) }
  })
  function deleteSelected() {
    selectedItems.forEach((it) => onDeleteBanner?.(it.runId, it.label))
    setSelected(new Set())
  }

  return (
    <div className="flex min-h-full flex-col animate-fade-in">
      <div className="sticky top-0 z-10">
        <OverviewBar runs={runs} onCancel={onCancel} />
        {selected.size > 0 && (
          <div className="flex animate-pop-in items-center gap-3 border-b border-primary/30 bg-primary/10 px-5 py-2.5 backdrop-blur-md">
            <span className="font-display text-sm font-semibold text-primary">
              {selected.size} selected
            </span>
            <Button asChild size="sm" className="gap-1.5">
              <a href={selectionZipUrl(selectedItems)} download>
                <Download className="h-4 w-4" /> Download {selected.size}
              </a>
            </Button>
            {onDeleteBanner && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1.5"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-4 w-4" /> Clear
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-7 p-5">
        {firstError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="font-medium">A generation ran into a problem.</div>
            <details className="mt-1">
              <summary className="cursor-pointer select-none text-xs opacity-80 hover:opacity-100">
                Show details
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs opacity-90">{firstError}</p>
            </details>
          </div>
        )}
        {groups.map((g) => (
          <ConceptGroupBlock
            key={g.id}
            g={g}
            onView={openLibrary}
            onDelete={onDeleteBanner}
            onCancelRun={onCancelRun}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>
      <BannerLibrary
        open={libOpen}
        items={libItems}
        index={libIndex}
        onIndexChange={setLibIndex}
        onClose={() => setLibOpen(false)}
        onDelete={(runId, label) => onDeleteBanner?.(runId, label)}
        downloadAllHref={okRunIds.length ? zipAllUrl(okRunIds) : undefined}
      />
    </div>
  )
}

function OverviewBar({ runs, onCancel }: { runs: RunData[]; onCancel?: () => void }) {
  // Progress reflects ONLY the currently-generating runs (the current task) —
  // not the historical total of every run in the gallery.
  const activeRuns = runs.filter((r) => RUNNING.includes(r.status))
  const activeCount = activeRuns.length
  const total = activeRuns.reduce((a, r) => a + r.total, 0)
  const ready = activeRuns.reduce((a, r) => a + r.completed, 0)
  const pct = total ? Math.round((ready / total) * 100) : 0
  const running = activeCount > 0
  // Pre-render phases (queued/classifying/art-direction) finish no frames for a
  // while — show an animated indeterminate bar so it reads as "working", not 0%.
  const preRender = running && ready === 0
  const failed = runs.some((r) => r.status === 'failed')
  const directed = runs.some((r) => r.director?.used)
  const okRunIds = runs.filter((r) => r.banners.some((b) => b.status === 'ok')).map((r) => r.run_id)
  const label = running
    ? activeCount > 1
      ? `Generating ${activeCount} batches…`
      : statusLabel(activeRuns[0].status)
    : failed
      ? 'Some runs failed'
      : 'All banners ready'

  return (
    <div className="flex items-center gap-4 border-b border-border bg-card/70 px-5 py-3 backdrop-blur-md">
      <span className="flex shrink-0 items-center gap-2 font-display text-sm font-semibold">
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <span className={cn('h-2.5 w-2.5 rounded-full', failed ? 'bg-destructive' : 'bg-primary ring-4 ring-primary/20')} />
        )}
        {label}
      </span>

      {running && (
        <div className="hidden h-1.5 max-w-[240px] flex-1 overflow-hidden rounded-full bg-secondary sm:block">
          <div
            className={cn(
              'h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400',
              preRender ? 'w-2/5 animate-pulse' : 'transition-[width] duration-500',
            )}
            style={preRender ? undefined : { width: `${pct}%` }}
          />
        </div>
      )}

      {running && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {preRender ? 'preparing…' : `${ready}/${total} ready`}
        </span>
      )}

      <div className="ml-auto" />

      {activeCount > 1 && onCancel && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onCancel}
          title="Stop all running generations"
        >
          <X className="h-4 w-4" /> Stop all
        </Button>
      )}

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

function ConceptGroupBlock({
  g,
  onView,
  onDelete,
  onCancelRun,
  selected,
  onToggleSelect,
}: {
  g: ConceptGroup
  onView: (runId: string, label: string) => void
  onDelete?: (runId: string, label: string) => void
  onCancelRun?: (runId: string) => void
  selected: Set<string>
  onToggleSelect: (runId: string, label: string) => void
}) {
  // Bind this group's run id so view + delete are scoped to the right run.
  const onDeleteLabel = onDelete ? (label: string) => onDelete(g.runId, label) : undefined
  const onViewLabel = (label: string) => onView(g.runId, label)
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="font-display text-[15px] font-bold tracking-tight">Version {g.number}</h3>
        {g.title && <span className="text-sm text-muted-foreground">{g.title}</span>}
        {g.createdAt && (
          <span
            className="text-xs text-muted-foreground/80"
            title={`Requested ${new Date(g.createdAt).toLocaleString()}`}
          >
            · requested {fmtRequested(g.createdAt)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {g.running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {g.ok}/{g.total} ready
          </span>
          {g.genMs > 0 && (
            <span title="Total image render time across this version's sizes">· {fmtTime(g.genMs)}</span>
          )}
          {g.running && onCancelRun && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCancelRun(g.runId)}
              title="Stop this generation"
              className="h-7 gap-1 border-destructive/40 px-2.5 text-destructive hover:bg-destructive/10"
            >
              <X className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          {g.ok > 0 && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2.5">
              <a
                href={versionZipUrl(g.runId, g.concept, g.number, g.title)}
                title={`Download all sizes of v${g.number} as a zip`}
              >
                <Download className="h-3.5 w-3.5" /> v{g.number}
              </a>
            </Button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {g.banners.map((b, i) => (
          <AssetCard
            key={b.label}
            b={b}
            version={g.number}
            index={i}
            onView={onViewLabel}
            onDelete={onDeleteLabel}
            selected={selected.has(`${g.runId}|${b.label}`)}
            onToggleSelect={() => onToggleSelect(g.runId, b.label)}
          />
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

function AssetCard({
  b,
  index = 0,
  onView,
  onDelete,
  selected = false,
  onToggleSelect,
}: {
  b: Banner
  version: number
  index?: number
  onView?: (label: string) => void
  onDelete?: (label: string) => void
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const tag = b.phase === 'master' ? 'master' : 'recomposed'
  const delay = { animationDelay: `${Math.min(index * 40, 400)}ms` }
  // If a banner the server reports "ok" fails to load (its PNG is gone), fall
  // through to a clean placeholder instead of a broken <img>.
  const [broken, setBroken] = useState(false)

  if (b.status === 'ok' && b.url && !broken) {
    const src = assetUrl(b.url)
    return (
      <div
        style={delay}
        className={cn(
          'group animate-fade-up overflow-hidden rounded-xl border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
          selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-foreground/20',
        )}
      >
        <div className="relative aspect-square" style={CHECKER}>
          <img
            src={src}
            alt={b.label}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />

          {/* Multi-select checkbox (top-left) — shows on hover, or always when selected */}
          {onToggleSelect && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect()
              }}
              title={selected ? 'Deselect' : 'Select'}
              aria-pressed={selected}
              className={cn(
                'absolute left-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border shadow transition-opacity',
                selected
                  ? 'border-primary bg-primary text-primary-foreground opacity-100'
                  : 'border-border bg-background/90 text-transparent opacity-0 group-hover:opacity-100',
              )}
            >
              <Check className="h-4 w-4" />
            </button>
          )}

          {/* Hover: a single icon to open the banner in view mode (delete/download live there) */}
          {onView && (
            <button
              type="button"
              onClick={() => onView(b.label)}
              title="Open"
              aria-label="Open banner"
              className="absolute inset-0 flex items-center justify-center bg-foreground/45 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg">
                <Maximize2 className="h-5 w-5" />
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-2.5 py-2 text-xs">
          <span className="font-display font-semibold">{b.size}</span>
          <Badge
            variant="outline"
            title={
              b.phase === 'master'
                ? 'The square master is generated first and seeds every other size'
                : undefined
            }
            className={cn(
              'text-[10px] font-normal',
              b.phase === 'master' ? 'border-primary/35 text-primary' : 'text-muted-foreground',
            )}
          >
            {tag}
          </Badge>
        </div>
      </div>
    )
  }

  return (
    <div
      style={delay}
      className="animate-fade-up overflow-hidden rounded-xl border border-dashed border-border bg-muted/40"
    >
      <div className="flex aspect-square flex-col items-center justify-center gap-1.5 p-3 text-center">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <StatusDot status={broken ? 'missing' : b.status} /> {b.size}
        </span>
        <span className="text-xs text-muted-foreground">{broken ? 'Image unavailable' : phLabel(b)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-border px-2.5 py-2 text-xs">
        <span className="font-display font-semibold text-muted-foreground">{b.size}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {tag}
          </Badge>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(b.label)}
              title="Remove"
              aria-label={`Delete ${b.size} banner`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
          ? 'bg-muted-foreground/70'
          : 'bg-destructive'
  return <span className={cn('h-2 w-2 rounded-full', cls)} />
}

function phLabel(b: Banner): string {
  if (b.status === 'pending') return 'Queued'
  if (b.status === 'running') return `Generating${b.attempts > 1 ? ` · attempt ${b.attempts}` : ''}…`
  if (b.status === 'missing') return 'Image unavailable'
  return b.error ? `${b.status}: ${b.error}` : b.status
}

function statusLabel(s: string): string {
  switch (s) {
    case 'queued':
      return 'Queued…'
    case 'classifying':
      return 'Reading the brief…'
    case 'directing':
      return 'Art-directing with GPT-5.5…'
    case 'evaluating':
      return 'Reviewing the result…'
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

function EmptyOutput({ onHelp }: { onHelp?: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8 animate-fade-up">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
          <ImageIcon className="h-6 w-6" />
        </div>
        <h3 className="font-display text-lg font-bold tracking-tight">Your banners will appear here</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Three steps and you're done — the AI fills in anything you leave blank.
        </p>
        <ol className="mx-auto mt-5 space-y-2 text-left">
          <QuickStep n={1}>
            Pick your <b className="font-semibold text-foreground">sizes</b> on the left
          </QuickStep>
          <QuickStep n={2}>
            Add a concept with a <b className="font-semibold text-foreground">Title</b> on the right
          </QuickStep>
          <QuickStep n={3}>
            Set <b className="font-semibold text-foreground">Art direction</b> (optional), then{' '}
            <b className="font-semibold text-foreground">Generate</b>
          </QuickStep>
        </ol>
        {onHelp && (
          <Button variant="outline" size="sm" className="mt-5" onClick={onHelp}>
            <HelpCircle className="h-4 w-4" /> How it works
          </Button>
        )}
      </div>
    </div>
  )
}

function QuickStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {n}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}

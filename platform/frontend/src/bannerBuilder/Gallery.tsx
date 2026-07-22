// Banner Library — the folder shelf, deliberately less detailed than the LP /
// CRM dashboards. Two levels of folders, then the banners:
//
//   Kind        Brokers · White Labels · Academies · Prop firms (+ Other)
//     Creative  one folder per Monday Creative Board item (id + name), plus
//               "Unfiled" for runs not yet filed
//       Banners the generated PNGs, grouped by their run
//
// White labels share styles, so every white-label run lands in the one
// "White Labels" folder — the kind is the folder, not the brand. A run's kind
// comes from its brand_id; its creative from the Monday link set in the build
// view or here via "File".

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, FolderOpen, Layers, Link2, Loader2, Search, Tag, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { assetUrl } from '../api'
import type { RunData, Banner } from '../types'
import {
  ENTITY_KINDS, kindOf, listBrands, type Brand, type EntityKind,
} from './brandsApi'
// (KIND_LABEL not reused here — the library labels kinds in the plural.)
import { listRuns, searchCreatives, setRunCreative, type Creative } from './campaignApi'

/** Kind order for the shelf; 'other' is appended for unbranded / unknown runs. */
type Bucket = EntityKind | 'other'
const KIND_ORDER: Bucket[] = [...ENTITY_KINDS, 'other']
const BUCKET_LABEL: Record<Bucket, string> = {
  broker: 'Brokers',
  whitelabel: 'White Labels',
  academy: 'Academies',
  prop: 'Prop firms',
  other: 'Other',
}

const UNFILED = '__unfiled__'

function okBanners(run: RunData): Banner[] {
  return (run.banners || []).filter((b) => b.status === 'ok' && b.url)
}

function runTitle(run: RunData): string {
  const b = (run.banners || []).find((x) => x.title)
  return b?.title || 'Untitled run'
}

export function BannerGallery({
  onOpenRun,
}: {
  /** Open a run in the build view's results pane. */
  onOpenRun: (runId: string) => void
}) {
  const [runs, setRuns] = useState<RunData[] | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [kind, setKind] = useState<Bucket | null>(null)
  const [creativeKey, setCreativeKey] = useState<string | null>(null)
  const [filing, setFiling] = useState<RunData | null>(null)

  const refresh = () => { listRuns().then((r) => setRuns(r ?? [])).catch(() => setRuns([])) }
  useEffect(() => {
    refresh()
    listBrands().then(setBrands).catch(() => { /* kinds fall back to Other */ })
  }, [])

  const brandById = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b])) as Record<string, Brand>,
    [brands],
  )
  const bucketOf = (run: RunData): Bucket => {
    const b = run.brand_id ? brandById[run.brand_id] : undefined
    return b ? kindOf(b) : 'other'
  }

  // Only runs with at least one finished banner belong in the library.
  const filled = useMemo(() => (runs ?? []).filter((r) => okBanners(r).length > 0), [runs])

  const byKind = useMemo(() => {
    const m = new Map<Bucket, RunData[]>()
    for (const r of filled) {
      const k = bucketOf(r)
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(r)
    }
    return m
  }, [filled, brandById])

  const bannerCount = (rs: RunData[]) => rs.reduce((n, r) => n + okBanners(r).length, 0)

  if (runs === null) {
    return (
      <GalleryShell>
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the library…
        </div>
      </GalleryShell>
    )
  }

  // ---- level 2: the runs inside one creative of one kind --------------------
  if (kind && creativeKey) {
    const inKind = byKind.get(kind) ?? []
    const runsHere = inKind.filter((r) => (r.monday_id || UNFILED) === creativeKey)
    const label = creativeKey === UNFILED
      ? 'Unfiled'
      : runsHere[0]?.creative_name || `#${creativeKey}`
    return (
      <GalleryShell>
        <Crumbs
          trail={[
            { label: 'Library', onClick: () => { setKind(null); setCreativeKey(null) } },
            { label: BUCKET_LABEL[kind], onClick: () => setCreativeKey(null) },
            { label },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {runsHere.map((r) => (
            <RunCard key={r.run_id} run={r} onOpen={() => onOpenRun(r.run_id)}
                     onFile={() => setFiling(r)} />
          ))}
        </div>
        {filing && (
          <FileModal run={filing} onClose={() => setFiling(null)}
                     onDone={() => { setFiling(null); refresh() }} />
        )}
      </GalleryShell>
    )
  }

  // ---- level 1: the creatives inside one kind -------------------------------
  if (kind) {
    const inKind = byKind.get(kind) ?? []
    const creatives = new Map<string, { name: string; runs: RunData[] }>()
    for (const r of inKind) {
      const key = r.monday_id || UNFILED
      const entry = creatives.get(key) ?? { name: r.creative_name || '', runs: [] }
      if (!entry.name && r.creative_name) entry.name = r.creative_name
      entry.runs.push(r)
      creatives.set(key, entry)
    }
    // Real creatives first (alpha), Unfiled last.
    const rows = [...creatives.entries()].sort((a, b) => {
      if (a[0] === UNFILED) return 1
      if (b[0] === UNFILED) return -1
      return (a[1].name || a[0]).localeCompare(b[1].name || b[0])
    })
    return (
      <GalleryShell>
        <Crumbs trail={[
          { label: 'Library', onClick: () => setKind(null) },
          { label: BUCKET_LABEL[kind] },
        ]} />
        {rows.length === 0 ? (
          <Empty>No banners in {BUCKET_LABEL[kind]} yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map(([key, entry]) => (
              <FolderCard
                key={key}
                icon={key === UNFILED ? <Layers className="h-5 w-5" /> : <Tag className="h-5 w-5" />}
                title={key === UNFILED ? 'Unfiled' : entry.name || `#${key}`}
                sub={key === UNFILED
                  ? `${bannerCount(entry.runs)} banner${bannerCount(entry.runs) === 1 ? '' : 's'} to file`
                  : `#${key} · ${bannerCount(entry.runs)} banner${bannerCount(entry.runs) === 1 ? '' : 's'}`}
                muted={key === UNFILED}
                onOpen={() => setCreativeKey(key)}
              />
            ))}
          </div>
        )}
      </GalleryShell>
    )
  }

  // ---- level 0: the kinds ---------------------------------------------------
  const kinds = KIND_ORDER.filter((k) => (byKind.get(k) ?? []).length > 0)
  return (
    <GalleryShell>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">Library</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Banners by entity kind, then by their Monday creative.
        </p>
      </div>
      {kinds.length === 0 ? (
        <Empty>No banners yet — generate some in the Build tab.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {kinds.map((k) => {
            const rs = byKind.get(k) ?? []
            const unfiled = rs.filter((r) => !r.monday_id).length
            return (
              <FolderCard
                key={k}
                icon={<FolderOpen className="h-5 w-5" />}
                title={BUCKET_LABEL[k]}
                sub={`${bannerCount(rs)} banner${bannerCount(rs) === 1 ? '' : 's'}`}
                badge={unfiled > 0 ? `${unfiled} unfiled` : undefined}
                onOpen={() => setKind(k)}
              />
            )
          })}
        </div>
      )}
    </GalleryShell>
  )
}

// ---- pieces -----------------------------------------------------------------

function GalleryShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function Crumbs({ trail }: { trail: { label: string; onClick?: () => void }[] }) {
  // Back goes up ONE level — to the parent crumb, not all the way to root.
  const up = trail[trail.length - 2]?.onClick
  return (
    <div className="mb-4 flex items-center gap-1.5 text-sm">
      {up && (
        <Button variant="ghost" size="icon" className="mr-1 h-7 w-7"
                onClick={up} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground/50">/</span>}
          {c.onClick ? (
            <button type="button" onClick={c.onClick}
                    className="text-muted-foreground hover:text-foreground hover:underline">
              {c.label}
            </button>
          ) : (
            <span className="font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}

function FolderCard({
  icon, title, sub, badge, muted, onOpen,
}: {
  icon: ReactNode
  title: string
  sub: string
  badge?: string
  muted?: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm',
        muted && 'border-dashed',
      )}
    >
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl',
        muted ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {icon}
      </span>
      <span className="mt-3 flex items-center gap-1.5">
        <span className="truncate font-display text-sm font-semibold">{title}</span>
        {badge && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</span>
    </button>
  )
}

function RunCard({
  run, onOpen, onFile,
}: {
  run: RunData
  onOpen: () => void
  onFile: () => void
}) {
  const banners = okBanners(run)
  const thumbs = banners.slice(0, 4)
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {thumbs.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={onOpen}
            className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary/40"
            title={b.size}
          >
            <img src={assetUrl(b.url as string)} alt="" loading="lazy"
                 className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{runTitle(run)}</span>
          <span className="block text-[11px] text-muted-foreground">
            {banners.length} banner{banners.length === 1 ? '' : 's'}
            {run.created_by ? ` · ${run.created_by.split('@')[0]}` : ''}
          </span>
        </span>
        <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={onFile}>
          <Link2 className="h-3.5 w-3.5" /> {run.monday_id ? 'Change' : 'File'}
        </Button>
      </div>
    </div>
  )
}

/** Search the Creative Board and file (or unfile) a run's creative. */
function FileModal({
  run, onClose, onDone,
}: {
  run: RunData
  onClose: () => void
  onDone: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Creative[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runSearch = () => {
    if (q.trim().length < 2) return
    setBusy(true); setError(null)
    searchCreatives(q)
      .then((items) => { setResults(items); if (!items.length) setError('Nothing on the Creative Board matches that.') })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const pick = (c: Creative) => {
    setBusy(true); setError(null)
    setRunCreative(run.run_id, c.id, c.name)
      .then(onDone)
      .catch((e) => { setError(e.message); setBusy(false) })
  }

  const unfile = () => {
    setBusy(true); setError(null)
    setRunCreative(run.run_id, '', '')
      .then(onDone)
      .catch((e) => { setError(e.message); setBusy(false) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-lg"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">File into a creative</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        {run.monday_id && (
          <p className="mt-1 text-xs text-muted-foreground">
            Currently filed under{' '}
            <span className="font-medium text-foreground">{run.creative_name || `#${run.monday_id}`}</span>.
          </p>
        )}
        <div className="mt-3 flex gap-1.5">
          <Input value={q} autoFocus
                 onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }}
                 className="h-9" placeholder="Search the Creative Board, or paste a Monday ID" />
          <Button variant="outline" className="h-9 shrink-0" disabled={busy || q.trim().length < 2}
                  onClick={runSearch}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {error && <p className="mt-2 text-[11px] text-muted-foreground">{error}</p>}
        {results && results.length > 0 && (
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {results.map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => pick(c)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/50">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{c.name}</span>
                {c.asset_type && (
                  <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                    {c.asset_type}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {run.monday_id && (
          <button type="button" onClick={unfile} disabled={busy}
                  className="mt-3 text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
            Remove from this creative
          </button>
        )}
      </div>
    </div>
  )
}

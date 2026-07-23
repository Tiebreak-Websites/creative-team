// Banner Library — the SAME shelf the LP Builder and CRM Emails open onto.
//
// Deliberately the same components (FolderGrid, kind sections, the stat row)
// rather than lookalikes: someone who has used Landing Pages or CRM Emails
// should not have to relearn this screen, and two copies of a folder drift
// apart. Kind sections (Brokers · Academies · Prop firms · White labels) hold
// one folder per brand; inside a folder the banners are grouped by their
// Monday creative — the Creative Board item (id + name) they were built for.
//
// Banners are working files, not an archive: runs auto-delete 14 days after
// creation (the finished assets live in the CreativeOPS catalogue), so the
// shelf reminds people to download in time.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, Clock, Layers, Link2, Loader2, Search, Tag, X,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { brandLogoSrc, useIsDark } from '@/lib/brandLogo'
import { FolderGrid, type FolderItem } from '@/components/FolderGrid'
import { assetUrl } from '../api'
import type { RunData, Banner } from '../types'
import {
  KIND_HINT, KIND_LABEL, kindOf, listBrands, type Brand, type EntityKind,
} from './brandsApi'
import { listRuns, searchCreatives, setRunCreative, type Creative } from './campaignApi'

/** Shelf order — same as the CRM dashboard: active kinds first, white labels
 *  parked last and collapsed by default. */
const KIND_ORDER: EntityKind[] = ['broker', 'academy', 'prop', 'whitelabel']
const COLLAPSED_KINDS = new Set<EntityKind>(['whitelabel'])

const UNFILED = '__unfiled__'

function okBanners(run: RunData): Banner[] {
  return (run.banners || []).filter((b) => b.status === 'ok' && b.url)
}

function runTitle(run: RunData): string {
  const b = (run.banners || []).find((x) => x.title)
  return b?.title || 'Untitled run'
}

function latestOf(items: { updated_at: string }[]): string {
  const sorted = items.map((i) => i.updated_at).sort()
  return sorted.length ? sorted[sorted.length - 1] : ''
}

export function BannerGallery({
  onOpenRun,
}: {
  /** Open a run in the build view's results pane. */
  onOpenRun: (runId: string) => void
}) {
  const dark = useIsDark()
  const [runs, setRuns] = useState<RunData[] | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  /** null = the folder shelf; a brand id = inside that folder; '' = "Other". */
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filing, setFiling] = useState<RunData | null>(null)
  /** Kind sections expanded past their default (white label starts collapsed). */
  const [openKinds, setOpenKinds] = useState<Set<EntityKind>>(new Set())

  const refresh = () => { listRuns().then((r) => setRuns(r ?? [])).catch(() => setRuns([])) }
  useEffect(() => {
    refresh()
    listBrands().then(setBrands).catch(() => { /* folders fall back to Other */ })
  }, [])

  const brandById = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b])) as Record<string, Brand>,
    [brands],
  )

  // Only runs with at least one finished banner belong in the library.
  const filled = useMemo(() => (runs ?? []).filter((r) => okBanners(r).length > 0), [runs])
  const bannerCount = (rs: RunData[]) => rs.reduce((n, r) => n + okBanners(r).length, 0)

  // One folder per brand, grouped into kind sections — the CRM shelf, with
  // banner counts. Every brand shows a folder even when empty? No: like the
  // LP/CRM shelf we list every ACTIVE brand so there's always a place to look,
  // but here empty folders would dominate (banners are transient), so only
  // brands that currently hold banners get a folder.
  const buckets = useMemo(() => {
    return KIND_ORDER.map((kind) => {
      const items: FolderItem[] = brands
        .filter((b) => kindOf(b) === kind)
        .map((b) => {
          const mine = filled.filter((r) => r.brand_id === b.id)
          return {
            id: b.id,
            name: b.name,
            brand: b,
            count: bannerCount(mine),
            latest: latestOf(mine),
          }
        })
        .filter((f) => f.count > 0)
      return { kind, items }
    }).filter((g) => g.items.length)
  }, [brands, filled])

  const orphans = useMemo(
    () => filled.filter((r) => !r.brand_id || !brandById[r.brand_id]),
    [filled, brandById],
  )

  if (runs === null) {
    return (
      <Shell>
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the library…
        </div>
      </Shell>
    )
  }

  // ------------------------------------------------------------ inside a folder
  if (folder !== null) {
    const brand = folder === '' ? null : brandById[folder]
    const inFolder = folder === '' ? orphans : filled.filter((r) => r.brand_id === folder)
    const q = query.trim().toLowerCase()
    const visible = q
      ? inFolder.filter((r) =>
          (r.creative_name || '').toLowerCase().includes(q)
          || (r.monday_id || '').includes(q)
          || runTitle(r).toLowerCase().includes(q))
      : inFolder

    // Group the folder's runs by their Monday creative; Unfiled last.
    const creatives = new Map<string, { name: string; runs: RunData[] }>()
    for (const r of visible) {
      const key = r.monday_id || UNFILED
      const entry = creatives.get(key) ?? { name: r.creative_name || '', runs: [] }
      if (!entry.name && r.creative_name) entry.name = r.creative_name
      entry.runs.push(r)
      creatives.set(key, entry)
    }
    const groups = [...creatives.entries()].sort((a, b) => {
      if (a[0] === UNFILED) return 1
      if (b[0] === UNFILED) return -1
      return (a[1].name || a[0]).localeCompare(b[1].name || b[0])
    })

    return (
      <Shell>
        <div className="mb-5 flex flex-wrap items-center gap-3 animate-fade-up">
          <Button variant="ghost" size="icon" onClick={() => { setFolder(null); setQuery('') }}
                  title="Back to folders" aria-label="Back to folders">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {brand?.logo_svg && (
            <img src={brandLogoSrc(brand, dark)} alt=""
                 className="h-8 max-w-32 rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5" />
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-bold tracking-tight">
              {brand?.name ?? 'Other'}
            </h1>
            <p className="text-xs text-muted-foreground">
              Banners in the {brand?.name ?? 'Other'} folder, grouped by Monday creative.
            </p>
          </div>
        </div>

        {inFolder.length > 3 && (
          <div className="relative mb-4 max-w-xs animate-fade-up">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)}
                   className="h-9 pl-8" placeholder="Search creatives…" />
          </div>
        )}

        {groups.length === 0 ? (
          <Empty>{query ? 'Nothing matches your search.' : 'This folder is empty.'}</Empty>
        ) : (
          <div className="space-y-6">
            {groups.map(([key, entry]) => (
              <section key={key}>
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {key === UNFILED
                    ? <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    : <Tag className="h-3.5 w-3.5 text-primary" />}
                  <h2 className="font-display text-sm font-semibold">
                    {key === UNFILED ? 'Unfiled' : entry.name || `#${key}`}
                  </h2>
                  {key !== UNFILED && (
                    <span className="rounded-full border border-border bg-secondary px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                      #{key}
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {bannerCount(entry.runs)} banner{bannerCount(entry.runs) === 1 ? '' : 's'}
                  </span>
                  {key === UNFILED && (
                    <span className="text-[11px] text-muted-foreground">
                      Not linked to a Monday creative yet — use File.
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {entry.runs.map((r) => (
                    <RunCard key={r.run_id} run={r} onOpen={() => onOpenRun(r.run_id)}
                             onFile={() => setFiling(r)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {filing && (
          <FileModal run={filing} onClose={() => setFiling(null)}
                     onDone={() => { setFiling(null); refresh() }} />
        )}
      </Shell>
    )
  }

  // --------------------------------------------------------------- folder shelf
  return (
    <Shell>
      <div className="mb-6 flex items-start gap-3 animate-fade-up">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Banner Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One folder per brand — inside, banners grouped by their Monday creative.
          </p>
        </div>
      </div>

      {/* Banners are transient here — the catalogue lives in CreativeOPS. */}
      <p className="mb-5 flex items-center gap-1.5 rounded-2xl border border-border bg-secondary/40 px-4 py-2.5 text-[11px] text-muted-foreground animate-fade-up">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Banners auto-delete 14 days after creation — download what you need and
        upload it to the CreativeOPS catalogue. Landing pages and emails are kept.
      </p>

      {buckets.length === 0 && orphans.length === 0 ? (
        <Empty>No banners yet — generate some in the Build tab.</Empty>
      ) : (
        <div className="space-y-6">
          {buckets.map(({ kind, items }) => {
            const startsCollapsed = COLLAPSED_KINDS.has(kind)
            const open = startsCollapsed ? openKinds.has(kind) : true
            const toggle = () =>
              setOpenKinds((cur) => {
                const next = new Set(cur)
                next.has(kind) ? next.delete(kind) : next.add(kind)
                return next
              })
            return (
              <section key={kind}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                  {startsCollapsed ? (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-expanded={open}
                      className="group -ml-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-secondary/60"
                    >
                      {open
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      <h2 className="font-display text-sm font-semibold">{KIND_LABEL[kind]}</h2>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                    </button>
                  ) : (
                    <>
                      <h2 className="font-display text-sm font-semibold">{KIND_LABEL[kind]}</h2>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                    </>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {startsCollapsed && !open ? 'Not in active use — click to show.' : KIND_HINT[kind]}
                  </span>
                </div>
                {open && (
                  <FolderGrid folders={items} dark={dark} noun="banner"
                              onOpen={(id) => setFolder(id)} />
                )}
              </section>
            )
          })}

          {orphans.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="font-display text-sm font-semibold">Other</h2>
                <span className="text-[11px] tabular-nums text-muted-foreground">{orphans.length}</span>
                <span className="text-[11px] text-muted-foreground">Runs with no brand set.</span>
              </div>
              <FolderGrid
                folders={[{ id: '', name: 'Other', brand: null, count: bannerCount(orphans),
                            latest: latestOf(orphans) }]}
                dark={dark} noun="banner" onOpen={() => setFolder('')}
              />
            </section>
          )}
        </div>
      )}
    </Shell>
  )
}

// ---- pieces -----------------------------------------------------------------

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
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
            {run.created_at &&
              ` · ${new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
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

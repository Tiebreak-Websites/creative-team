import { useEffect, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  Grid2x2,
  Grid3x3,
  ImageIcon,
  Layers,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Maximize2,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import type { Banner, RunData } from '../types'
import { assetUrl, versionZipUrl, zipAllUrl } from '../api'
import { BannerLibrary, type LibraryItem } from './BannerLibrary'
import type { SizeGroup } from './sizesApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatUserName } from '@/lib/utils'

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
  createdBy?: string
  approvalStatus?: string // awaiting | approved | rejected (from run.approval_state)
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
        createdBy: run.created_by,
        approvalStatus: run.approval_state?.[ck],
      })
    })
  }
  return groups
}

/** One generation = all concepts (versions) from a single run, grouped together. */
interface GenerationGroup {
  runId: string
  number: number
  name: string
  createdAt: string
  createdBy?: string
  concepts: ConceptGroup[]
}

/** Group the per-concept groups by run into "Generation N" blocks (newest first).
 * The number is chronological (oldest = 1) so it's stable as new runs arrive. */
function groupByGeneration(groups: ConceptGroup[]): GenerationGroup[] {
  const byRun = new Map<string, ConceptGroup[]>()
  const order: string[] = []
  for (const g of groups) {
    if (!byRun.has(g.runId)) {
      byRun.set(g.runId, [])
      order.push(g.runId)
    }
    byRun.get(g.runId)!.push(g)
  }
  const chrono = [...order].sort((a, b) =>
    byRun.get(a)![0].createdAt < byRun.get(b)![0].createdAt ? -1 : 1,
  )
  const numberOf = new Map(chrono.map((rid, i) => [rid, i + 1]))
  return order.map((rid) => {
    const cs = byRun.get(rid)!
    const n = numberOf.get(rid)!
    return {
      runId: rid,
      number: n,
      name: cs[0].title || '',
      createdAt: cs[0].createdAt,
      createdBy: cs[0].createdBy,
      concepts: cs,
    }
  })
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
  plannedSizes,
  masterSize,
  onDeleteBanner,
  onCancel,
  onCancelRun,
  myBannersOnly,
  onMyBannersToggle,
  currentUserEmail,
  isAdmin,
  onApprove,
  onReject,
  onRegenerate,
  onAddSizes,
  availableSizes,
  sizeGroups,
  onAddCustomSize,
  selected,
  onToggleSelect,
  onToggleVersion,
}: {
  runs: RunData[]
  /** Sizes ticked in the rail (master first) — the empty state previews them. */
  plannedSizes?: string[]
  masterSize?: string
  onDeleteBanner?: (runId: string, label: string) => void
  onCancel?: () => void
  onCancelRun?: (runId: string) => void
  myBannersOnly?: boolean
  onMyBannersToggle?: () => void
  currentUserEmail?: string
  isAdmin?: boolean
  onApprove?: (runId: string, concept: string) => void
  onReject?: (runId: string, concept: string) => void
  onRegenerate?: (runId: string, label: string, promptOverride?: string) => void
  /** Add more sizes to a version → recompose off its master. Owner-only. */
  onAddSizes?: (runId: string, concept: string, sizes: string[]) => void
  /** Every size the app can generate — the add-sizes picker offers these. */
  availableSizes?: string[]
  /** Shared size groups — the add-sizes picker mirrors the dashboard's rail. */
  sizeGroups?: SizeGroup[]
  /** Save a new custom size (shared); resolves to the normalized size or null. */
  onAddCustomSize?: (size: string) => Promise<string | null>
  // Selection is owned by the parent (BannerBuilder) so the central console can
  // swap to a selection console; the gallery just renders the checkboxes.
  selected: Set<string>
  onToggleSelect: (runId: string, label: string) => void
  onToggleVersion: (runId: string, labels: string[]) => void
}) {
  const [libOpen, setLibOpen] = useState(false)
  const [libIndex, setLibIndex] = useState(0)
  const [libItems, setLibItems] = useState<LibraryItem[]>([])
  const [libDownloadAll, setLibDownloadAll] = useState<string | undefined>(undefined)
  const [libApprove, setLibApprove] = useState<{ approve: () => void; reject: () => void } | null>(null)
  const [libRegen, setLibRegen] = useState<
    ((runId: string, label: string, promptOverride?: string) => void) | null
  >(null)
  // Add-sizes for the open version: the callback (owner-only) + the sizes it already has.
  const [libAddSizes, setLibAddSizes] = useState<((sizes: string[]) => void) | null>(null)
  const [libExistingSizes, setLibExistingSizes] = useState<string[]>([])
  const [libCanDelete, setLibCanDelete] = useState(true)
  // View prefs (persisted): batches (grouped) | all (flat grid) | list; tile size; collapse.
  const [viewMode, setViewMode] = useState<'grouped' | 'flat' | 'list'>(() => {
    try {
      const v = localStorage.getItem('bb:view-mode')
      return v === 'flat' || v === 'list' ? v : 'grouped'
    } catch {
      return 'grouped'
    }
  })
  const [tileSize, setTileSize] = useState<'small' | 'large'>(() => {
    try {
      return localStorage.getItem('bb:tile-size') === 'large' ? 'large' : 'small'
    } catch {
      return 'small'
    }
  })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('bb:collapsed-gens') || '[]'))
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('bb:view-mode', viewMode)
    } catch {
      /* best-effort */
    }
  }, [viewMode])
  useEffect(() => {
    try {
      localStorage.setItem('bb:tile-size', tileSize)
    } catch {
      /* best-effort */
    }
  }, [tileSize])
  useEffect(() => {
    try {
      localStorage.setItem('bb:collapsed-gens', JSON.stringify([...collapsed]))
    } catch {
      /* best-effort */
    }
  }, [collapsed])
  function toggleCollapsed(runId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }
  // One predicate gates every per-run action in the gallery (stop, approve,
  // reject, delete, regenerate): only the person who started a generation sees
  // those controls on it. Admins are included ONLY for legacy runs with no
  // recorded owner — for cross-user cleanup admins use the Disk Manager, and the
  // backend independently enforces this. So one user never sees an action control
  // on another user's banners.
  const canModify = (createdBy?: string) =>
    createdBy
      ? createdBy.toLowerCase() === (currentUserEmail || '').toLowerCase()
      : !!isAdmin
  const gridClass =
    tileSize === 'large'
      ? 'grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'
      : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
  if (!runs.length)
    return <EmptyOutput plannedSizes={plannedSizes} masterSize={masterSize}
                        myBannersOnly={myBannersOnly} onShowAll={onMyBannersToggle} />
  const groups = buildGroups(runs)
  const generations = groupByGeneration(groups)
  // Surface EVERY distinct run error, not just the first — otherwise a second
  // concurrent batch's quota/failure is masked by the first one's message.
  const runErrors = Array.from(new Set(runs.map((r) => r.error).filter((e): e is string => !!e)))

  const styleByRun = new Map(runs.map((r) => [r.run_id, r.style ?? '']))
  // Run-level metadata for the detail view (same for every size in a run).
  const metaByRun = new Map(
    runs.map((r) => [
      r.run_id,
      {
        model: r.model,
        quality: r.quality,
        effort: r.director?.effort,
        createdAt: r.created_at,
        artTags: r.art_tags ?? [],
      },
    ]),
  )
  // The viewable (ok) banners of ONE version → lightbox items. The lightbox is
  // scoped to a single version, so its filmstrip shows only that version's sizes.
  function versionItems(g: ConceptGroup): LibraryItem[] {
    return g.banners
      .filter((b) => b.status === 'ok' && b.url)
      .map((b) => {
        const slug = slugify(b.title)
        const fileName = `v${g.number}-${b.size}${slug ? `-${slug}` : ''}`
        const src = assetUrl(b.url as string)
        return {
          label: b.label,
          runId: g.runId,
          concept: g.concept,
          approvalStatus: g.approvalStatus,
          createdBy: g.createdBy,
          src,
          downloadHref: `${src}?download=1&name=${encodeURIComponent(fileName)}`,
          webHref: b.web_url
            ? `${assetUrl(b.web_url)}?download=1&name=${encodeURIComponent(fileName)}`
            : undefined,
          size: b.size,
          version: g.number,
          title: g.title,
          subtitle: b.subtitle,
          button: b.button,
          brief: b.brief,
          prompt: b.prompt ?? undefined,
          promptOverride: b.prompt_override ?? undefined,
          qa: b.qa ?? null,
          style: styleByRun.get(g.runId) ?? '',
          genMs: b.gen_ms ?? null,
          model: metaByRun.get(g.runId)?.model,
          quality: metaByRun.get(g.runId)?.quality,
          effort: metaByRun.get(g.runId)?.effort,
          createdAt: metaByRun.get(g.runId)?.createdAt,
          artTags: metaByRun.get(g.runId)?.artTags ?? [],
        }
      })
  }
  function openLibrary(runId: string, label: string) {
    // Scope the lightbox to the clicked banner's version (its concept group) so
    // the filmstrip + prev/next walk only that version's sizes — not all history.
    const g = groups.find((gr) => gr.runId === runId && gr.banners.some((b) => b.label === label))
    if (!g) return
    const items = versionItems(g)
    const i = items.findIndex((it) => it.label === label)
    if (i < 0) return
    setLibItems(items)
    setLibDownloadAll(items.length > 1 ? versionZipUrl(g.runId, g.concept, g.number, g.title) : undefined)
    setLibApprove(
      g.approvalStatus === 'awaiting' && canModify(g.createdBy)
        ? {
            approve: () => {
              onApprove?.(g.runId, g.concept)
              setLibOpen(false)
            },
            reject: () => {
              onReject?.(g.runId, g.concept)
              setLibOpen(false)
            },
          }
        : null,
    )
    // Regenerate + delete are owner-only too: only expose them when the viewer
    // owns this version, matching the backend guard.
    const owned = canModify(g.createdBy)
    // Wrap in an updater so React stores the function instead of calling it.
    setLibRegen(() => (owned && onRegenerate ? onRegenerate : null))
    // Add-sizes: owner-only, and never for a rejected version (it stays MVP-only).
    const canAddSizes = owned && !!onAddSizes && g.approvalStatus !== 'rejected'
    setLibAddSizes(() =>
      canAddSizes ? (sizes: string[]) => onAddSizes?.(g.runId, g.concept, sizes) : null,
    )
    // Every size this version already has (any status), so the picker hides them.
    setLibExistingSizes(Array.from(new Set(g.banners.map((b) => b.size))))
    setLibCanDelete(owned)
    setLibIndex(i)
    setLibOpen(true)
  }

  // Selection (toggleSelect / toggleVersion) is owned by the parent; the selection
  // actions live in the central selection console, not a top bar here.

  return (
    <div className="flex min-h-full flex-col animate-fade-in">
      <div className="sticky top-0 z-10 bg-card">
        <OverviewBar
          runs={runs}
          onCancel={onCancel}
          myBannersOnly={myBannersOnly}
          onMyBannersToggle={onMyBannersToggle}
          currentUserEmail={currentUserEmail}
          isAdmin={isAdmin}
          viewMode={viewMode}
          onViewMode={setViewMode}
          tileSize={tileSize}
          onTileSize={setTileSize}
        />
      </div>
      <div className="space-y-7 p-5">
        {runErrors.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="font-medium">
              {runErrors.length === 1
                ? 'A generation ran into a problem.'
                : `${runErrors.length} generations ran into problems.`}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer select-none text-xs opacity-80 hover:opacity-100">
                Show details
              </summary>
              <ul className="mt-1 space-y-1">
                {runErrors.map((e, i) => (
                  <li key={i} className="whitespace-pre-wrap break-words font-mono text-xs opacity-90">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        {viewMode === 'grouped' &&
          generations.map((gen) => (
            <GenerationSection
              key={gen.runId}
              gen={gen}
              collapsed={collapsed.has(gen.runId)}
              onToggleCollapse={() => toggleCollapsed(gen.runId)}
              gridClass={gridClass}
              onView={openLibrary}
              onDelete={canModify(gen.createdBy) ? onDeleteBanner : undefined}
              onCancelRun={onCancelRun}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onToggleVersion={onToggleVersion}
              owner={canModify(gen.createdBy)}
              canCancel={canModify(gen.createdBy)}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        {viewMode === 'flat' && (
          <div className={cn('grid gap-3', gridClass)}>
            {groups.flatMap((g) =>
              g.banners.map((b) => (
                <AssetCard
                  key={`${g.runId}|${b.label}`}
                  b={b}
                  version={g.number}
                  onView={(label) => openLibrary(g.runId, label)}
                  onDelete={onDeleteBanner && canModify(g.createdBy) ? (label) => onDeleteBanner(g.runId, label) : undefined}
                  selected={selected.has(`${g.runId}|${b.label}`)}
                  onToggleSelect={() => onToggleSelect(g.runId, b.label)}
                />
              )),
            )}
          </div>
        )}
        {viewMode === 'list' && (
          <div className="overflow-hidden rounded-xl border border-border">
            {groups.flatMap((g) =>
              g.banners.map((b) => (
                <AssetListRow
                  key={`${g.runId}|${b.label}`}
                  b={b}
                  version={g.number}
                  onView={() => openLibrary(g.runId, b.label)}
                  onDelete={onDeleteBanner && canModify(g.createdBy) ? () => onDeleteBanner(g.runId, b.label) : undefined}
                  selected={selected.has(`${g.runId}|${b.label}`)}
                  onToggleSelect={() => onToggleSelect(g.runId, b.label)}
                />
              )),
            )}
          </div>
        )}
      </div>
      <BannerLibrary
        open={libOpen}
        items={libItems}
        index={libIndex}
        onIndexChange={setLibIndex}
        onClose={() => setLibOpen(false)}
        onDelete={libCanDelete ? (runId, label) => onDeleteBanner?.(runId, label) : undefined}
        downloadAllHref={libDownloadAll}
        onApprove={libApprove?.approve}
        onReject={libApprove?.reject}
        onRegenerate={libRegen ?? undefined}
        onAddSizes={libAddSizes ?? undefined}
        availableSizes={availableSizes}
        sizeGroups={sizeGroups}
        onAddCustomSize={onAddCustomSize}
        existingSizes={libExistingSizes}
      />
    </div>
  )
}

function OverviewBar({
  runs,
  onCancel,
  myBannersOnly,
  onMyBannersToggle,
  currentUserEmail,
  isAdmin,
  viewMode,
  onViewMode,
  tileSize,
  onTileSize,
}: {
  runs: RunData[]
  onCancel?: () => void
  myBannersOnly?: boolean
  onMyBannersToggle?: () => void
  currentUserEmail?: string
  isAdmin?: boolean
  viewMode: 'grouped' | 'flat' | 'list'
  onViewMode: (v: 'grouped' | 'flat' | 'list') => void
  tileSize: 'small' | 'large'
  onTileSize: (s: 'small' | 'large') => void
}) {
  const viewModes = [
    { v: 'grouped' as const, label: 'Batches', icon: <Layers className="h-4 w-4" /> },
    { v: 'flat' as const, label: 'All', icon: <LayoutGrid className="h-4 w-4" /> },
    { v: 'list' as const, label: 'List', icon: <ListIcon className="h-4 w-4" /> },
  ]
  const tileSizes = [
    { v: 'small' as const, label: 'Small', icon: <Grid3x3 className="h-4 w-4" /> },
    { v: 'large' as const, label: 'Large', icon: <Grid2x2 className="h-4 w-4" /> },
  ]
  const seg = 'inline-flex shrink-0 items-center rounded-lg border border-border bg-secondary p-0.5'
  // The active option in each group lights up in the primary (blue) colour.
  const segBtn = (on: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
      on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    )
  const Divider = () => <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
  // Progress reflects ONLY the currently-generating runs (the current task) —
  // not the historical total of every run in the gallery.
  const activeRuns = runs.filter((r) => RUNNING.includes(r.status))
  const activeCount = activeRuns.length
  // "Stop all" only governs the current user's own in-flight runs — never
  // anyone else's (admins included, except for legacy runs with no owner).
  const myActiveCount = activeRuns.filter((r) =>
    r.created_by
      ? r.created_by.toLowerCase() === (currentUserEmail || '').toLowerCase()
      : !!isAdmin,
  ).length
  const total = activeRuns.reduce((a, r) => a + r.total, 0)
  const ready = activeRuns.reduce((a, r) => a + r.completed, 0)
  const pct = total ? Math.round((ready / total) * 100) : 0
  const running = activeCount > 0
  // Pre-render phases (queued/classifying/art-direction) finish no frames for a
  // while — show an animated indeterminate bar so it reads as "working", not 0%.
  const preRender = running && ready === 0
  // The status is shown ONLY while something is generating (with the current
  // stage). Idle labels like "Awaiting your approval" / "All banners ready"
  // were noise — run errors surface in the alert box below instead.
  const label = running
    ? activeCount > 1
      ? `Generating ${activeCount} batches…`
      : statusLabel(activeRuns[0].status)
    : ''

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-5 py-3">
      {running && (
        <span
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 font-display text-sm font-semibold"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {label}
        </span>
      )}

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

      {/* Organizing tools — view | tile size | sort. Active option lit blue, groups
          separated by dividers. */}
      <div className={seg}>
        {viewModes.map((m) => (
          <button
            key={m.v}
            type="button"
            onClick={() => onViewMode(m.v)}
            title={`${m.label} view`}
            className={segBtn(viewMode === m.v)}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {viewMode !== 'list' && (
        <>
          <Divider />
          <div className={seg}>
            {tileSizes.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={() => onTileSize(s.v)}
                title={`${s.label} tiles`}
                className={segBtn(tileSize === s.v)}
              >
                {s.icon}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {onMyBannersToggle && (
        <>
          <Divider />
          <div className={seg}>
            <button
              type="button"
              onClick={() => myBannersOnly && onMyBannersToggle()}
              title="Show everyone’s banners"
              className={segBtn(!myBannersOnly)}
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Everyone</span>
            </button>
            <button
              type="button"
              onClick={() => !myBannersOnly && onMyBannersToggle()}
              title="Show only your banners"
              className={segBtn(!!myBannersOnly)}
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Mine</span>
            </button>
          </div>
        </>
      )}

      {myActiveCount > 1 && onCancel && (
        <>
          <Divider />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={onCancel}
            title="Stop all of your running generations"
          >
            <X className="h-4 w-4" /> Stop all
          </Button>
        </>
      )}
    </div>
  )
}

function GenerationSection({
  gen,
  collapsed,
  onToggleCollapse,
  gridClass,
  onView,
  onDelete,
  onCancelRun,
  selected,
  onToggleSelect,
  onToggleVersion,
  owner,
  canCancel,
  onApprove,
  onReject,
}: {
  gen: GenerationGroup
  collapsed: boolean
  onToggleCollapse: () => void
  gridClass?: string
  onView: (runId: string, label: string) => void
  onDelete?: (runId: string, label: string) => void
  onCancelRun?: (runId: string) => void
  selected: Set<string>
  onToggleSelect: (runId: string, label: string) => void
  onToggleVersion?: (runId: string, labels: string[]) => void
  owner?: boolean
  canCancel?: boolean
  onApprove?: (runId: string, concept: string) => void
  onReject?: (runId: string, concept: string) => void
}) {
  const hasOk = gen.concepts.some((c) => c.ok > 0)
  return (
    <section className="rounded-2xl border border-border bg-card/40">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex min-w-0 items-center gap-2 text-left"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')}
          />
          <span className="font-display text-[15px] font-bold tracking-tight">Generation {gen.number}</span>
        </button>
        {gen.name && <span className="truncate text-sm text-muted-foreground">{gen.name}</span>}
        {gen.createdAt && (
          <span className="text-xs text-muted-foreground/80" title={`Requested ${new Date(gen.createdAt).toLocaleString()}`}>
            · {fmtRequested(gen.createdAt)}
          </span>
        )}
        {gen.createdBy && (
          <span className="text-xs text-muted-foreground/80" title={gen.createdBy}>
            · by {formatUserName(gen.createdBy)}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {gen.concepts.length} version{gen.concepts.length === 1 ? '' : 's'}
        </span>
        {hasOk && (
          <Button asChild size="sm" variant="outline" className="h-7 px-2.5">
            <a href={zipAllUrl([gen.runId])} title="Download this whole generation as a zip">
              <Download className="h-3.5 w-3.5" /> All
            </a>
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          {gen.concepts.map((g) => (
            <ConceptGroupBlock
              key={g.id}
              g={g}
              gridClass={gridClass}
              onView={onView}
              onDelete={onDelete}
              onCancelRun={onCancelRun}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onToggleVersion={onToggleVersion}
              owner={owner}
              canCancel={canCancel}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AssetListRow({
  b,
  version,
  onView,
  onDelete,
  selected,
  onToggleSelect,
}: {
  b: Banner
  version: number
  onView: () => void
  onDelete?: () => void
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const ok = b.status === 'ok' && b.url
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0',
        selected && 'bg-primary/5',
      )}
    >
      {onToggleSelect && (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          title={selected ? 'Deselect' : 'Select'}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-transparent hover:border-foreground/40',
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border" style={CHECKER}>
        {ok ? (
          <img src={assetUrl(b.url as string)} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : null}
      </span>
      <span className="font-display text-sm font-semibold">{b.size}</span>
      <span className="rounded border border-primary/30 px-1 text-[10px] text-primary">v{version}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{b.title}</span>
      {ok && (
        <button type="button" onClick={onView} title="Open" aria-label="Open banner" className="text-muted-foreground hover:text-foreground">
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} title="Delete" aria-label="Delete banner" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
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
  onToggleVersion,
  owner,
  canCancel,
  onApprove,
  onReject,
  gridClass,
}: {
  g: ConceptGroup
  onView: (runId: string, label: string) => void
  onDelete?: (runId: string, label: string) => void
  onCancelRun?: (runId: string) => void
  selected: Set<string>
  onToggleSelect: (runId: string, label: string) => void
  onToggleVersion?: (runId: string, labels: string[]) => void
  owner?: boolean
  canCancel?: boolean
  onApprove?: (runId: string, concept: string) => void
  onReject?: (runId: string, concept: string) => void
  gridClass?: string
}) {
  // Bind this group's run id so view + delete are scoped to the right run.
  const onDeleteLabel = onDelete ? (label: string) => onDelete(g.runId, label) : undefined
  const onViewLabel = (label: string) => onView(g.runId, label)
  // Whole-version selection: every banner in this version selected together.
  const labels = g.banners.map((b) => b.label)
  const allSelected = labels.length > 0 && labels.every((l) => selected.has(`${g.runId}|${l}`))
  const someSelected = !allSelected && labels.some((l) => selected.has(`${g.runId}|${l}`))
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {onToggleVersion && (
          <button
            type="button"
            onClick={() => onToggleVersion(g.runId, labels)}
            title={allSelected ? 'Deselect this whole version' : 'Select this whole version'}
            aria-label={`Select all of version ${g.number}`}
            aria-pressed={allSelected}
            className={cn(
              'inline-flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-md border transition-colors',
              allSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : someSelected
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border bg-secondary text-transparent hover:border-primary/50',
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        <h3 className="font-display text-[15px] font-bold tracking-tight">Version {g.number}</h3>
        {g.title && <span className="text-sm text-muted-foreground">{g.title}</span>}
        {/* Requested time + author intentionally omitted here — both are already
            shown once on the Generation header, so repeating them per version is
            redundant. Approval-state pills ("Awaiting approval" / "Approved" /
            "Rejected") were removed on request: status text only appears while
            something is generating. The Approve/Reject buttons below still show
            whenever a decision is actually needed. */}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {g.running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {g.ok}/{g.total} ready
          </span>
          {g.genMs > 0 && (
            <span title="Total image render time across this version's sizes">· {fmtTime(g.genMs)}</span>
          )}
          {g.approvalStatus === 'awaiting' && owner && onApprove && (
            <>
              <Button
                size="sm"
                onClick={() => onReject?.(g.runId, g.concept)}
                title="Reject — keep the MVP only, skip the other sizes"
                className="h-7 gap-1 bg-destructive px-2.5 text-destructive-foreground hover:bg-destructive/90"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
              <Button
                size="sm"
                onClick={() => onApprove(g.runId, g.concept)}
                title="Approve — recompose this version into all selected sizes"
                className="h-7 gap-1 bg-emerald-600 px-2.5 text-white hover:bg-emerald-700"
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            </>
          )}
          {g.running && onCancelRun && canCancel && (
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
        </span>
      </div>
      <div className={cn('grid gap-3', gridClass ?? 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]')}>
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

          {/* Delete (top-right) — shows on hover */}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(b.label)
              }}
              title="Delete this banner"
              aria-label="Delete banner"
              className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-0 shadow transition-colors hover:border-destructive hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

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
          <div className="flex items-center gap-1.5">
            {b.qa && (
              <span
                title={`Heads up: ${b.qa}`}
                aria-label={`Quality check: ${b.qa}`}
                className="inline-flex items-center text-amber-500"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            )}
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
      </div>
    )
  }

  const generating = !broken && (b.status === 'pending' || b.status === 'running')
  return (
    <div
      style={delay}
      className="relative animate-fade-up overflow-hidden rounded-xl border border-dashed border-border bg-muted/40"
    >
      {/* Breathing gradient bar across the top while this banner is generating. */}
      {generating && <span aria-hidden className="tb-breathe absolute inset-x-0 top-0 z-10 h-1" />}
      <div className="relative flex aspect-square flex-col items-center justify-center gap-1.5 p-3 text-center">
        <span
          title={broken ? 'Image unavailable' : phLabel(b)}
          className={cn(
            'absolute right-2 top-2 h-3 w-3 rounded-full shadow ring-2 ring-background',
            cornerDotClass(broken ? 'missing' : b.status),
          )}
        />
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

/** Top-corner banner status dot: green = ready, amber = generating, red = problem. */
function cornerDotClass(status: string): string {
  if (status === 'ok') return 'bg-emerald-500'
  if (status === 'running' || status === 'pending') return 'animate-pulse bg-amber-400'
  return 'bg-destructive'
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
    case 'awaiting_approval':
      return 'Awaiting your approval'
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

function EmptyOutput({
  plannedSizes = [],
  masterSize,
  myBannersOnly,
  onShowAll,
}: {
  /** The sizes currently ticked in the rail (master first) — the empty state
   *  previews them as ghost frames and redraws live as sizes are toggled. */
  plannedSizes?: string[]
  masterSize?: string
  myBannersOnly?: boolean
  onShowAll?: () => void
}) {
  // True-ratio thumbnails: fit each WxH inside a 220x150 box, floors keeping
  // even a 728x90 leaderboard or 160x600 skyscraper legible.
  const frames = plannedSizes.flatMap((s) => {
    const m = /^(\d+)x(\d+)$/.exec(s)
    if (!m) return []
    const w = Number(m[1]), h = Number(m[2])
    const k = Math.min(220 / w, 150 / h)
    return [{ size: s, w: Math.max(48, Math.round(w * k)), h: Math.max(34, Math.round(h * k)) }]
  })
  return (
    <div className="flex h-full items-center justify-center p-8 animate-fade-up">
      <div className="w-full max-w-2xl text-center">
        <div className="flex flex-wrap items-end justify-center gap-3">
          {frames.map((f, i) => {
            const roomy = f.w >= 90 && f.h >= 64
            return (
              <div
                key={f.size}
                className="relative flex animate-fade-up items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-gradient-to-br from-secondary/80 to-secondary/25"
                style={{ width: f.w, height: f.h, animationDelay: `${Math.min(i * 60, 480)}ms` }}
              >
                {roomy && (
                  <ImageIcon className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/20" />
                )}
                <span
                  className={cn(
                    'text-[9px] font-medium tabular-nums text-muted-foreground/80',
                    roomy && 'absolute inset-x-0 bottom-1',
                  )}
                >
                  {f.size}
                </span>
                {f.size === masterSize && roomy && (
                  <span className="absolute left-1 top-1 rounded bg-primary/90 px-1 py-px text-[8px] font-bold leading-3 text-primary-foreground">
                    Master
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          {frames.length} size{frames.length === 1 ? '' : 's'} selected
        </p>
        {myBannersOnly && onShowAll && (
          <div>
            <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-muted-foreground" onClick={onShowAll}>
              <Users className="h-4 w-4" /> Showing only yours — show everyone’s
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

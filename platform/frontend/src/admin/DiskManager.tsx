import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  HardDrive,
  ImageIcon,
  Layers,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { Banner, RunData } from '../types'
import { assetUrl, bulkDelete, fetchStorage, type StorageInfo } from '../api'
import { listRuns } from '../bannerBuilder/campaignApi'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { cn, formatUserName } from '@/lib/utils'

/** Subtle checkerboard so transparent PNGs read against any theme. */
const CHECKER: CSSProperties = {
  backgroundImage:
    'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)',
  backgroundSize: '16px 16px',
}

type SortKey = 'date' | 'size' | 'name'
type SortDir = 'asc' | 'desc'
type ViewMode = 'gallery' | 'list'

/** One run (batch) flattened into the fields the manager sorts + displays on. */
interface RunRow {
  run: RunData
  title: string
  okBanners: Banner[]
  bytes: number
  date: number
}

type Confirm =
  | { kind: 'run'; runId: string; title: string; bytes: number; count: number }
  | {
      kind: 'bulk'
      runs: string[]
      banners: { runId: string; label: string }[]
      bytes: number
      label: string
    }

function human(b: number): string {
  if (!b) return '0 B'
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`
  return `${b} B`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const bkey = (runId: string, label: string) => `${runId}|${label}`

function toRow(run: RunData): RunRow {
  const okBanners = run.banners.filter((b) => b.status === 'ok' && b.url)
  const bytes = run.banners.reduce((a, b) => a + (b.bytes || 0), 0)
  const title = run.banners.find((b) => b.title)?.title || run.run_id
  const date = new Date(run.created_at).getTime() || 0
  return { run, title, okBanners, bytes, date }
}

/**
 * Admin Disk Manager — browse, sort, and delete the banner creatives that live on
 * the mounted Render disk. Single banners, whole batches (runs), or a multi-selected
 * mix; every delete unlinks the real files server-side and reports the bytes freed.
 * Gallery + list views, sortable by date / size / name (asc + desc).
 */
export function DiskManager() {
  const [runs, setRuns] = useState<RunData[]>([])
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [view, setView] = useState<ViewMode>('list') // default: list, newest first
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [selRuns, setSelRuns] = useState<Set<string>>(new Set())
  const [selBanners, setSelBanners] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  async function refresh() {
    setError(null)
    const [rs, st] = await Promise.all([listRuns(), fetchStorage().catch(() => null)])
    if (st) setStorage(st)
    if (rs) {
      setRuns(rs)
      // Drop any selection pointing at things that no longer exist on disk, so the
      // action bar never counts stale items after a refresh/delete.
      const runIds = new Set(rs.map((r) => r.run_id))
      const banIds = new Set(rs.flatMap((r) => r.banners.map((b) => bkey(r.run_id, b.label))))
      setSelRuns((prev) => new Set([...prev].filter((id) => runIds.has(id))))
      setSelBanners((prev) => new Set([...prev].filter((k) => banIds.has(k))))
    }
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-dismiss the "freed X" notice.
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(t)
  }, [notice])

  const rows = useMemo(() => {
    const mapped = runs.map(toRow)
    mapped.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = a.date - b.date
      else if (sortKey === 'size') cmp = a.bytes - b.bytes
      else cmp = a.title.localeCompare(b.title)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return mapped
  }, [runs, sortKey, sortDir])

  const totalBanners = rows.reduce((a, r) => a + r.okBanners.length, 0)
  const totalBytes = rows.reduce((a, r) => a + r.bytes, 0)

  const isRunSel = (id: string) => selRuns.has(id)
  const isBanSel = (runId: string, label: string) =>
    selRuns.has(runId) || selBanners.has(bkey(runId, label))

  function toggleRun(id: string) {
    setSelRuns((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // A whole-run selection supersedes individual banner picks within it.
    setSelBanners((prev) => {
      const next = new Set<string>()
      prev.forEach((k) => {
        if (!k.startsWith(`${id}|`)) next.add(k)
      })
      return next
    })
  }

  function toggleBanner(runId: string, label: string) {
    if (selRuns.has(runId)) return // covered by the whole-run selection
    setSelBanners((prev) => {
      const next = new Set(prev)
      const k = bkey(runId, label)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSel() {
    setSelRuns(new Set())
    setSelBanners(new Set())
  }

  const selCount = selRuns.size + selBanners.size
  const selLabel = [
    selRuns.size ? `${selRuns.size} batch${selRuns.size === 1 ? '' : 'es'}` : '',
    selBanners.size ? `${selBanners.size} banner${selBanners.size === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' + ')

  const selEstBytes = useMemo(() => {
    let total = 0
    for (const r of rows) {
      if (selRuns.has(r.run.run_id)) {
        total += r.bytes
      } else {
        for (const b of r.run.banners) {
          if (selBanners.has(bkey(r.run.run_id, b.label))) total += b.bytes || 0
        }
      }
    }
    return total
  }, [rows, selRuns, selBanners])

  // ---- delete execution -----------------------------------------------------
  async function runDelete(runsArr: string[], bannersArr: { runId: string; label: string }[]) {
    setBusy(true)
    setError(null)
    try {
      const res = await bulkDelete({ runs: runsArr, banners: bannersArr })
      const bits: string[] = []
      if (res.deleted_runs) bits.push(`${res.deleted_runs} batch${res.deleted_runs === 1 ? '' : 'es'}`)
      if (res.deleted_banners)
        bits.push(`${res.deleted_banners} banner${res.deleted_banners === 1 ? '' : 's'}`)
      setNotice(
        `Freed ${human(res.freed_bytes)}${bits.length ? ` — removed ${bits.join(' and ')}` : ''}.`,
      )
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  /** Single banner — cheap + frequent, so it deletes immediately (no confirm). */
  function deleteOneBanner(runId: string, label: string) {
    void runDelete([], [{ runId, label }])
  }

  function askDeleteRun(r: RunRow) {
    setConfirm({
      kind: 'run',
      runId: r.run.run_id,
      title: r.title,
      bytes: r.bytes,
      count: r.okBanners.length,
    })
  }

  function askDeleteSelected() {
    const runsArr = [...selRuns]
    const bannersArr = [...selBanners].map((k) => {
      const i = k.indexOf('|')
      return { runId: k.slice(0, i), label: k.slice(i + 1) }
    })
    setConfirm({ kind: 'bulk', runs: runsArr, banners: bannersArr, bytes: selEstBytes, label: selLabel })
  }

  function doConfirm() {
    if (!confirm) return
    if (confirm.kind === 'run') void runDelete([confirm.runId], [])
    else void runDelete(confirm.runs, confirm.banners)
  }

  // ---- render ---------------------------------------------------------------
  const pct =
    storage && storage.total_bytes
      ? Math.min(100, Math.round((storage.used_bytes / storage.total_bytes) * 100))
      : 0
  const barTone = pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-amber-500' : 'bg-primary'

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <HardDrive className="h-4 w-4 text-primary" /> Disk Manager
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse, sort, and delete generated creatives. Deletes remove the real files from the
            shared disk — freeing space for everyone.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading || busy}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', (loading || busy) && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* Two columns: a NARROW vertical metrics rail on the left, the banner
          content on the right (the metrics deliberately give up width). */}
      <div className="flex items-start gap-5">
      <div className="sticky top-4 w-52 shrink-0 space-y-3">
        <Stat
          icon={<HardDrive className="h-4 w-4" />}
          label="Disk used"
          value={storage ? `${human(storage.used_bytes)} / ${human(storage.total_bytes)}` : '—'}
          big
        >
          {storage && storage.total_bytes > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-full rounded-full', barTone)} style={{ width: `${pct}%` }} />
            </div>
          )}
        </Stat>
        <Stat
          icon={<HardDrive className="h-4 w-4" />}
          label="Disk free"
          value={storage ? human(storage.free_bytes) : '—'}
          big
        />
        <Stat icon={<Layers className="h-4 w-4" />} label="Batches" value={String(rows.length)} big />
        <Stat
          icon={<ImageIcon className="h-4 w-4" />}
          label="Banners"
          value={`${totalBanners} · ${human(totalBytes)}`}
          big
        />
      </div>

      <div className="min-w-0 flex-1 space-y-5">
      {/* Notices */}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
          <Check className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Toolbar: view + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={[
            { value: 'gallery', label: 'Gallery', icon: <LayoutGrid className="h-4 w-4" /> },
            { value: 'list', label: 'List', icon: <ListIcon className="h-4 w-4" /> },
          ]}
          value={view}
          onChange={(v) => setView(v as ViewMode)}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground sm:inline">Sort</span>
          <Segmented
            options={[
              { value: 'date', label: 'Date' },
              { value: 'size', label: 'Size' },
              { value: 'name', label: 'Name' },
            ]}
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
          />
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
            aria-label="Toggle sort direction"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-foreground transition-colors hover:border-foreground/25"
          >
            {sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Selection action bar */}
      {selCount > 0 && (
        <div className="flex animate-pop-in flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
          <span className="font-display text-sm font-semibold text-primary">
            {selLabel} selected
          </span>
          <span className="text-xs text-muted-foreground">~{human(selEstBytes)}</span>
          <Button
            size="sm"
            className="ml-auto gap-1.5"
            variant="outline"
            onClick={askDeleteSelected}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" /> Delete selected
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSel} disabled={busy}>
            Clear
          </Button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <HardDrive className="h-6 w-6" />
          </div>
          <p className="font-display text-sm font-semibold text-foreground">Nothing on the disk yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Generated banners will appear here, ready to sort and clean up.
          </p>
        </div>
      ) : view === 'gallery' ? (
        <div className="space-y-6">
          {rows.map((r) => (
            <GalleryCard
              key={r.run.run_id}
              r={r}
              runSel={isRunSel(r.run.run_id)}
              isBanSel={isBanSel}
              onToggleRun={toggleRun}
              onToggleBanner={toggleBanner}
              onDeleteRun={askDeleteRun}
              onDeleteBanner={deleteOneBanner}
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[2rem_1fr_5rem_6rem_8rem_2.5rem] items-center gap-2 border-b border-border bg-secondary/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span />
            <span>Name</span>
            <span className="text-right">Images</span>
            <span className="text-right">Size</span>
            <span>Date</span>
            <span />
          </div>
          {rows.map((r) => (
            <ListRow
              key={r.run.run_id}
              r={r}
              runSel={isRunSel(r.run.run_id)}
              expanded={expanded.has(r.run.run_id)}
              isBanSel={isBanSel}
              onToggleRun={toggleRun}
              onToggleBanner={toggleBanner}
              onToggleExpand={toggleExpand}
              onDeleteRun={askDeleteRun}
              onDeleteBanner={deleteOneBanner}
              busy={busy}
            />
          ))}
        </div>
      )}
      </div>
      </div>

      {/* Confirm modal */}
      <Modal
        open={!!confirm}
        onClose={() => (busy ? undefined : setConfirm(null))}
        title="Delete from disk?"
        description="This permanently removes the files from the shared disk and can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doConfirm}
              disabled={busy}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </>
        }
      >
        {confirm?.kind === 'run' ? (
          <p className="text-sm text-foreground">
            Delete the entire batch{' '}
            <span className="font-semibold">“{confirm.title}”</span> — {confirm.count}{' '}
            image{confirm.count === 1 ? '' : 's'} (~{human(confirm.bytes)}) will be removed from the
            disk.
          </p>
        ) : confirm?.kind === 'bulk' ? (
          <p className="text-sm text-foreground">
            Delete <span className="font-semibold">{confirm.label}</span> — about{' '}
            {human(confirm.bytes)} will be freed from the disk.
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Stat({
  icon,
  label,
  value,
  children,
  big,
}: {
  icon: ReactNode
  label: string
  value: string
  children?: ReactNode
  /** Larger value text for the vertical metrics rail. */
  big?: boolean
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card', big ? 'p-4' : 'p-3')}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className={cn('mt-1 font-display font-semibold tabular-nums text-foreground',
                         big ? 'text-lg leading-tight' : 'text-sm')}>
        {value}
      </div>
      {children}
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: ReactNode }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-secondary p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-display text-[13px] font-medium transition-colors',
              on
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Top-left selection checkbox shared by run headers and banner tiles/rows. */
function SelectBox({
  checked,
  disabled,
  onClick,
  className,
}: {
  checked: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={checked ? 'Deselect' : 'Select'}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-transparent hover:border-foreground/40',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  )
}

function GalleryCard({
  r,
  runSel,
  isBanSel,
  onToggleRun,
  onToggleBanner,
  onDeleteRun,
  onDeleteBanner,
  busy,
}: {
  r: RunRow
  runSel: boolean
  isBanSel: (runId: string, label: string) => boolean
  onToggleRun: (id: string) => void
  onToggleBanner: (runId: string, label: string) => void
  onDeleteRun: (r: RunRow) => void
  onDeleteBanner: (runId: string, label: string) => void
  busy: boolean
}) {
  const runId = r.run.run_id
  return (
    <section
      className={cn(
        'rounded-2xl border bg-card p-4 transition-colors',
        runSel ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SelectBox checked={runSel} onClick={() => onToggleRun(runId)} />
        <h3 className="font-display text-[15px] font-bold tracking-tight">{r.title}</h3>
        <span className="text-xs text-muted-foreground">{fmtDate(r.run.created_at)}</span>
        {r.run.created_by && (
          <span className="text-xs text-muted-foreground" title={r.run.created_by}>
            · by {formatUserName(r.run.created_by)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          · {r.okBanners.length} image{r.okBanners.length === 1 ? '' : 's'} · {human(r.bytes)}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1 border-destructive/40 px-2.5 text-destructive hover:bg-destructive/10"
          onClick={() => onDeleteRun(r)}
          disabled={busy}
          title="Delete this whole batch from the disk"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete batch
        </Button>
      </div>
      {r.okBanners.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No images on disk for this batch.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {r.okBanners.map((b) => (
            <Thumb
              key={b.label}
              b={b}
              selected={isBanSel(runId, b.label)}
              locked={runSel}
              onToggle={() => onToggleBanner(runId, b.label)}
              onDelete={() => onDeleteBanner(runId, b.label)}
              busy={busy}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function Thumb({
  b,
  selected,
  locked,
  onToggle,
  onDelete,
  busy,
}: {
  b: Banner
  selected: boolean
  locked: boolean // whole-run selected → individual toggle disabled
  onToggle: () => void
  onDelete: () => void
  busy: boolean
}) {
  const [broken, setBroken] = useState(false)
  const src = assetUrl(b.url as string)
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-foreground/20',
      )}
    >
      <div className="relative aspect-square" style={CHECKER}>
        {broken ? (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
            unavailable
          </div>
        ) : (
          <img
            src={src}
            alt={b.label}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        )}
        <SelectBox
          checked={selected}
          disabled={locked}
          onClick={onToggle}
          className={cn(
            'absolute left-2 top-2 z-10 shadow',
            !selected && 'opacity-0 group-hover:opacity-100',
          )}
        />
        {!locked && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            title="Delete this banner from the disk"
            aria-label="Delete banner"
            className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-0 shadow transition-colors hover:border-destructive hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5 text-xs">
        <span className="font-display font-semibold">{b.size}</span>
        <span className="tabular-nums text-muted-foreground">{human(b.bytes || 0)}</span>
      </div>
    </div>
  )
}

function ListRow({
  r,
  runSel,
  expanded,
  isBanSel,
  onToggleRun,
  onToggleBanner,
  onToggleExpand,
  onDeleteRun,
  onDeleteBanner,
  busy,
}: {
  r: RunRow
  runSel: boolean
  expanded: boolean
  isBanSel: (runId: string, label: string) => boolean
  onToggleRun: (id: string) => void
  onToggleBanner: (runId: string, label: string) => void
  onToggleExpand: (id: string) => void
  onDeleteRun: (r: RunRow) => void
  onDeleteBanner: (runId: string, label: string) => void
  busy: boolean
}) {
  const runId = r.run.run_id
  return (
    <div className={cn('border-b border-border last:border-b-0', runSel && 'bg-primary/5')}>
      <div className="grid grid-cols-[2rem_1fr_5rem_6rem_8rem_2.5rem] items-center gap-2 px-3 py-2 text-sm">
        <SelectBox checked={runSel} onClick={() => onToggleRun(runId)} />
        <button
          type="button"
          onClick={() => onToggleExpand(runId)}
          className="flex min-w-0 items-center gap-1.5 text-left"
          title={expanded ? 'Collapse' : 'Expand to see banners'}
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
          />
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-medium text-foreground">{r.title}</span>
            {r.run.created_by && (
              <span className="block truncate text-[11px] text-muted-foreground" title={r.run.created_by}>
                by {formatUserName(r.run.created_by)}
              </span>
            )}
          </span>
        </button>
        <span className="text-right tabular-nums text-muted-foreground">{r.okBanners.length}</span>
        <span className="text-right tabular-nums text-muted-foreground">{human(r.bytes)}</span>
        <span className="truncate text-xs text-muted-foreground">{fmtDate(r.run.created_at)}</span>
        <button
          type="button"
          onClick={() => onDeleteRun(r)}
          disabled={busy}
          title="Delete this whole batch from the disk"
          aria-label="Delete batch"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {expanded && (
        <div className="space-y-1 px-3 pb-2.5 pl-10">
          {r.okBanners.length === 0 ? (
            <p className="text-xs text-muted-foreground">No images on disk for this batch.</p>
          ) : (
            r.okBanners.map((b) => (
              <div
                key={b.label}
                className="grid grid-cols-[1.5rem_1fr_6rem_2.5rem] items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs"
              >
                <SelectBox
                  checked={isBanSel(runId, b.label)}
                  disabled={runSel}
                  onClick={() => onToggleBanner(runId, b.label)}
                  className="h-4 w-4"
                />
                <span className="font-display font-semibold text-foreground">{b.size}</span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {human(b.bytes || 0)}
                </span>
                {!runSel ? (
                  <button
                    type="button"
                    onClick={() => onDeleteBanner(runId, b.label)}
                    disabled={busy}
                    title="Delete this banner from the disk"
                    aria-label="Delete banner"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from 'lucide-react'
import type { Meta, RunData, Tool } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { ApiError, cancelRun, deleteBanner as deleteBannerApi, getRun, uploadReferences } from '../api'
import { createRun, listRuns } from './campaignApi'
import type { CampaignRunRequest } from './campaignApi'
import { OutputPane } from './Results'
import {
  ArtDirectionModal,
  artActiveCount,
  composeArtDirection,
  DEFAULT_ART,
  isArtActive,
  type ArtDirection,
} from './artDirection'
import { loadBrand } from './brand'
import { detectLocale } from './detectLocale'
import { listBrands, type Brand } from './brandsApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** A concept card as the user edits it: Title (required), Subtitle, Button. */
interface ConceptCard {
  key: string
  title: string
  subtitle: string
  button: string
}

// Languages for the on-image copy. `cc` is the ISO country code for the
// flag-icons set (real flags — emoji flags don't render on Windows).
export const LOCALES = [
  { value: 'en', label: 'English', short: 'EN', cc: 'gb' },
  { value: 'es-419', label: 'Spanish (LatAm)', short: 'ES', cc: 'mx' },
  { value: 'pt', label: 'Portuguese', short: 'PT', cc: 'pt' },
  { value: 'sv', label: 'Swedish', short: 'SV', cc: 'se' },
  { value: 'ja', label: 'Japanese', short: 'JA', cc: 'jp' },
  { value: 'th', label: 'Thai', short: 'TH', cc: 'th' },
  { value: 'pl', label: 'Polish', short: 'PL', cc: 'pl' },
  { value: 'zh', label: 'Chinese', short: 'ZH', cc: 'cn' },
  { value: 'ar', label: 'Arabic', short: 'AR', cc: 'sa' },
  { value: 'it', label: 'Italian', short: 'IT', cc: 'it' },
  { value: 'de', label: 'German', short: 'DE', cc: 'de' },
]

export const MODEL_LABELS: Record<string, string> = {
  'gpt-image-2': 'GPT-2',
  'gpt-image-1-mini': 'GPT-1',
}
export const QUALITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }

// Per-platform size groups (from the team's master size sheet). Only sizes the
// backend supports render; any supported size not listed falls into "Other".
const PLATFORMS: { label: string; sizes: string[] }[] = [
  { label: 'Most used', sizes: ['1200x674', '1200x1200', '1200x800', '1200x628', '960x1200', '1080x1080', '1080x1920', '1440x1800'] },
  { label: 'Meta · Facebook · Instagram', sizes: ['1080x1080', '1080x1350', '1080x1920', '1200x628', '1440x1800'] },
  { label: 'X · Twitter', sizes: ['1080x1080', '1200x628'] },
  { label: 'Google · Display', sizes: ['1200x628', '1200x1200', '1200x300', '512x128', '600x600'] },
  { label: 'Google · Demand Gen', sizes: ['1200x628', '1200x1200', '960x1200'] },
  { label: 'Google · Performance Max', sizes: ['1200x628', '1200x1200', '1200x300', '960x1200'] },
  { label: 'Google · App', sizes: ['1200x628', '1200x1500', '1200x1200'] },
  { label: 'Google · Search', sizes: ['1200x1200', '1200x628'] },
  { label: 'Google · Video · YouTube', sizes: ['1920x1080', '1080x1920', '1080x1080', '1280x720', '300x60'] },
  { label: 'Snapchat', sizes: ['1080x1920', '800x800', '720x1280'] },
  { label: 'Taboola', sizes: ['1200x674'] },
  { label: 'Outbrain', sizes: ['1200x1200'] },
  { label: 'MGID', sizes: ['1200x800'] },
  { label: 'AdsKeeper', sizes: ['1200x800'] },
  { label: 'PropellerAds', sizes: ['1200x800'] },
  { label: 'Criteo · Display', sizes: ['300x250', '728x90', '160x600', '300x600', '970x250', '320x50'] },
  { label: 'Criteo · Native', sizes: ['600x600', '600x315', '600x500'] },
]

// Compact control button used inside the floating command bar.
const BAR_BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 font-display text-[13px] font-medium text-foreground transition-colors hover:border-foreground/25'

let uid = 0
function blankCard(): ConceptCard {
  uid += 1
  return { key: `k${uid}`, title: '', subtitle: '', button: '' }
}

// Accumulated run ids live in the URL (?runs=a,b,c) so a page refresh restores
// every batch from the backend (which still holds the runs + PNGs on disk).
const RUNS_PARAM = 'runs'

function readRunIdsFromUrl(): string[] {
  try {
    const p = new URLSearchParams(window.location.search)
    const multi = p.get(RUNS_PARAM)
    if (multi) return multi.split(',').map((s) => s.trim()).filter(Boolean)
    const legacy = p.get('run')
    return legacy ? [legacy] : []
  } catch {
    return []
  }
}

function writeRunIdsToUrl(ids: string[]) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('run')
    if (ids.length) url.searchParams.set(RUNS_PARAM, ids.join(','))
    else url.searchParams.delete(RUNS_PARAM)
    window.history.replaceState(null, '', url.toString())
  } catch {
    /* best-effort */
  }
}

// Also mirror run ids + a results snapshot to localStorage so the gallery
// survives a reload OR a tab switch (component unmount), even if the URL is
// cleared. The backend still owns the PNGs; the snapshot lets us re-render
// instantly and then refresh. (A backend restart can still drop the runs.)
const RUNS_LS_KEY = 'bb:runs'
const SNAP_LS_KEY = 'bb:runs:snapshot'

function readRunIdsFromStore(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RUNS_LS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function persistRunIds(ids: string[]) {
  writeRunIdsToUrl(ids)
  try {
    localStorage.setItem(RUNS_LS_KEY, JSON.stringify(ids))
  } catch {
    /* best-effort */
  }
}

function readSnapshot(): RunData[] {
  try {
    const v = JSON.parse(localStorage.getItem(SNAP_LS_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function writeSnapshot(runs: RunData[]) {
  try {
    localStorage.setItem(SNAP_LS_KEY, JSON.stringify(runs))
  } catch {
    /* quota / serialization — best-effort */
  }
}

export function BannerBuilder({ meta }: { tool: Tool; meta: Meta }) {
  // ---- Campaign settings ----
  const efforts = meta.thinking_efforts ?? [
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extended' },
  ]
  const [brand] = useState(loadBrand)
  const [sizes, setSizes] = useState<Set<string>>(new Set([meta.master_size]))
  const [model, setModel] = useState(
    brand.model && meta.models.includes(brand.model) ? brand.model : meta.models[0] ?? 'gpt-image-2',
  )
  const [quality, setQuality] = useState(
    brand.quality && meta.qualities.includes(brand.quality)
      ? brand.quality
      : meta.default_quality ?? meta.qualities[meta.qualities.length - 1] ?? 'high',
  )
  const [effort, setEffort] = useState(meta.default_effort ?? 'high')
  const [locale, setLocale] = useState(
    LOCALES.some((l) => l.value === brand.locale) ? (brand.locale as string) : 'en',
  )
  // Auto-detect the concept language and pick the matching locale, until the
  // user makes an explicit choice (then we stop overriding).
  const [localeAuto, setLocaleAuto] = useState(true)
  const [style, setStyle] = useState('')
  const [art, setArt] = useState<ArtDirection>({
    ...DEFAULT_ART,
    scene: brand.scene,
    text: brand.text,
    colorMood: brand.colorMood,
  })
  const [artOpen, setArtOpen] = useState(false)
  const patchArt = (patch: Partial<ArtDirection>) => setArt((a) => ({ ...a, ...patch }))
  const currentLocale = LOCALES.find((l) => l.value === locale) ?? LOCALES[0]
  const localeLabel = currentLocale.label

  // Sizes UI: collapsible platform groups + global search.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Most used']))
  const [sizeQuery, setSizeQuery] = useState('')

  // Floating command bar popovers.
  const [barPopover, setBarPopover] = useState<null | 'model' | 'brand' | 'lang'>(null)

  // Style-reference images (uploaded → ids sent with the run; visual only).
  const [refs, setRefs] = useState<{ id: string; url: string }[]>([])
  const [refBusy, setRefBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Brands (palette + optional corner logo). Loaded from the brands API.
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string>('')
  // null = let the AI Builder decide placement automatically.
  const [logoCorner, setLogoCorner] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null)

  // ---- Concept cards ----
  const [cards, setCards] = useState<ConceptCard[]>([blankCard()])

  const [formError, setFormError] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<{ env: string; label: string; docs_url: string }[] | null>(null)

  const [runs, setRuns] = useState<RunData[]>(() => readSnapshot())
  const [polling, setPolling] = useState(false)
  const runsRef = useRef<RunData[]>(runs)
  runsRef.current = runs

  // Mirror runs to localStorage so a reload or tab switch restores instantly.
  useEffect(() => {
    writeSnapshot(runs)
  }, [runs])

  // Delete a banner for EVERYONE: ask the server to remove the PNG from the disk
  // and drop it from the run, then optimistically remove it from the local
  // gallery. Deletes are now shared (no per-user localStorage hide).
  function deleteBanner(runId: string, label: string) {
    void deleteBannerApi(runId, label)
    setRuns((prev) =>
      prev
        .map((r) => (r.run_id === runId ? { ...r, banners: r.banners.filter((b) => b.label !== label) } : r))
        .filter((r) => r.banners.length > 0 || !TERMINAL_STATUSES.includes(r.status)),
    )
  }
  const visibleRuns = useMemo(
    // Keep an active run visible even with no banners yet (so progress shows);
    // hide finished, fully-emptied runs.
    () => runs.filter((r) => r.banners.length > 0 || !TERMINAL_STATUSES.includes(r.status)),
    [runs],
  )

  // Poll every non-terminal run until all reach a terminal status.
  useEffect(() => {
    if (!polling) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      const active = runsRef.current.filter((r) => !TERMINAL_STATUSES.includes(r.status))
      if (active.length === 0) {
        if (!cancelled) setPolling(false)
        return
      }
      const results = await Promise.all(active.map((r) => getRun(r.run_id).catch(() => null)))
      if (cancelled) return
      const byId = new Map<string, RunData>()
      results.forEach((d) => {
        if (d) byId.set(d.run_id, d)
      })
      if (byId.size) setRuns((prev) => prev.map((r) => byId.get(r.run_id) ?? r))
      timer = window.setTimeout(tick, 2000)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [polling])

  // Restore previous batches after a reload / tab switch. Ids come from the URL
  // (?runs=) and/or localStorage; the snapshot already seeded `runs` for an
  // instant paint, and we re-fetch here to refresh each run's status.
  useEffect(() => {
    const ids = Array.from(new Set([...readRunIdsFromUrl(), ...readRunIdsFromStore()]))
    if (ids.length === 0) return
    let alive = true
    ;(async () => {
      const settled = await Promise.all(
        ids.map((id) =>
          getRun(id)
            .then((data) => ({ id, data: data as RunData | null, gone: false }))
            .catch((e) => ({ id, data: null, gone: e instanceof ApiError && e.status === 404 })),
        ),
      )
      if (!alive) return
      const restored = settled.filter((s) => s.data).map((s) => s.data as RunData)
      if (restored.length) {
        setRuns((prev) => {
          const have = new Set(prev.map((r) => r.run_id))
          const updated = prev.map((r) => restored.find((x) => x.run_id === r.run_id) ?? r)
          const brandNew = restored.filter((r) => !have.has(r.run_id))
          return brandNew.length ? [...brandNew, ...updated] : updated
        })
        if (restored.some((r) => !TERMINAL_STATUSES.includes(r.status))) setPolling(true)
      }
      const keepIds = ids.filter((id) => !settled.find((s) => s.id === id && s.gone))
      const existing = runsRef.current.map((r) => r.run_id)
      persistRunIds(Array.from(new Set([...keepIds, ...existing])))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-pick the locale from the typed concept text (until the user chooses).
  useEffect(() => {
    if (!localeAuto) return
    const text = cards.map((c) => `${c.title} ${c.subtitle}`).join(' ')
    const d = detectLocale(text)
    if (d && LOCALES.some((l) => l.value === d)) {
      setLocale(d)
    }
  }, [cards, localeAuto])

  // Load brands once for the brand selector.
  useEffect(() => {
    listBrands()
      .then(setBrands)
      .catch(() => {})
  }, [])

  // Shared gallery: load ALL runs from the server on mount so every logged-in
  // user sees every generated banner — not just the ones in their own browser.
  // The backend persists runs to the durable disk and rehydrates them on start.
  useEffect(() => {
    listRuns().then((serverRuns) => {
      if (!serverRuns.length) return
      setRuns((prev) => {
        const byId = new Map<string, RunData>()
        serverRuns.forEach((r) => byId.set(r.run_id, r))
        // Keep any local runs the server doesn't know yet (just-started, not persisted).
        prev.forEach((r) => {
          if (!byId.has(r.run_id)) byId.set(r.run_id, r)
        })
        // Oldest-first; OutputPane reverses for a newest-first display.
        return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      })
      if (serverRuns.some((r) => !TERMINAL_STATUSES.includes(r.status))) setPolling(true)
    })
  }, [])

  const running = runs.some((r) => !TERMINAL_STATUSES.includes(r.status))

  // ---- Sizes ----
  function toggleSize(s: string) {
    if (s === meta.master_size) return // master always on
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function renderSizeChip(s: string) {
    const isMaster = s === meta.master_size
    const on = sizes.has(s)
    return (
      <button
        key={s}
        type="button"
        onClick={() => toggleSize(s)}
        title={isMaster ? 'MVP — always generated first' : ''}
        className={cn(
          'flex items-center justify-between rounded-md border px-2.5 py-1.5 font-display text-[12px] font-semibold transition-colors',
          on
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border bg-secondary text-muted-foreground hover:border-foreground/25 hover:text-foreground',
          isMaster && 'cursor-default',
        )}
      >
        <span>{s}</span>
        {isMaster && (
          <span className="rounded bg-primary px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-primary-foreground">
            MVP
          </span>
        )}
      </button>
    )
  }

  // ---- Cards: add / remove / reorder ----
  function updateCard(key: string, patch: Partial<ConceptCard>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }
  function addCard() {
    setCards((prev) => (prev.length >= 5 ? prev : [...prev, blankCard()]))
  }
  function removeCard(key: string) {
    setCards((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.key !== key)))
  }
  function moveCard(index: number, dir: -1 | 1) {
    setCards((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  // ---- Drag to reorder ----
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  function onDrop(index: number) {
    setCards((prev) => {
      if (dragIndex === null || dragIndex === index) return prev
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  const canRun = cards.length > 0 && cards.every((c) => c.title.trim().length > 0)
  const selectedSizes = Array.from(sizes)
  const selectedBrand = brands.find((b) => b.id === brandId)

  // Stop every still-running batch. We ask the backend to cancel AND optimistically
  // settle the run locally so the user is NEVER trapped in the spinner — even if the
  // backend is slow or wedged, `running` flips false immediately and they can start a
  // new generation. (A reload re-fetches real status, so finished banners aren't lost.)
  function cancelRuns() {
    const active = runsRef.current.filter((r) => !TERMINAL_STATUSES.includes(r.status))
    active.forEach((r) => cancelRun(r.run_id))
    setRuns((prev) =>
      prev.map((r) => (TERMINAL_STATUSES.includes(r.status) ? r : { ...r, status: 'cancelled' })),
    )
    setPolling(false)
  }

  // Upload dropped/picked reference images (max 4); store ids + local previews.
  async function addRefs(files: FileList | null) {
    if (!files || !files.length) return
    const list = Array.from(files).slice(0, 4 - refs.length)
    if (!list.length) return
    setRefBusy(true)
    try {
      const ids = await uploadReferences(list)
      setRefs((prev) =>
        [...prev, ...ids.map((id, i) => ({ id, url: URL.createObjectURL(list[i]) }))].slice(0, 4),
      )
    } catch {
      /* upload failure is non-fatal — the run just won't include those refs */
    } finally {
      setRefBusy(false)
    }
  }
  function removeRef(id: string) {
    setRefs((prev) => prev.filter((r) => r.id !== id))
  }

  async function startRun() {
    setFormError(null)
    setFormErrors([])
    setMissing(null)
    const composed = composeArtDirection(art, localeLabel)
    const finalStyle = [style.trim(), composed].filter(Boolean).join(' — ')
    const payload: CampaignRunRequest = {
      model,
      quality,
      effort,
      locale: locale.trim() || 'en',
      sizes: Array.from(sizes),
      style: finalStyle || undefined,
      concepts: cards.map((c, i) => {
        const p: CampaignRunRequest['concepts'][number] = { key: `c${i + 1}`, title: c.title.trim() }
        if (c.subtitle.trim()) p.subtitle = c.subtitle.trim()
        if (c.button.trim()) p.button = c.button.trim()
        return p
      }),
      references: refs.length ? refs.map((r) => r.id) : undefined,
      brand_id: brandId || undefined,
      logo_corner: brandId && selectedBrand?.logo_svg && logoCorner ? logoCorner : undefined,
    }
    try {
      const initial = await createRun(payload)
      const ids = [...runsRef.current.map((r) => r.run_id), initial.run_id]
      setRuns((prev) => [...prev, initial])
      setPolling(true)
      persistRunIds(ids)
    } catch (e) {
      if (e instanceof ApiError && e.status === 424) setMissing(e.missingSecrets ?? [])
      else if (e instanceof ApiError && e.errors) setFormErrors(e.errors)
      else setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- Left: sizes ---------------- */}
      <aside className="flex w-[320px] shrink-0 flex-col bg-card animate-fade-in">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <h2 className="font-display text-sm font-bold tracking-tight text-foreground">Banner Sizes</h2>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={sizeQuery}
              onChange={(e) => setSizeQuery(e.target.value)}
              placeholder="Search sizes — e.g. 1080, 728x90"
              className="h-8 w-full rounded-md border border-input bg-secondary pl-8 pr-7 text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
            {sizeQuery && (
              <button
                type="button"
                onClick={() => setSizeQuery('')}
                title="Clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {sizeQuery.trim() ? (
            (() => {
              const q = sizeQuery.trim().toLowerCase()
              const matches = meta.sizes.filter((s) => s.toLowerCase().includes(q))
              return matches.length ? (
                <div className="grid grid-cols-2 gap-2">{matches.map(renderSizeChip)}</div>
              ) : (
                <p className="px-1 py-1 text-xs text-muted-foreground">No sizes match “{sizeQuery}”.</p>
              )
            })()
          ) : (
            <div className="space-y-1.5">
              {(() => {
                const grouped = new Set(PLATFORMS.flatMap((p) => p.sizes))
                const other = meta.sizes.filter((s) => !grouped.has(s))
                const groups = other.length ? [...PLATFORMS, { label: 'Other', sizes: other }] : PLATFORMS
                return groups.map((p) => {
                  const avail = p.sizes.filter((s) => meta.sizes.includes(s))
                  if (!avail.length) return null
                  const open = openGroups.has(p.label)
                  const selCount = avail.filter((s) => sizes.has(s)).length
                  return (
                    <div key={p.label} className="overflow-hidden rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => toggleGroup(p.label)}
                        className="flex w-full items-center justify-between bg-secondary/50 px-3 py-2 text-left transition-colors hover:bg-secondary"
                      >
                        <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">
                          {p.label}
                        </span>
                        <span className="flex items-center gap-2">
                          {selCount > 0 && (
                            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                              {selCount}
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-muted-foreground transition-transform',
                              open && 'rotate-180',
                            )}
                          />
                        </span>
                      </button>
                      {open && <div className="grid grid-cols-2 gap-2 p-2">{avail.map(renderSizeChip)}</div>}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- Center: results + floating command bar ---------------- */}
      <section className="relative min-h-0 flex-1 bg-background">
        <div className="h-full overflow-y-auto pb-56">
          <OutputPane runs={visibleRuns} onDeleteBanner={deleteBanner} onCancel={cancelRuns} />
        </div>

        {/* click-away backdrop for the bar popovers */}
        {barPopover && (
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setBarPopover(null)}
            className="fixed inset-0 z-30 cursor-default"
          />
        )}

        <div className="absolute inset-x-0 bottom-5 z-40 flex flex-col items-center gap-2 px-4">
          {(missing || formError || formErrors.length > 0) && (
            <div className="w-full max-w-md space-y-2">
              {missing && (
                <Alert tone="warn">
                  A required key is missing: {missing.map((s) => s.label).join(', ')}. Set it in the
                  server <code>.env</code>.
                </Alert>
              )}
              {formError && <Alert tone="err">{formError}</Alert>}
              {formErrors.length > 0 && (
                <Alert tone="err">
                  <div className="font-medium">Couldn't proceed:</div>
                  <ul className="mt-1 list-disc pl-4">
                    {formErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          )}

          {/* Selected sizes — surfaced in the central console */}
          {selectedSizes.length > 0 && (
            <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2">
              {selectedSizes.map((s) => {
                const isMaster = s === meta.master_size
                return (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-3.5 pr-2 font-display text-[13px] font-semibold text-primary"
                  >
                    {s}
                    {isMaster ? (
                      <span className="rounded bg-primary px-1.5 py-0.5 text-[9px] uppercase text-primary-foreground">MVP</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSize(s)}
                        title="Remove size"
                        className="text-primary/70 hover:text-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragOver) setDragOver(true)
            }}
            onDragLeave={(e) => {
              // Only clear when the cursor actually leaves the console, not when
              // it moves over a child element.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addRefs(e.dataTransfer.files)
            }}
            className={cn(
              'relative flex w-full max-w-3xl flex-col gap-2 rounded-2xl border bg-card/95 p-2 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.75)] backdrop-blur-md transition-colors',
              dragOver ? 'border-primary' : 'border-border',
            )}
          >
            {/* Drag-and-drop overlay — references are visual style only */}
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-primary bg-card/95 px-4 text-center backdrop-blur-md">
                <ImagePlus className="h-6 w-6 text-primary" />
                <span className="font-display text-sm font-semibold text-foreground">Drop images</span>
                <span className="text-[11px] text-muted-foreground">
                  used as style reference only (visual style, not text)
                </span>
              </div>
            )}

            {/* Row 1 — prompt + a square reference tile (matches the prompt height;
                shows attached images, with a grid for multiples) */}
            <div className="flex items-stretch gap-2">
              <Textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                rows={2}
                placeholder="Describe the banners in your own words — or open the Art Director →"
                className="w-full flex-1 resize-none"
              />
              {(() => {
                const cellCount = refs.length + (refs.length < 4 ? 1 : 0)
                const gridCls =
                  cellCount <= 1
                    ? 'grid-cols-1'
                    : cellCount === 2
                      ? 'grid-cols-2 grid-rows-1'
                      : 'grid-cols-2 grid-rows-2'
                return (
                  <div
                    title="Style-reference images (visual style only — text is ignored). Click or drag & drop."
                    className={cn(
                      'grid h-[60px] w-[60px] shrink-0 gap-0.5 self-start overflow-hidden rounded-xl border bg-secondary',
                      gridCls,
                      refs.length > 0 ? 'border-primary/50' : 'border-border',
                    )}
                  >
                    {refs.slice(0, 4).map((r) => (
                      <span key={r.id} className="group relative overflow-hidden bg-background">
                        <img src={r.url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeRef(r.id)}
                          title="Remove reference"
                          className="absolute right-0.5 top-0.5 hidden rounded bg-foreground/70 p-0.5 text-background group-hover:block"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {refs.length < 4 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={refBusy}
                        title="Attach style-reference images"
                        className="flex flex-col items-center justify-center gap-0.5 bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        {refBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className={cn('h-4 w-4', refs.length > 0 && 'text-primary')} />
                        )}
                        {refs.length === 0 && <span className="text-[9px] font-medium">Reference</span>}
                      </button>
                    )}
                  </div>
                )
              })()}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addRefs(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

            {/* Row 2 — controls + generate, kept on a single line inside the console */}
            <div className="flex flex-nowrap items-center gap-2">
            {/* Art direction */}
            <button
              type="button"
              onClick={() => setArtOpen(true)}
              title="Art Director"
              className={cn(BAR_BTN, 'shrink-0', (isArtActive(art) || style.trim()) && 'border-primary/50 text-primary')}
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden 2xl:inline">Art Director</span>
              {artActiveCount(art) > 0 && (
                <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {artActiveCount(art)}
                </span>
              )}
            </button>

            {/* Model & output */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setBarPopover((p) => (p === 'model' ? null : 'model'))}
                className={BAR_BTN}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden 2xl:inline">
                  {MODEL_LABELS[model] ?? model} · {QUALITY_LABELS[quality] ?? quality}
                </span>
                <span className="2xl:hidden">{QUALITY_LABELS[quality] ?? quality}</span>
                <ChevronDown
                  className={cn('h-3.5 w-3.5 opacity-60 transition-transform', barPopover === 'model' && 'rotate-180')}
                />
              </button>
              {barPopover === 'model' && (
                <div className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 space-y-3 rounded-xl border border-border bg-popover p-3 shadow-xl">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Model">
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {meta.models.map((m) => (
                            <SelectItem key={m} value={m}>{MODEL_LABELS[m] ?? m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Image quality">
                      <Select value={quality} onValueChange={setQuality}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {meta.qualities.map((q) => (
                            <SelectItem key={q} value={q}>{QUALITY_LABELS[q] ?? q}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Thinking" hint="GPT-5.5">
                    <Select value={effort} onValueChange={setEffort}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {efforts.map((ef) => (
                          <SelectItem key={ef.value} value={ef.value}>{ef.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
            </div>

            {/* Brand — palette + optional corner logo */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setBarPopover((p) => (p === 'brand' ? null : 'brand'))}
                title={selectedBrand ? selectedBrand.name : 'Brand'}
                className={cn(BAR_BTN, brandId && 'border-primary/50 text-primary')}
              >
                <Tag className="h-4 w-4" />
                {selectedBrand ? (
                  <span className="flex items-center gap-1.5">
                    <span className="flex -space-x-1">
                      {selectedBrand.colors.slice(0, 3).map((c) => (
                        <span
                          key={c}
                          className="h-3.5 w-3.5 rounded-full border border-card"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </span>
                    <span className="hidden 2xl:inline">{selectedBrand.name}</span>
                  </span>
                ) : (
                  <span className="hidden 2xl:inline">Brand</span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 opacity-60 transition-transform',
                    barPopover === 'brand' && 'rotate-180',
                  )}
                />
              </button>
              {barPopover === 'brand' && (
                <div className="absolute bottom-full left-1/2 z-50 mb-2 flex w-[480px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                  {/* Left — brand catalog */}
                  <div className="w-44 shrink-0 border-r border-border p-2">
                    <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Brands
                    </div>
                    <div className="max-h-64 space-y-0.5 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => setBrandId('')}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          !brandId ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                        )}
                      >
                        None
                      </button>
                      {brands.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBrandId(b.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                            brandId === b.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                          )}
                        >
                          <span className="flex -space-x-1">
                            {b.colors.slice(0, 3).map((c) => (
                              <span
                                key={c}
                                className="h-3 w-3 rounded-full border border-card"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </span>
                          <span className="truncate">{b.name}</span>
                        </button>
                      ))}
                      {brands.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No brands available.</div>
                      )}
                    </div>
                  </div>

                  {/* Right — selected brand: colours + logo placement */}
                  <div className="min-w-0 flex-1 p-3">
                    {selectedBrand ? (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {selectedBrand.name} · colours
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(selectedBrand.swatches?.length
                              ? selectedBrand.swatches
                              : selectedBrand.colors.map((h) => ({ hex: h, role: '' }))
                            ).map((s, i) => (
                              <span
                                key={`${s.hex}-${i}`}
                                title={s.hex}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-1 pl-1.5 pr-2"
                              >
                                <span
                                  className="h-4 w-4 rounded border border-border"
                                  style={{ backgroundColor: s.hex }}
                                />
                                <span className="leading-tight">
                                  <span className="block font-mono text-[10px] font-medium text-foreground">
                                    {s.hex.toUpperCase()}
                                  </span>
                                  {s.role && (
                                    <span className="block text-[9px] text-muted-foreground">{s.role}</span>
                                  )}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>

                        {selectedBrand.logo_svg && (
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Logo placement
                            </div>
                            <div className="relative aspect-[1.6/1] w-full overflow-hidden rounded-lg border border-border bg-muted">
                              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => {
                                const pos = {
                                  tl: 'left-2 top-2',
                                  tr: 'right-2 top-2',
                                  bl: 'left-2 bottom-2',
                                  br: 'right-2 bottom-2',
                                }[c]
                                const on = logoCorner === c
                                return (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setLogoCorner(on ? null : c)}
                                    title={`Logo ${c.toUpperCase()}${on ? ' (selected — click to clear)' : ''}`}
                                    className={cn(
                                      'absolute flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                                      pos,
                                      on
                                        ? 'border-primary bg-primary/20'
                                        : 'border-border bg-card/70 hover:border-foreground/40',
                                    )}
                                  >
                                    {on && <span className="h-3.5 w-3.5 rounded-sm bg-primary/80" />}
                                  </button>
                                )
                              })}
                              {!logoCorner && (
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-10 text-center text-[11px] leading-tight text-muted-foreground">
                                  Placement decided automatically by the AI Builder
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[140px] items-center justify-center px-6 text-center text-xs text-muted-foreground">
                        Select a brand to see its colours and choose where the logo goes.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Language — auto-detected, click to change (real flags) */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setBarPopover((p) => (p === 'lang' ? null : 'lang'))}
                title={localeAuto ? 'Language auto-detected — click to change' : 'Language'}
                className={BAR_BTN}
              >
                <img
                  src={`https://flagcdn.com/h20/${currentLocale.cc}.png`}
                  alt=""
                  className="h-3.5 w-auto rounded-[2px]"
                  loading="lazy"
                />
                <span className="font-semibold">{currentLocale.short}</span>
                {localeAuto && (
                  <span
                    title="Auto-detected from your concept text"
                    className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-primary"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="hidden 2xl:inline">auto</span>
                  </span>
                )}
                <ChevronDown
                  className={cn('h-3.5 w-3.5 opacity-60 transition-transform', barPopover === 'lang' && 'rotate-180')}
                />
              </button>
              {barPopover === 'lang' && (
                <div className="absolute bottom-full left-1/2 z-50 mb-2 max-h-72 w-56 -translate-x-1/2 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-xl">
                  {LOCALES.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() => {
                        setLocale(l.value)
                        setLocaleAuto(false)
                        setBarPopover(null)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        locale === l.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                      )}
                    >
                      <img
                        src={`https://flagcdn.com/h20/${l.cc}.png`}
                        alt=""
                        className="h-3.5 w-auto rounded-[2px]"
                        loading="lazy"
                      />
                      <span className="truncate">{l.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {running ? (
              // While generating, the primary button stops the run; once it
              // settles the user can immediately start a new generation.
              <Button
                className="ml-auto shrink-0 gap-1.5 px-6 font-display"
                size="lg"
                variant="destructive"
                onClick={cancelRuns}
                title="Stop the current generation"
              >
                <X className="h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button
                className={cn('ml-auto shrink-0 px-6 font-display', canRun && 'tb-glow')}
                size="lg"
                onClick={startRun}
                disabled={!canRun}
              >
                <Sparkles className="h-4 w-4" /> Generate
              </Button>
            )}
            </div>
          </div>
        </div>

        <ArtDirectionModal
          open={artOpen}
          onClose={() => setArtOpen(false)}
          art={art}
          onChange={patchArt}
          onReset={() => setArt(DEFAULT_ART)}
          languageLabel={localeLabel}
        />
      </section>

      {/* ---------------- Right: concepts ---------------- */}
      <aside className="flex w-[400px] shrink-0 flex-col bg-card animate-fade-in">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <h2 className="font-display text-sm font-bold tracking-tight text-foreground">Banner Versions</h2>

          {cards.map((c, i) => (
            <div
              key={c.key}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                'relative animate-fade-up space-y-3 overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-sm transition-shadow',
                dragIndex === i && 'opacity-60 ring-2 ring-primary/40',
              )}
            >
              <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden />
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-primary font-display text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    version
                  </span>
                </span>
                <div className="flex items-center gap-0.5">
                  <IconBtn onClick={() => moveCard(i, -1)} disabled={i === 0} title="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn onClick={() => moveCard(i, 1)} disabled={i === cards.length - 1} title="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </IconBtn>
                  {cards.length > 1 && (
                    <IconBtn onClick={() => removeCard(c.key)} title="Remove version">
                      <X className="h-4 w-4" />
                    </IconBtn>
                  )}
                </div>
              </div>

              <Field label="Title">
                <Input
                  value={c.title}
                  onChange={(e) => updateCard(c.key, { title: e.target.value })}
                  placeholder="Oil prices fell. The ringgit moved."
                />
              </Field>
              <Field label="Subtitle" hint="optional">
                <Textarea
                  rows={2}
                  value={c.subtitle}
                  onChange={(e) => updateCard(c.key, { subtitle: e.target.value })}
                  placeholder="Three signals, one connected story."
                />
              </Field>
              <Field label="Button" hint="optional">
                <Input
                  value={c.button}
                  onChange={(e) => updateCard(c.key, { button: e.target.value })}
                  placeholder="Learn more"
                />
              </Field>
            </div>
          ))}

          {cards.length < 5 && (
            <Button variant="outline" className="w-full border-dashed" onClick={addCard}>
              <Plus className="h-4 w-4" />
              Add version
            </Button>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---- small presentational helpers ----
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">· {hint}</span>}
      </Label>
      {children}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Alert({ tone, children }: { tone: 'err' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'err'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-amber-400/40 bg-amber-400/10 text-amber-300',
      )}
    >
      {children}
    </div>
  )
}

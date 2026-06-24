import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import type { Meta, RunData, Tool } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { ApiError, getRun } from '../api'
import { createRun } from './campaignApi'
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
  { value: 'en', label: 'English', cc: 'gb' },
  { value: 'es-419', label: 'Spanish (LatAm)', cc: 'mx' },
  { value: 'pt', label: 'Portuguese', cc: 'pt' },
  { value: 'sv', label: 'Swedish', cc: 'se' },
  { value: 'ja', label: 'Japanese', cc: 'jp' },
  { value: 'th', label: 'Thai', cc: 'th' },
  { value: 'pl', label: 'Polish', cc: 'pl' },
  { value: 'zh', label: 'Chinese', cc: 'cn' },
  { value: 'ar', label: 'Arabic', cc: 'sa' },
  { value: 'it', label: 'Italian', cc: 'it' },
  { value: 'de', label: 'German', cc: 'de' },
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

// Deleted banner labels — persisted so a "trash" deletion sticks across reloads
// even though the backend (which we re-poll) still holds the PNG. We simply
// filter these out of everything shown.
const DELETED_LS_KEY = 'bb:deleted'

function readDeleted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DELETED_LS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeDeleted(labels: string[]) {
  try {
    localStorage.setItem(DELETED_LS_KEY, JSON.stringify(labels))
  } catch {
    /* best-effort */
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
  const [effort, setEffort] = useState(meta.default_effort ?? 'xhigh')
  const [locale, setLocale] = useState(
    LOCALES.some((l) => l.value === brand.locale) ? (brand.locale as string) : 'en',
  )
  // Auto-detect the concept language and pick the matching locale, until the
  // user makes an explicit choice (then we stop overriding).
  const [localeAuto, setLocaleAuto] = useState(true)
  const [detectedLocale, setDetectedLocale] = useState<string | null>(null)
  const [style, setStyle] = useState('')
  const [art, setArt] = useState<ArtDirection>({
    ...DEFAULT_ART,
    scene: brand.scene,
    text: brand.text,
    colorMood: brand.colorMood,
  })
  const [artOpen, setArtOpen] = useState(false)
  const patchArt = (patch: Partial<ArtDirection>) => setArt((a) => ({ ...a, ...patch }))
  const localeLabel = LOCALES.find((l) => l.value === locale)?.label ?? 'English'

  // Sizes UI: collapsible platform groups + global search.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Most used']))
  const [sizeQuery, setSizeQuery] = useState('')

  // Floating command bar popovers ('presets' | 'model' | null).
  const [barPopover, setBarPopover] = useState<null | 'model'>(null)

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

  // Trash: deleted banner labels (persisted), filtered out of what we render.
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set(readDeleted()))
  function deleteBanner(label: string) {
    setDeleted((prev) => {
      const next = new Set(prev)
      next.add(label)
      writeDeleted([...next])
      return next
    })
  }
  const visibleRuns = useMemo(
    () =>
      runs
        .map((r) => ({ ...r, banners: r.banners.filter((b) => !deleted.has(b.label)) }))
        .filter((r) => r.banners.length > 0),
    [runs, deleted],
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
      setDetectedLocale(d)
      setLocale(d)
    } else {
      setDetectedLocale(null)
    }
  }, [cards, localeAuto])

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
          <OutputPane runs={visibleRuns} onDeleteBanner={deleteBanner} />
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
            <div className="flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
              <span className="mr-1 font-display text-[11px] font-medium text-muted-foreground">
                selected sizes:
              </span>
              {selectedSizes.map((s) => {
                const isMaster = s === meta.master_size
                return (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1.5 font-display text-[11px] font-semibold text-primary"
                  >
                    {s}
                    {isMaster ? (
                      <span className="rounded bg-primary px-1 text-[8px] uppercase text-primary-foreground">MVP</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSize(s)}
                        title="Remove size"
                        className="text-primary/70 hover:text-primary"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}

          {localeAuto && detectedLocale && (
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3 w-3 text-primary" />
              Language auto-set to{' '}
              <span className="font-medium text-foreground">
                {LOCALES.find((l) => l.value === detectedLocale)?.label}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLocaleAuto(false)
                  setDetectedLocale(null)
                }}
                title="Dismiss and choose the language manually"
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="relative flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.75)] backdrop-blur-md">
            {/* Row 1 — prompt: full width, a bit taller */}
            <Textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              rows={2}
              placeholder="Describe the banners in your own words — or use Art direction →"
              className="w-full resize-none"
            />

            {/* Row 2 — controls + generate */}
            <div className="flex items-center gap-2">
            {/* Art direction */}
            <button
              type="button"
              onClick={() => setArtOpen(true)}
              className={cn(BAR_BTN, 'shrink-0', (isArtActive(art) || style.trim()) && 'border-primary/50 text-primary')}
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden lg:inline">Art direction</span>
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
                <span className="hidden xl:inline">
                  {MODEL_LABELS[model] ?? model} · {QUALITY_LABELS[quality] ?? quality}
                </span>
                <span className="xl:hidden">Model</span>
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

            {/* Locale — its own control, with real flags */}
            <Select
              value={locale}
              onValueChange={(v) => {
                setLocale(v)
                setLocaleAuto(false)
                setDetectedLocale(null)
              }}
            >
              <SelectTrigger className="h-9 w-auto shrink-0 gap-1.5 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    <span className="flex items-center gap-2">
                      <img
                        src={`https://flagcdn.com/h20/${l.cc}.png`}
                        alt=""
                        className="h-3.5 w-auto rounded-[2px]"
                        loading="lazy"
                      />
                      {l.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              className={cn('ml-auto px-10 font-display', canRun && !running && 'tb-glow')}
              size="lg"
              onClick={startRun}
              disabled={!canRun || running}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate banners
                </>
              )}
            </Button>
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

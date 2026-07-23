import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Download,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Paintbrush,
  Plus,
  ScanText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import type { Meta, RunData } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { addSizes, ApiError, approveConcepts, cancelRun, deleteBanner as deleteBannerApi, getRun, regenerateBanner, rejectConcepts, selectionZipUrl, uploadReferences, type DetectedConcept } from '../api'
import { bannerQueue, createRun, listRuns } from './campaignApi'
import type { CampaignRunRequest, QueueTask } from './campaignApi'
import { OutputPane } from './Results'
import { ReadyQueueStrip, useReadyQueue } from '@/components/ReadyQueue'
import { BannerGallery } from './Gallery'
import { CopyDetectModal } from './CopyDetectModal'
import {
  ArtDirectionModal,
  artActiveCount,
  artDirectionTags,
  composeArtDirection,
  DEFAULT_ART,
  isArtActive,
  type ArtDirection,
} from './artDirection'
import { loadBrand } from './brand'
import { detectLocale } from './detectLocale'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { brandOptions, listBrands, type Brand } from './brandsApi'
import { addCustomSize as addCustomSizeApi, getSizeConfig, type SizeConfig, type SizeGroup } from './sizesApi'
import { useAuth } from '../auth/AuthContext'
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
  { value: 'pt', label: 'Portuguese', short: 'PT', cc: 'br' },
  { value: 'sv', label: 'Swedish', short: 'SV', cc: 'se' },
  { value: 'no', label: 'Norwegian', short: 'NO', cc: 'no' },
  { value: 'ja', label: 'Japanese', short: 'JA', cc: 'jp' },
  { value: 'th', label: 'Thai', short: 'TH', cc: 'th' },
  { value: 'ms', label: 'Malaysian', short: 'MS', cc: 'my' },
  { value: 'vi', label: 'Vietnamese', short: 'VI', cc: 'vn' },
  { value: 'pl', label: 'Polish', short: 'PL', cc: 'pl' },
  { value: 'zh', label: 'Chinese', short: 'ZH', cc: 'cn' },
  { value: 'ar', label: 'Arabic', short: 'AR', cc: 'sa' },
  { value: 'it', label: 'Italian', short: 'IT', cc: 'it' },
  { value: 'fr', label: 'French', short: 'FR', cc: 'fr' },
  { value: 'de', label: 'German', short: 'DE', cc: 'de' },
]

export const MODEL_LABELS: Record<string, string> = {
  'gpt-image-2': 'GPT-2',
  'gpt-image-1-mini': 'GPT-1',
}
export const QUALITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }

// FALLBACK size groups (the team's master size sheet) — used only until the
// server-driven size config loads (or if it fails). The live organization is
// admin-managed via /size-config and shared with the add-sizes picker.
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
const WORKINGSET_SCHEMA_KEY = 'bb:ws-schema'
const WORKINGSET_SCHEMA = 'ws-2' // bump to force a one-time purge of the stores below

// One-time reset of the persisted working set. Before v1.87.1 the canvas
// mirrored the whole shared feed, so every browser's `bb:runs` (ids) and
// `bb:runs:snapshot` (data) accumulated EVERY user's runs — and the URL's
// ?runs= with them. The new working-set canvas would otherwise restore all of
// that on load (which is why an existing user still saw other people's
// generations after the fix). Purge those stores once per browser; going
// forward only runs the user actually starts or opens are persisted.
function purgeLegacyWorkingSet(): void {
  try {
    if (localStorage.getItem(WORKINGSET_SCHEMA_KEY) === WORKINGSET_SCHEMA) return
    localStorage.removeItem(RUNS_LS_KEY)
    localStorage.removeItem(SNAP_LS_KEY)
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.has('runs')) {
        u.searchParams.delete('runs')
        window.history.replaceState(null, '', u.pathname + u.search + u.hash)
      }
    } catch { /* ignore */ }
    localStorage.setItem(WORKINGSET_SCHEMA_KEY, WORKINGSET_SCHEMA)
  } catch { /* best-effort */ }
}

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

/**
 * Refresh the canvas's WORKING SET against the server list. The canvas shows
 * only the runs already on it (started here, restored from this browser's
 * ids, or opened from the Library) — never the whole shared feed; browsing
 * everything is the Library's job. Within that set the server stays
 * AUTHORITATIVE: statuses refresh, and a run deleted elsewhere (gone from the
 * list) is dropped instead of lingering. A locally-settled terminal status is
 * preserved over a server status that's briefly still mid-flight (avoids a
 * flicker right after a local stop), and a just-started local run the server
 * doesn't know about yet is kept until it appears.
 */
function reconcileRuns(prev: RunData[], server: RunData[]): RunData[] {
  const byId = new Map(server.map((r) => [r.run_id, r]))
  const out: RunData[] = []
  for (const local of prev) {
    const s = byId.get(local.run_id)
    if (s) {
      out.push(
        TERMINAL_STATUSES.includes(local.status) && !TERMINAL_STATUSES.includes(s.status)
          ? local
          : s,
      )
    } else if (!TERMINAL_STATUSES.includes(local.status)) {
      out.push(local) // still generating; not in the shared list yet
    }
    // terminal AND gone from the server = deleted elsewhere → dropped
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
}

/** Pull WxH size tokens out of pasted text — commas/spaces/newlines, x/×/* separators
 * ("1200×628, 300x250 1080 x 1080" → ["1200x628","300x250","1080x1080"]). Deduped. */
function parseSizes(text: string): string[] {
  const matches = text.match(/\d{2,5}\s*[x×X*]\s*\d{2,5}/g) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    const norm = m.replace(/\s+/g, '').replace(/[×X*]/g, 'x')
    if (!seen.has(norm)) {
      seen.add(norm)
      out.push(norm)
    }
  }
  return out
}

export function BannerBuilder({ meta }: { meta: Meta }) {
  // ---- Campaign settings ----
  const efforts = meta.thinking_efforts ?? [
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extended' },
  ]
  // Rough, non-binding time samples for the GPT-5.5 thinking pass per effort — just
  // to set expectations (the actual time varies with the offer + load).
  const EFFORT_ETA: Record<string, string> = {
    low: '~20s',
    medium: '~45s',
    high: '~1–2 min',
    xhigh: '~3–5 min',
  }
  const [brand] = useState(loadBrand)
  const [sizes, setSizes] = useState<Set<string>>(new Set([meta.master_size]))
  const [model, setModel] = useState(
    brand.model && meta.models.includes(brand.model) ? brand.model : meta.models[0] ?? 'gpt-image-2',
  )
  const [quality, setQuality] = useState(
    brand.quality && meta.qualities.includes(brand.quality)
      ? brand.quality
      : meta.qualities.includes('high')
        ? 'high'
        : meta.default_quality ?? meta.qualities[meta.qualities.length - 1] ?? 'high',
  )
  const [effort, setEffort] = useState(
    meta.thinking_efforts?.some((e) => e.value === 'high') ? 'high' : meta.default_effort ?? 'high',
  )
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
  const [copyDetectOpen, setCopyDetectOpen] = useState(false)
  const patchArt = (patch: Partial<ArtDirection>) => setArt((a) => ({ ...a, ...patch }))
  const currentLocale = LOCALES.find((l) => l.value === locale) ?? LOCALES[0]
  const localeLabel = currentLocale.label

  // Sizes UI: collapsible platform groups + global search.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Most used']))
  const [sizeQuery, setSizeQuery] = useState('')
  // Toast under the size rail: bulk-paste feedback, custom-size results, and
  // failed gallery actions (regenerate / add sizes) — fades after 5s, closeable.
  const [sizeNotice, setSizeNotice] = useState<{
    added: number
    unsupported: string[]
    message?: string
  } | null>(null)
  useEffect(() => {
    if (!sizeNotice) return
    const t = window.setTimeout(() => setSizeNotice(null), 5000)
    return () => window.clearTimeout(t)
  }, [sizeNotice])

  // Shared size groups / bundles / custom sizes — server-driven so admins can
  // reorganize them and anyone can add a custom size. Falls back to the built-in
  // PLATFORMS list until the config loads (or if the request fails).
  const [sizeConfig, setSizeConfig] = useState<SizeConfig | null>(null)
  useEffect(() => {
    getSizeConfig()
      .then(setSizeConfig)
      .catch(() => {})
  }, [])
  const allSizes = useMemo(
    () => (sizeConfig?.sizes?.length ? sizeConfig.sizes : meta.sizes),
    [sizeConfig, meta.sizes],
  )
  const customGroupId = sizeConfig?.custom_group_id ?? 'custom'
  // Display groups: the server organization (or the fallback), plus an "Other"
  // group for any generatable size no group lists.
  const sizeGroups: SizeGroup[] = useMemo(() => {
    const groups =
      sizeConfig?.groups?.length
        ? sizeConfig.groups
        : PLATFORMS.map((p, i) => ({ id: `builtin-${i}`, label: p.label, sizes: p.sizes }))
    const covered = new Set(groups.flatMap((g) => g.sizes))
    const other = allSizes.filter((s) => !covered.has(s))
    return other.length ? [...groups, { id: 'other', label: 'Other', sizes: other }] : groups
  }, [sizeConfig, allSizes])

  function applyPastedSizes(text: string): boolean {
    const parsed = parseSizes(text)
    if (parsed.length === 0) return false
    const supported = parsed.filter((s) => allSizes.includes(s))
    const unsupported = parsed.filter((s) => !allSizes.includes(s))
    const addedNow = supported.filter((s) => !sizes.has(s))
    if (addedNow.length) {
      setSizes((prev) => {
        const next = new Set(prev)
        addedNow.forEach((s) => next.add(s))
        return next
      })
    }
    setSizeNotice({ added: addedNow.length, unsupported })
    setSizeQuery('')
    return true
  }

  // Add ONE custom size (persisted server-side in the shared "Custom sizes"
  // group). Returns the normalized size, or null when it was rejected.
  const [customBusy, setCustomBusy] = useState(false)
  async function addCustomSize(text: string, select: boolean): Promise<string | null> {
    const norm = (text || '').trim().toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '')
    if (!/^\d{2,4}x\d{2,4}$/.test(norm)) {
      setSizeNotice({
        added: 0,
        unsupported: [],
        message: `“${text.trim()}” is not a size — use width x height, e.g. 500x500.`,
      })
      return null
    }
    if (allSizes.includes(norm)) {
      if (select) {
        setSizes((prev) => new Set(prev).add(norm))
        setSizeQuery('')
      }
      return norm
    }
    setCustomBusy(true)
    try {
      const cfg = await addCustomSizeApi(norm)
      setSizeConfig(cfg)
      if (select) {
        setSizes((prev) => new Set(prev).add(norm))
        setSizeQuery('')
      }
      setSizeNotice({
        added: 1,
        unsupported: [],
        message: `Added custom size ${norm} — saved in “Custom sizes” for the whole team.`,
      })
      return norm
    } catch (e) {
      setSizeNotice({
        added: 0,
        unsupported: [],
        message: e instanceof Error ? e.message : String(e),
      })
      return null
    } finally {
      setCustomBusy(false)
    }
  }

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
  const dark = useIsDark()
  // Monday "Ready for Design" queue (kept fresh by the shared hook — focus +
  // interval refetch, so a Banner-Sizes edit on the board reaches the chip),
  // and the creative a run is being built for (set when you start from a task
  // → the run files itself in the Library).
  const { tasks: queue, scope: queueScope, setScope: setQueueScope, meta: queueMeta } =
    useReadyQueue(bannerQueue)
  const [pendingCreative, setPendingCreative] = useState<{ id: string; name: string } | null>(null)
  // When a Monday task supplied the sizes, the request is authoritative — the
  // Sizes section shows just those (no catalogue) until the user asks to edit.
  const [sizesLocked, setSizesLocked] = useState(false)
  // null = let the AI Builder decide placement automatically.
  const [logoCorner, setLogoCorner] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null)

  // ---- Concept cards ----
  const [cards, setCards] = useState<ConceptCard[]>([blankCard()])

  const [formError, setFormError] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<{ env: string; label: string; docs_url: string }[] | null>(null)

  const [runs, setRuns] = useState<RunData[]>(() => {
    // Runs BEFORE the snapshot is read, so a legacy (pre-working-set) browser
    // starts clean instead of restoring the whole old shared feed.
    purgeLegacyWorkingSet()
    // Restore ONLY active runs. Finished ones live in the Library (they
    // graduate off the canvas on completion), so a stale snapshot carrying old
    // completed runs — yours OR anyone else's — can never repaint here. This is
    // the durable guard behind the one-time purge above: self-healing, no flag.
    return readSnapshot().filter((r) => !TERMINAL_STATUSES.includes(r.status))
  })
  // Build (generate + results) vs Library (the kind → creative folder shelf).
  const [mode, setMode] = useState<'build' | 'library'>('build')
  const [polling, setPolling] = useState(false)
  // Runs I explicitly opened from the Library this session — the ONLY reason a
  // finished run by someone else may sit on the canvas. Everything else on the
  // canvas is active work or mine; see visibleRuns.
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set())
  // Guards Generate from a double-click (or a click during the in-flight POST)
  // starting two runs — i.e. double image spend.
  const [submitting, setSubmitting] = useState(false)
  const runsRef = useRef<RunData[]>(runs)
  runsRef.current = runs
  const { user } = useAuth()
  const myEmail = (user?.email || '').toLowerCase()
  // The ONE rule every layer below obeys (display, restore, persistence): a run
  // belongs to THIS user iff the server stamped it with their email. Strict on
  // purpose — a run by anyone else, whatever its status (generating, awaiting
  // approval, recomposing, completed), is never "mine". Mirrors the backend's
  // created_by === email owner check in runs_router._enforce_owner.
  const ownedByMe = useCallback(
    (r: RunData) => !!r.created_by && r.created_by.toLowerCase() === myEmail,
    [myEmail],
  )

  // Mirror runs to localStorage so a reload or tab switch restores instantly —
  // but persist ONLY my own runs. A foreign run that slipped into state (a stale
  // ?runs= URL, a legacy snapshot) is never written back, so it cannot survive a
  // reload or re-seed the canvas. Until auth resolves we don't yet know who I am,
  // so persist as-is for that first instant; the render gate still hides foreign
  // runs on screen, and the next change self-heals the store.
  useEffect(() => {
    writeSnapshot(myEmail ? runs.filter(ownedByMe) : runs)
  }, [runs, myEmail, ownedByMe])

  // A generation that FINISHES here (transitions into 'completed' — approved
  // and recomposed) graduates to the Library: it leaves the canvas and its
  // persisted id, and a notice offers the jump. Only fresh completions move —
  // a run OPENED from the Library arrives already completed (no transition)
  // and stays while you work on it. Failed/partial/cancelled runs also stay,
  // so problems are never swept out of sight.
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const [movedNotice, setMovedNotice] = useState<{ names: string[] } | null>(null)
  useEffect(() => {
    const prev = prevStatusRef.current
    const done = runs.filter(
      (r) =>
        r.status === 'completed' &&
        prev.has(r.run_id) &&
        !TERMINAL_STATUSES.includes(prev.get(r.run_id) as string),
    )
    prevStatusRef.current = new Map(runs.map((r) => [r.run_id, r.status]))
    if (!done.length) return
    const doneIds = new Set(done.map((r) => r.run_id))
    setRuns((cur) => cur.filter((r) => !doneIds.has(r.run_id)))
    persistRunIds(runs.filter((r) => !doneIds.has(r.run_id)).map((r) => r.run_id))
    setMovedNotice({
      names: done.map(
        (r) => r.creative_name || r.banners.find((b) => b.title)?.title || 'Generation',
      ),
    })
  }, [runs])
  useEffect(() => {
    if (!movedNotice) return
    const t = window.setTimeout(() => setMovedNotice(null), 9000)
    return () => window.clearTimeout(t)
  }, [movedNotice])

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

  // ---- Banner multi-select (keys are `${runId}|${label}`) ----
  // Lifted here so the central console can swap to a selection console when ≥1
  // banner is picked. The gallery (OutputPane) renders the per-card checkboxes.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  function toggleSelect(runId: string, label: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = `${runId}|${label}`
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }
  function toggleVersion(runId: string, labels: string[]) {
    setSelected((prev) => {
      const next = new Set(prev)
      const keys = labels.map((l) => `${runId}|${l}`)
      const allSel = keys.length > 0 && keys.every((k) => next.has(k))
      keys.forEach((k) => (allSel ? next.delete(k) : next.add(k)))
      return next
    })
  }
  const clearSelection = () => setSelected(new Set())
  const selectedItems = [...selected].map((k) => {
    const i = k.indexOf('|')
    return { runId: k.slice(0, i), label: k.slice(i + 1) }
  })
  // Delete only the selected banners the user owns (creator, or admin for legacy
  // runs) — matches the gallery's per-card gate + the backend, so an optimistic
  // remove never fights a 403.
  function deleteSelectedBanners() {
    const canModify = (runId: string) => {
      const r = runsRef.current.find((x) => x.run_id === runId)
      const cb = (r?.created_by || '').toLowerCase()
      return cb ? cb === myEmail : user?.role === 'admin'
    }
    selectedItems.forEach((it) => {
      if (canModify(it.runId)) deleteBanner(it.runId, it.label)
    })
    clearSelection()
  }
  const visibleRuns = useMemo(() => {
    // The render-layer guarantee. Whatever ends up in `runs` (a stale ?runs= URL,
    // an old snapshot, a fetch quirk, a cached bundle — anything), the canvas only
    // ever SHOWS a run that is MINE or that I deliberately opened from the Library
    // this session. Keyed off OWNERSHIP, never status: a run by someone else that
    // is merely awaiting approval (or still generating, or recomposing) is still
    // theirs and stays off my canvas. That status blind spot was the leak people
    // kept seeing. Everyone's finished work lives in the Library.
    return runs.filter((r) => {
      if (r.banners.length === 0 && TERMINAL_STATUSES.includes(r.status)) return false
      return ownedByMe(r) || openedIds.has(r.run_id)
    })
  }, [runs, ownedByMe, openedIds])

  // Poll every non-terminal run until all reach a terminal status.
  useEffect(() => {
    if (!polling) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      // Awaiting-approval is paused, not generating — don't actively poll it every
      // 2s (the 5s shared refresh still catches the approve→recompose transition).
      const active = runsRef.current.filter(
        (r) => !TERMINAL_STATUSES.includes(r.status) && r.status !== 'awaiting_approval',
      )
      if (active.length === 0) {
        if (!cancelled) setPolling(false)
        return
      }
      const results = await Promise.all(
        active.map((r) =>
          getRun(r.run_id)
            .then((d) => ({ id: r.run_id, data: d as RunData | null, gone: false }))
            .catch((e) => ({ id: r.run_id, data: null, gone: e instanceof ApiError && e.status === 404 })),
        ),
      )
      if (cancelled) return
      const byId = new Map<string, RunData>()
      results.forEach((res) => {
        if (res.data) byId.set(res.id, res.data)
      })
      // A run that 404s mid-poll (e.g. the backend restarted before persisting it)
      // is settled to `failed` so it leaves the active set — never an endless spinner.
      const goneIds = new Set(results.filter((res) => res.gone).map((res) => res.id))
      if (byId.size || goneIds.size) {
        setRuns((prev) =>
          prev.map((r) => {
            const fresh = byId.get(r.run_id)
            if (fresh) return fresh
            if (goneIds.has(r.run_id) && !TERMINAL_STATUSES.includes(r.status)) {
              return { ...r, status: 'failed', error: 'This run is no longer available — the server may have restarted.' }
            }
            return r
          }),
        )
      }
      timer = window.setTimeout(tick, 2000)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [polling])

  // ONE deterministic mount load: restore THIS BROWSER's working set (ids from
  // ?runs= + localStorage — runs the user started here or opened from the
  // Library), refreshed by id. Deliberately NOT the shared listRuns() feed:
  // the canvas is a workspace, and everyone's history lives in the Library.
  useEffect(() => {
    // Prune ids the snapshot already knows are FINISHED — they graduated to the
    // Library and don't belong on the canvas. This is what makes a legacy feed
    // (dozens of completed runs) collapse to nothing without dozens of fetches.
    const snapStatus = new Map(readSnapshot().map((r) => [r.run_id, r.status]))
    const ids = Array.from(new Set([...readRunIdsFromUrl(), ...readRunIdsFromStore()]))
      .filter((id) => {
        const st = snapStatus.get(id)
        return st === undefined || !TERMINAL_STATUSES.includes(st)
      })
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
      // Keep only ACTIVE restored runs — a completed one belongs to the Library.
      const restored = settled
        .filter((s) => s.data)
        .map((s) => s.data as RunData)
        .filter((r) => !TERMINAL_STATUSES.includes(r.status))
      // Any id whose fetch revealed it FINISHED (terminal) or GONE (404) must
      // leave the canvas — the instant snapshot paint may have shown it with a
      // stale in-flight status frozen from when it was captured. (A transient
      // fetch failure isn't in here, so that run's paint survives — resilient.)
      const drop = new Set(
        settled
          .filter((s) => s.gone || (s.data && TERMINAL_STATUSES.includes((s.data as RunData).status)))
          .map((s) => s.id),
      )
      setRuns((prev) => {
        const fresh = new Map(restored.map((r) => [r.run_id, r]))
        const out = prev
          .filter((r) => !drop.has(r.run_id))     // drop now-finished / gone runs
          .map((r) => fresh.get(r.run_id) ?? r)    // refresh the actives
        const seen = new Set(out.map((r) => r.run_id))
        restored.forEach((r) => {
          if (!seen.has(r.run_id)) out.push(r)
        })
        return out.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      })
      if (restored.length) setPolling(true)
      // Persist only my own active runs — the store self-heals to the true working
      // set every load, so a finished/foreign run can't linger across reloads.
      // (Pre-auth we don't know ownership yet; persist as-is, then the render gate
      // hides foreign runs and the next persist prunes them.)
      persistRunIds((myEmail ? restored.filter(ownedByMe) : restored).map((r) => r.run_id))
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

  // Load brands once for the brand selector. brandOptions() keeps this a BRAND
  // picker: academies belong here (an academy is a brand), white labels never
  // do, and retired entities drop out.
  useEffect(() => {
    listBrands()
      .then((all) => setBrands(brandOptions(all)))
      .catch(() => {})
  }, [])

  // Start building from a queued task: select its brand, sizes and language,
  // seed the first concept from its name, and remember the creative so the run
  // files itself in the Library. Sizes not in the standard groups are added as
  // custom on the fly (the requested set is authoritative).
  async function startFromTask(t: QueueTask) {
    setMode('build')
    setPendingCreative({ id: t.item.id, name: t.item.name })
    if (t.match.brand_id) setBrandId(t.match.brand_id)
    // The task's language is authoritative — pin it so the concept-text
    // auto-detect effect can't overwrite it when we seed the first card below.
    if (t.match.language) { setLocale(t.match.language); setLocaleAuto(false) }
    setCards((prev) => prev.map((c, i) =>
      i === 0 && !c.title.trim() ? { ...c, title: t.item.name } : c))
    const want = t.match.sizes
    if (want.length) {
      const known = want.filter((s) => allSizes.includes(s))
      setSizes(new Set(known))
      for (const s of want.filter((s) => !allSizes.includes(s))) {
        await addCustomSize(s, true)
      }
      // The task said exactly what to build — hide the catalogue.
      setSizesLocked(true)
    } else {
      setSizesLocked(false)
    }
  }

  // LIVE: keep the WORKING SET fresh — statuses of the runs on this canvas
  // (incl. the approve→recompose transition) and deletes made elsewhere (e.g.
  // the Disk Manager). reconcileRuns never ADDS server runs, so other users'
  // output stays out of the canvas — it belongs to the Library.
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      const serverRuns = await listRuns()
      if (!alive || serverRuns === null) return // transient error — keep the current view
      setRuns((prev) => reconcileRuns(prev, serverRuns))
      const mine = new Set(runsRef.current.map((r) => r.run_id))
      if (serverRuns.some((r) => mine.has(r.run_id) && !TERMINAL_STATUSES.includes(r.status))) {
        setPolling(true)
      }
    }
    const iv = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.clearInterval(iv)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // ---- Sizes ----
  // Any size can be toggled — including the square master. The backend generates
  // exactly the sizes picked, choosing ONE of them as the master (the plate every
  // other size recomposes off), so "only 300x250" costs one image, not two.
  function toggleSize(s: string) {
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  // The size that will be generated from scratch — mirrors the backend's choice:
  // the square master if it's among the picks, otherwise the LARGEST picked size.
  // Everything else recomposes off it. Used only for display (badge/ordering).
  const masterOf = (selected: string[]): string => {
    if (selected.includes(meta.master_size)) return meta.master_size
    const area = (s: string) => {
      const [w, h] = s.split('x').map(Number)
      return (w || 0) * (h || 0)
    }
    return [...selected].sort((a, b) => area(b) - area(a))[0] || meta.master_size
  }

  // One-click size bundles — server-driven (admins create/edit them); falls back
  // to the standard set. Applying a bundle REPLACES the current selection with
  // exactly the bundle's sizes (no forced master — the backend picks one of them).
  const bundles = useMemo(() => {
    const list = sizeConfig?.bundles?.length
      ? sizeConfig.bundles
      : [{ id: 'standard', label: 'Standard bundle', sizes: ['1200x1200', '1200x628', '960x1200'] }]
    return list
      .map((b) => ({ ...b, sizes: b.sizes.filter((s) => allSizes.includes(s)) }))
      .filter((b) => b.sizes.length > 0)
  }, [sizeConfig, allSizes])
  const bundleSelection = (b: { sizes: string[] }) =>
    Array.from(new Set(b.sizes))
  const bundleActive = (b: { sizes: string[] }) => {
    const want = bundleSelection(b)
    return sizes.size === want.length && want.every((s) => sizes.has(s))
  }
  function applyBundle(b: { sizes: string[] }) {
    setSizes(new Set(bundleSelection(b)))
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
    const on = sizes.has(s)
    return (
      <button
        key={s}
        type="button"
        onClick={() => toggleSize(s)}
        className={cn(
          'flex items-center justify-between rounded-md border px-2.5 py-1.5 font-display text-[12px] font-semibold transition-colors',
          on
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border bg-secondary text-muted-foreground hover:border-foreground/25 hover:text-foreground',
        )}
      >
        <span>{s}</span>
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
  // Replace the version cards with copy detected from a pasted block.
  function applyDetected(concepts: DetectedConcept[]) {
    const next = concepts.slice(0, 5).map((c) => ({
      ...blankCard(),
      title: c.title || '',
      subtitle: c.subtitle || '',
      button: c.button || '',
    }))
    if (next.length) setCards(next)
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

  const canRun = sizes.size > 0 && cards.length > 0 && cards.every((c) => c.title.trim().length > 0)
  const selectedBrand = brands.find((b) => b.id === brandId)

  // Stop every still-running batch. We ask the backend to cancel AND optimistically
  // settle the run locally so the user is NEVER trapped in the spinner — even if the
  // backend is slow or wedged, `running` flips false immediately and they can start a
  // new generation. (A reload re-fetches real status, so finished banners aren't lost.)
  function cancelRuns() {
    // Only the current user's own runs may be stopped — never another user's
    // in-flight batch (admins included, except legacy runs with no owner). This
    // mirrors the backend owner-enforcement so the UI never offers to do
    // something the server would reject.
    const mine = (cb?: string | null) =>
      cb ? cb.toLowerCase() === myEmail : user?.role === 'admin'
    const active = runsRef.current.filter(
      (r) => !TERMINAL_STATUSES.includes(r.status) && mine(r.created_by),
    )
    active.forEach((r) => cancelRun(r.run_id))
    setRuns((prev) =>
      prev.map((r) =>
        !TERMINAL_STATUSES.includes(r.status) && mine(r.created_by)
          ? { ...r, status: 'cancelled' }
          : r,
      ),
    )
    // Keep polling if someone else's run is still going; otherwise stop.
    const othersActive = runsRef.current.some(
      (r) => !TERMINAL_STATUSES.includes(r.status) && !mine(r.created_by),
    )
    if (!othersActive) setPolling(false)
  }

  // Stop ONE run (from its generating concept card). Optimistically settles just
  // that run so the user is never trapped; any other runs keep going.
  function cancelOneRun(runId: string) {
    cancelRun(runId)
    setRuns((prev) =>
      prev.map((r) =>
        r.run_id === runId && !TERMINAL_STATUSES.includes(r.status) ? { ...r, status: 'cancelled' } : r,
      ),
    )
  }

  // Approve a version → recompose it into all sizes. Optimistically mark it
  // approved + flip the run to recomposing so the UI updates instantly; the
  // server is authoritative and reconciles on the next poll.
  function approveVersion(runId: string, concept: string) {
    void approveConcepts(runId, [concept]).catch(() => {})
    setRuns((prev) =>
      prev.map((r) =>
        r.run_id === runId
          ? { ...r, status: 'running_recomp', approval_state: { ...(r.approval_state || {}), [concept]: 'approved' } }
          : r,
      ),
    )
    setPolling(true)
  }

  // Reject a version → keep the MVP only, skip recompose.
  function rejectVersion(runId: string, concept: string) {
    void rejectConcepts(runId, [concept]).catch(() => {})
    setRuns((prev) =>
      prev.map((r) =>
        r.run_id === runId
          ? { ...r, approval_state: { ...(r.approval_state || {}), [concept]: 'rejected' } }
          : r,
      ),
    )
  }

  // A failed gallery action must never die silently (that reads as "the button
  // does nothing") — surface the backend's reason in the toast.
  const surfaceActionError = (prefix: string) => (e: unknown) =>
    setSizeNotice({
      added: 0,
      unsupported: [],
      message: `${prefix}: ${e instanceof Error ? e.message : String(e)}`,
    })

  // Re-roll ONE banner (a single size) in place. Optimistically swap in the
  // server's updated run and resume polling so the tile shows working → ok.
  // promptOverride: an edited prompt to re-roll from ('' resets it); omitted = plain re-roll.
  function regenerateBannerFrame(runId: string, label: string, promptOverride?: string) {
    void regenerateBanner(runId, label, promptOverride)
      .then((updated) => setRuns((prev) => prev.map((r) => (r.run_id === runId ? updated : r))))
      .catch(surfaceActionError('Could not regenerate'))
    setPolling(true)
  }

  // Add more sizes to a version → recompose off its master. Swap in the
  // updated run and resume polling so the new sizes fill in as they finish.
  function addSizesToVersion(runId: string, concept: string, sizes: string[]) {
    if (!sizes.length) return
    void addSizes(runId, concept, sizes)
      .then((updated) => setRuns((prev) => prev.map((r) => (r.run_id === runId ? updated : r))))
      .catch(surfaceActionError('Could not add sizes'))
    setPolling(true)
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
    if (submitting) return // guard against a double-click starting two runs
    setFormError(null)
    setFormErrors([])
    setMissing(null)
    setSubmitting(true)
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
      art_tags: artDirectionTags(art),
      monday_id: pendingCreative?.id || undefined,
      creative_name: pendingCreative?.name || undefined,
    }
    try {
      const initial = await createRun(payload)
      // Persist my own working-set ids + the new run — never a foreign id that may
      // be sitting in state, so the store can't re-seed someone else's run.
      const ids = [...runsRef.current.filter(ownedByMe).map((r) => r.run_id), initial.run_id]
      setRuns((prev) => [...prev, initial])
      setPolling(true)
      persistRunIds(ids)
    } catch (e) {
      if (e instanceof ApiError && e.status === 424) setMissing(e.missingSecrets ?? [])
      else if (e instanceof ApiError && e.errors) setFormErrors(e.errors)
      else setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Open a run from the Library into the Build view's results pane: fetch it,
  // merge into the session runs (dedup, newest first), switch to Build.
  const openRunInBuild = (runId: string) => {
    setMode('build')
    // Mark it as deliberately opened so the display gate lets it through even if
    // it's a finished run by someone else (bring-back-and-edit).
    setOpenedIds((prev) => new Set(prev).add(runId))
    getRun(runId)
      .then((r) => setRuns((prev) => [r, ...prev.filter((p) => p.run_id !== runId)]))
      .catch(() => { /* the poll will pick it up on next tick */ })
  }

  // A "Refine" from the lightbox produced a new run (my correction, same design).
  // It's mine, so the display gate shows it; drop it on the canvas so I see it.
  const handleRefined = (run: RunData) => {
    setMode('build')
    setOpenedIds((prev) => new Set(prev).add(run.run_id))
    setRuns((prev) => [run, ...prev.filter((p) => p.run_id !== run.run_id)])
  }

  // "Send to Library": the run is already in the shared Library; this just clears
  // it off MY canvas so the workspace is empty for the next project. Drops it from
  // the working set (state + opened + persisted ids) — the reconcile never re-adds
  // it, so the canvas stays clean.
  const handleSendToLibrary = (runId: string) => {
    setOpenedIds((prev) => {
      const n = new Set(prev)
      n.delete(runId)
      return n
    })
    setRuns((cur) => cur.filter((r) => r.run_id !== runId))
    persistRunIds(runsRef.current.filter((r) => r.run_id !== runId).map((r) => r.run_id))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Build ↔ Library switch — Build is the generator, Library the shelf. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-4 py-2">
        <span className="inline-flex rounded-lg border border-border bg-background p-0.5">
          {(['build', 'library'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
                mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {m === 'build' ? 'Build' : 'Library'}
            </button>
          ))}
        </span>
      </div>

      {/* Monday "Ready for Design" queue — click a task to open it pre-filled.
          Shared strip (components/ReadyQueue) — same one the LP Builder shows. */}
      {mode === 'build' && (queueMeta.allCount > 0 || pendingCreative) && (
        <ReadyQueueStrip
          tasks={queue}
          scope={queueScope}
          linked={queueMeta.linked}
          mineCount={queueMeta.mineCount}
          allCount={queueMeta.allCount}
          onScopeChange={setQueueScope}
          onOpen={(t) => void startFromTask(t)}
          leading={pendingCreative && (
            <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-foreground">
              <Link2 className="h-3 w-3 text-primary" />
              Building for {pendingCreative.name}
              <button type="button"
                      onClick={() => { setPendingCreative(null); setSizesLocked(false) }}
                      aria-label="Clear creative" className="ml-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        />
      )}

      {/* A finished generation just graduated to the Library — offer the jump. */}
      {movedNotice && (
        <div className="animate-fade-up fixed left-1/2 top-4 z-[200] w-full max-w-md -translate-x-1/2 px-4">
          <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm shadow-lg backdrop-blur-md">
            <Layers className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 font-medium text-foreground">
              <span className="truncate">
                {movedNotice.names[0]}
                {movedNotice.names.length > 1 ? ` +${movedNotice.names.length - 1} more` : ''}
              </span>{' '}
              ready — moved to the Library.
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => {
                setMovedNotice(null)
                setMode('library')
              }}
            >
              Open Library
            </Button>
            <button
              type="button"
              onClick={() => setMovedNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {mode === 'library' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BannerGallery onOpenRun={openRunInBuild} />
        </div>
      ) : (
    // Desktop-first 3-pane console. Panes use responsive widths (full at xl); on
    // anything narrower than fits, the row scrolls horizontally rather than
    // overlapping, so every pane stays reachable.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pb-28 lg:flex-row lg:overflow-x-auto lg:overflow-y-hidden lg:pb-0">
      {/* ---------------- Left: the BRIEF ----------------
          One column that reads like the task, top to bottom: brand & language →
          concepts (the copy) → art direction → sizes → Generate pinned below.
          Everything that used to float in the bottom console lives here now, so
          the centre pane is pure output. */}
      <aside className="order-1 flex w-full shrink-0 flex-col border-b border-border bg-card animate-fade-in lg:order-none lg:w-[390px] lg:border-b-0 lg:border-r xl:w-[440px]">
        <div className="space-y-5 p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">

          {/* 1 · Setup — brand, language, engine. Inline expanders (not popovers:
              a scrolling panel clips floating layers). */}
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBarPopover((p) => (p === 'brand' ? null : 'brand'))}
                title={selectedBrand ? selectedBrand.name : 'Brand'}
                aria-expanded={barPopover === 'brand'}
                className={cn(
                  'flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs transition-colors hover:border-primary/50',
                  brandId ? 'border-primary/50 text-primary' : 'border-border text-foreground',
                )}
              >
                {selectedBrand ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <BrandMark brand={selectedBrand} dark={dark} />
                    <span className="truncate">{selectedBrand.name}</span>
                  </span>
                ) : (
                  <>
                    <Tag className="h-4 w-4 shrink-0" />
                    <span>Brand</span>
                  </>
                )}
                <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 opacity-60 transition-transform',
                  barPopover === 'brand' && 'rotate-180')} />
              </button>
              <button
                type="button"
                onClick={() => setBarPopover((p) => (p === 'lang' ? null : 'lang'))}
                title={localeAuto ? 'Language auto-detected — click to change' : 'Language'}
                aria-expanded={barPopover === 'lang'}
                className="flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:border-primary/50"
              >
                <img src={`https://flagcdn.com/h20/${currentLocale.cc}.png`} alt=""
                     className="h-3.5 w-auto shrink-0 rounded-[2px]" loading="lazy" />
                <span className="font-semibold">{currentLocale.short}</span>
                {localeAuto && (
                  <span title="Auto-detected from your concept text"
                        className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    auto
                  </span>
                )}
                <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 opacity-60 transition-transform',
                  barPopover === 'lang' && 'rotate-180')} />
              </button>
            </div>

            {barPopover === 'brand' && (
              <div className="animate-fade-in space-y-3 rounded-xl border border-border bg-popover p-2.5">
                <div className="max-h-44 space-y-0.5 overflow-y-auto">
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
                      <BrandMark brand={b} dark={dark} />
                      <span className="truncate">{b.name}</span>
                    </button>
                  ))}
                  {brands.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No brands available.</div>
                  )}
                </div>
                {selectedBrand && (
                  <div className="space-y-3 border-t border-border pt-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedBrand.swatches?.length
                        ? selectedBrand.swatches
                        : selectedBrand.colors.map((h) => ({ hex: h, role: '' }))
                      ).map((s, i) => (
                        <span key={`${s.hex}-${i}`} title={s.hex}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-1 pl-1.5 pr-2">
                          <span className="h-4 w-4 rounded border border-border" style={{ backgroundColor: s.hex }} />
                          <span className="leading-tight">
                            <span className="block font-mono text-[10px] font-medium text-foreground">{s.hex.toUpperCase()}</span>
                            {s.role && <span className="block text-[9px] text-muted-foreground">{s.role}</span>}
                          </span>
                        </span>
                      ))}
                    </div>
                    {selectedBrand.logo_svg && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Logo placement
                        </div>
                        <div className="relative aspect-[2.4/1] w-full overflow-hidden rounded-lg border border-border bg-muted">
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
                                  'absolute flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                                  pos,
                                  on ? 'border-primary bg-primary/20' : 'border-border bg-card/70 hover:border-foreground/40',
                                )}
                              >
                                {on && <span className="h-3 w-3 rounded-sm bg-primary/80" />}
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
                )}
              </div>
            )}

            {barPopover === 'lang' && (
              <div className="animate-fade-in max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-popover p-2">
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
                    <img src={`https://flagcdn.com/h20/${l.cc}.png`} alt=""
                         className="h-3.5 w-auto rounded-[2px]" loading="lazy" />
                    <span className="truncate">{l.label}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setBarPopover((p) => (p === 'model' ? null : 'model'))}
              aria-label="Model and image quality settings"
              aria-expanded={barPopover === 'model'}
              className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {MODEL_LABELS[model] ?? model} · {QUALITY_LABELS[quality] ?? quality}
                {EFFORT_ETA[effort] ? ` · ${EFFORT_ETA[effort]}` : ''}
              </span>
              <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 opacity-60 transition-transform',
                barPopover === 'model' && 'rotate-180')} />
            </button>
            {barPopover === 'model' && (
              <div className="animate-fade-in space-y-3 rounded-xl border border-border bg-popover p-3">
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
                <Field
                  label="Thinking"
                  hint={`GPT-5.5${EFFORT_ETA[effort] ? ` · ${EFFORT_ETA[effort]}` : ''}`}
                >
                  <Select value={effort} onValueChange={setEffort}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {efforts.map((ef) => (
                        <SelectItem key={ef.value} value={ef.value}>
                          <span className="flex w-full items-center justify-between gap-4">
                            {ef.label}
                            {EFFORT_ETA[ef.value] && (
                              <span className="text-xs text-muted-foreground">{EFFORT_ETA[ef.value]}</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </section>

          {/* 2 · Versions — the copy. V1, V2, V3… exactly like the CreativeOPS
              catalogue names banner versions. */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold tracking-tight text-foreground">Versions</h2>
              <button
                type="button"
                onClick={() => setCopyDetectOpen(true)}
                title="Paste a block of text and split it into versions"
                aria-label="Paste copy and split it into versions"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                <ScanText className="h-3.5 w-3.5" /> Paste copy
              </button>
            </div>

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
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-lg bg-primary px-1 font-display text-xs font-bold text-primary-foreground">
                      V{i + 1}
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
          </section>

          {/* 3 · Art direction — free text, the Art Director, style references. */}
          <section
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragOver) setDragOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addRefs(e.dataTransfer.files)
            }}
            className={cn('relative space-y-2 rounded-xl transition-colors', dragOver && 'ring-2 ring-primary/50')}
          >
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-primary bg-card/95 px-4 text-center backdrop-blur-md">
                <ImagePlus className="h-6 w-6 text-primary" />
                <span className="font-display text-sm font-semibold text-foreground">Drop images</span>
                <span className="text-[11px] text-muted-foreground">
                  used as style reference only (visual style, not text)
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold tracking-tight text-foreground">Art direction</h2>
              <button
                type="button"
                onClick={() => setArtOpen(true)}
                title="Art Director"
                aria-label="Open Art Director"
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors',
                  isArtActive(art) || style.trim()
                    ? 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
                )}
              >
                <Paintbrush className="h-3.5 w-3.5" /> Art Director
                {artActiveCount(art) > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {artActiveCount(art)}
                  </span>
                )}
              </button>
            </div>
            <div className="flex items-stretch gap-2">
              <Textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                rows={2}
                aria-label="Describe the banners"
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
                          aria-label="Remove reference image"
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
                        aria-label="Attach style-reference images"
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
                aria-label="Upload style-reference images"
                onChange={(e) => {
                  addRefs(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
          </section>

          {/* 4 · Sizes — a Monday task's sizes are the request itself, so they
              show as a done deal (no catalogue); manual builds and edits get
              the full picker. */}
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-bold tracking-tight text-foreground">Sizes</h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {sizes.size} selected
            </span>
          </div>

          {sizesLocked && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const m = masterOf(Array.from(sizes))
                  const ordered = [m, ...Array.from(sizes).filter((s) => s !== m)]
                  return ordered.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 font-display text-xs font-semibold text-foreground"
                    >
                      {s}
                      {s === m && (
                        <span className="rounded bg-primary px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-primary-foreground">
                          Master
                        </span>
                      )}
                    </span>
                  ))
                })()}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">From the Monday request.</p>
                <button
                  type="button"
                  onClick={() => setSizesLocked(false)}
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Edit sizes
                </button>
              </div>
            </div>
          )}

          {!sizesLocked && (<>
          {/* Search first — the fastest path to a size sits on top of the rail. */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={sizeQuery}
              onChange={(e) => setSizeQuery(e.target.value)}
              onPaste={(e) => {
                if (applyPastedSizes(e.clipboardData.getData('text'))) e.preventDefault()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && applyPastedSizes(sizeQuery)) e.preventDefault()
              }}
              aria-label="Search banner sizes"
              placeholder="Search — or paste many sizes (e.g. 1080x1080, 300x250)"
              className="h-8 w-full rounded-md border border-input bg-secondary pl-8 pr-7 text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
            {sizeQuery && (
              <button
                type="button"
                onClick={() => setSizeQuery('')}
                title="Clear"
                aria-label="Clear size search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Bundles — one-click size sets (admin-managed), in their own section. */}
          {bundles.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Bundles
              </div>
              {bundles.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => applyBundle(b)}
                  title={`Select this bundle: ${bundleSelection(b).join(', ')}`}
                  aria-pressed={bundleActive(b)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                    bundleActive(b)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card hover:border-primary/50',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <Layers className="h-3.5 w-3.5" /> {b.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {b.sizes.join(' · ').replace(/x/g, '×')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {sizeQuery.trim() ? (
            (() => {
              const q = sizeQuery.trim().toLowerCase()
              const matches = allSizes.filter((s) => s.toLowerCase().includes(q))
              // A well-formed WxH the app doesn't know yet → offer to save it as
              // a custom size (it lands in the shared "Custom sizes" group).
              const norm = q.replace(/[×*]/g, 'x').replace(/\s+/g, '')
              const addable = /^\d{2,4}x\d{2,4}$/.test(norm) && !allSizes.includes(norm)
              return (
                <div className="space-y-2">
                  {matches.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">{matches.map(renderSizeChip)}</div>
                  )}
                  {!matches.length && !addable && (
                    <p className="px-1 py-1 text-xs text-muted-foreground">
                      No sizes match “{sizeQuery}”. Type a full size (e.g. 500x500) to add it as custom.
                    </p>
                  )}
                  {addable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-dashed"
                      disabled={customBusy}
                      onClick={() => void addCustomSize(norm, true)}
                      title="Save this size to the shared Custom sizes group and select it"
                    >
                      {customBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add custom size {norm}
                    </Button>
                  )}
                </div>
              )
            })()
          ) : (
            <div className="space-y-1.5">
              {sizeGroups.map((p) => {
                const avail = p.sizes.filter((s) => allSizes.includes(s))
                const isCustomGroup = p.id === customGroupId
                if (!avail.length && !isCustomGroup) return null
                const open = openGroups.has(p.label)
                const selCount = avail.filter((s) => sizes.has(s)).length
                return (
                  <div key={p.id} className="overflow-hidden rounded-lg border border-border">
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
                    {open && (
                      <div className="space-y-2 p-2">
                        {avail.length > 0 && (
                          <div className="grid grid-cols-2 gap-2">{avail.map(renderSizeChip)}</div>
                        )}
                        {isCustomGroup && (
                          <CustomSizeInput busy={customBusy} onAdd={(v) => void addCustomSize(v, true)} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </>)}
        </div>

        {/* Generate — pinned under the brief, always in reach. */}
        <div className="shrink-0 space-y-2 border-t border-border p-4">
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
          <Button
            className={cn(
              'w-full bg-emerald-600 font-display text-white hover:bg-emerald-700',
              canRun && !submitting && 'tb-glow-success',
            )}
            size="lg"
            onClick={startRun}
            disabled={!canRun || submitting}
            title="Generate banners — you can start more while others are running"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate
              </>
            )}
          </Button>
          <p className="text-center text-[11px] tabular-nums text-muted-foreground">
            {sizes.size} size{sizes.size === 1 ? '' : 's'} · {cards.length} version{cards.length === 1 ? '' : 's'}
            {!canRun && ' — every version needs a title'}
          </p>
        </div>
      </aside>

      {/* ---------------- Centre: results ---------------- */}
      <section className="relative order-3 min-h-[55vh] min-w-0 bg-background lg:order-none lg:min-h-0 lg:flex-1">
        <div className="lg:h-full lg:overflow-y-auto lg:pb-24">
          <OutputPane
            runs={visibleRuns}
            plannedSizes={(() => {
              const m = masterOf(Array.from(sizes))
              return [m, ...Array.from(sizes).filter((s) => s !== m)]
            })()}
            masterSize={masterOf(Array.from(sizes))}
            onDeleteBanner={deleteBanner}
            onCancel={cancelRuns}
            onCancelRun={cancelOneRun}
            currentUserEmail={myEmail}
            isAdmin={user?.role === 'admin'}
            onApprove={approveVersion}
            onReject={rejectVersion}
            onRegenerate={regenerateBannerFrame}
            onRefined={handleRefined}
            onSendToLibrary={handleSendToLibrary}
            onAddSizes={addSizesToVersion}
            availableSizes={allSizes}
            sizeGroups={sizeGroups}
            onAddCustomSize={(s) => addCustomSize(s, false)}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleVersion={toggleVersion}
          />
        </div>





        {/* Selection console — replaces the Generate console while banners are picked. */}
        {selected.size > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-3 lg:absolute lg:bottom-5 lg:pb-0">
            <div className="relative flex w-full max-w-xl animate-fade-up items-center gap-3 rounded-2xl border border-primary/40 bg-card/95 p-3 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85),0_12px_28px_-10px_rgba(0,0,0,0.6)] ring-1 ring-black/5 backdrop-blur-md">
              <div className="flex shrink-0 items-center gap-3 pl-1">
                {/* Fanned deck of abstract blue cards (NOT real banners) — just a
                    visual cue of the stack. Grows to 3 cards as you select; beyond
                    3 only the number animates. Different shades show the layering. */}
                {(() => {
                  const deck = Math.min(selected.size, 3)
                  const mid = (deck - 1) / 2
                  // Stroke = the blue shade; fill = a darker blue of the same hue.
                  const strokes = ['hsl(217 90% 52%)', 'hsl(217 90% 62%)', 'hsl(217 92% 70%)']
                  const fills = ['hsl(217 60% 15%)', 'hsl(217 58% 19%)', 'hsl(217 56% 23%)']
                  const SPREAD = 8 // small horizontal gap — cards overlap as a tight stack
                  return (
                    <div
                      className="relative h-9 shrink-0 transition-all duration-300"
                      style={{ width: `${26 + (deck - 1) * SPREAD + 8}px` }}
                    >
                      {Array.from({ length: deck }).map((_, i) => (
                        <span
                          key={i}
                          // fade-in (opacity only) — NOT pop-in, whose keyframe sets
                          // `transform` with fill-mode:both and would clobber the
                          // fan transform below, stacking the cards.
                          className="absolute bottom-0 left-1 h-8 w-6 animate-fade-in rounded-md border shadow-md transition-transform duration-300"
                          style={{
                            transformOrigin: 'bottom center',
                            transform: `translateX(${i * SPREAD}px) translateY(${-Math.abs(i - mid) * 2}px) rotate(${(i - mid) * 10}deg)`,
                            zIndex: i,
                            borderColor: strokes[i] ?? strokes[strokes.length - 1],
                            backgroundColor: fills[i] ?? fills[fills.length - 1],
                          }}
                        />
                      ))}
                    </div>
                  )
                })()}
                <span className="text-sm font-medium text-foreground">
                  <span
                    key={selected.size}
                    className="inline-block animate-pop-in font-display text-base font-bold tabular-nums text-primary"
                  >
                    {selected.size}
                  </span>{' '}
                  Selected
                </span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button asChild size="lg" className="bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href={selectionZipUrl(selectedItems)} download>
                    <Download className="h-4 w-4" /> Download ZIP
                  </a>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={deleteSelectedBanners}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={clearSelection}
                  title="Clear selection"
                  aria-label="Clear selection"
                  className="h-11 w-11 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <ArtDirectionModal
          open={artOpen}
          onClose={() => setArtOpen(false)}
          art={art}
          onChange={patchArt}
          onReset={() => setArt(DEFAULT_ART)}
          languageLabel={localeLabel}
        />
      </section>

      <CopyDetectModal
        open={copyDetectOpen}
        onClose={() => setCopyDetectOpen(false)}
        onDetected={applyDetected}
      />

      {/* Size-rail toast: paste feedback, custom-size results, failed actions.
          Auto-fades after 5s, closeable */}
      {sizeNotice && (
        <div className="animate-fade-up fixed left-1/2 top-4 z-[200] w-full max-w-md -translate-x-1/2 px-4">
          <div
            className={cn(
              'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md',
              sizeNotice.unsupported.length || (sizeNotice.message && sizeNotice.added === 0)
                ? 'border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300'
                : 'border-primary/40 bg-primary/10 text-primary',
            )}
          >
            <div className="min-w-0 flex-1">
              {sizeNotice.message ? (
                <div className="font-medium">{sizeNotice.message}</div>
              ) : (
                <>
                  {sizeNotice.added > 0 && (
                    <div className="font-medium">
                      Added {sizeNotice.added} size{sizeNotice.added === 1 ? '' : 's'}.
                    </div>
                  )}
                  {sizeNotice.unsupported.length > 0 && (
                    <div className={sizeNotice.added > 0 ? 'mt-0.5' : 'font-medium'}>
                      Not supported here: {sizeNotice.unsupported.join(', ')}
                    </div>
                  )}
                  {sizeNotice.added === 0 && sizeNotice.unsupported.length === 0 && (
                    <div>No new sizes found in the pasted text.</div>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSizeNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
      )}
    </div>
  )
}

/** Inline "width x height + Add" row inside the Custom sizes group. */
function CustomSizeInput({ busy, onAdd }: { busy: boolean; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('')
  function submit() {
    if (!value.trim() || busy) return
    onAdd(value)
    setValue('')
  }
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        aria-label="New custom size (width x height)"
        placeholder="e.g. 500x500"
        className="h-8 w-full min-w-0 flex-1 rounded-md border border-input bg-secondary px-2.5 text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 px-2.5 text-xs"
        disabled={busy || !value.trim()}
        onClick={submit}
        title="Save as a shared custom size"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add
      </Button>
    </div>
  )
}

// ---- small presentational helpers ----

/** A brand's real mark, smallest first: the square registry icon, else the
 *  wordmark, else (logo-less records) the palette dots as a last resort. */
function BrandMark({ brand, dark }: { brand: Brand; dark: boolean }) {
  if (brand.icon_svg) {
    return (
      <img
        src={brandLogoUri(brand.icon_svg, false)}
        alt=""
        className="h-5 w-5 shrink-0 rounded bg-white object-contain ring-1 ring-black/5"
      />
    )
  }
  if (brand.logo_svg) {
    return (
      <img
        src={brandLogoSrc(brand, dark)}
        alt=""
        className="h-4 max-w-20 shrink-0 rounded-sm bg-white object-contain p-0.5 ring-1 ring-black/5"
      />
    )
  }
  return (
    <span className="flex shrink-0 -space-x-1">
      {brand.colors.slice(0, 3).map((c) => (
        <span key={c} className="h-3 w-3 rounded-full border border-card" style={{ backgroundColor: c }} />
      ))}
    </span>
  )
}

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
      role="alert"
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

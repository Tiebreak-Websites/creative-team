import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Eraser,
  Eye,
  GripVertical,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  ScanText,
  Sparkles,
  Trash2,
  Type,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatUserName } from '@/lib/utils'
import { useAuth } from '../auth/AuthContext'
import type { RunData } from '../types'
import { addSizes, assetUrl } from '../api'
import { listRuns } from './campaignApi'
import { AddSizesModal } from './BannerLibrary'
import { addCustomSize as addCustomSizeApi, getSizeConfig, type SizeConfig } from './sizesApi'
import {
  acceptEdit,
  createEdit,
  detectText,
  getEditJob,
  uploadEditSource,
  type DetectedBlock,
  type EditJob,
  type EditSource,
} from './editApi'

/** One marked correction region (coords in % of the image, 0-100). */
interface Region {
  id: string
  x: number
  y: number
  w: number
  h: number
  current: string
  next: string
  /** "replace" renders new text; "remove" erases the marked text for good. */
  mode: 'replace' | 'remove'
}

interface SourceState {
  source: EditSource
  url: string
  width: number
  height: number
  title: string
  editedFrom?: { run_id: string; label: string }
}

interface CardPos {
  x: number
  y: number
}

let regionUid = 0
const newRegionId = () => `rg${++regionUid}`

const CARD_W = 240

/**
 * Banner **Edit** workspace — canvas v2. The banner floats center-left; every
 * marked region gets a floating card whose connector line points at the
 * region's NUMBER badge. Candidates stack in a column on the right. One-row
 * command console at the bottom; after accepting, a post-accept console takes
 * its place (pick sizes → its own Generate starts the recompose).
 */
export function BannerEdit() {
  const [src, setSrc] = useState<SourceState | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [cardPos, setCardPos] = useState<Record<string, CardPos>>({})
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<DetectedBlock[]>([])
  const [typography, setTypography] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high')
  const [extraSizes, setExtraSizes] = useState<string[]>([])
  const [sizesOpen, setSizesOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<EditJob | null>(null)
  const [viewCandidate, setViewCandidate] = useState<number | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [accepted, setAccepted] = useState<RunData | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [recomposing, setRecomposing] = useState(false)
  const [recomposeNote, setRecomposeNote] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [sizeConfig, setSizeConfig] = useState<SizeConfig | null>(null)
  useEffect(() => {
    getSizeConfig().then(setSizeConfig).catch(() => {})
  }, [])

  // Poll a running job.
  useEffect(() => {
    if (!job || job.status !== 'running') return
    let alive = true
    const iv = window.setInterval(async () => {
      try {
        const fresh = await getEditJob(job.job_id)
        if (alive) setJob(fresh)
      } catch {
        /* transient */
      }
    }, 2500)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [job])

  useEffect(() => {
    if (!job || viewCandidate !== null) return
    const first = job.candidates.find((c) => c?.ready)
    if (first) setViewCandidate(first.index)
  }, [job, viewCandidate])

  function resetForSource(next: SourceState | null) {
    setSrc(next)
    setRegions([])
    setCardPos({})
    setActiveRegion(null)
    setBlocks([])
    setTypography('')
    setJob(null)
    setViewCandidate(null)
    setAccepted(null)
    setRecomposing(false)
    setRecomposeNote('')
    setExtraSizes([])
    setError(null)
  }

  /** True when leaving now would lose work — gates the Exit button. */
  const dirty =
    regions.some((r) => r.next.trim() || r.mode === 'remove') ||
    (!!job && !accepted)
  function exitEdit() {
    if (dirty && !window.confirm('Discard this edit?')) return
    resetForSource(null)
  }

  async function onUpload(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setError(null)
    try {
      const up = await uploadEditSource(file)
      resetForSource({
        source: { upload: up.id },
        url: up.url,
        width: up.width,
        height: up.height,
        title: file.name.replace(/\.(png|jpe?g|webp)$/i, ''),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Text detection runs AUTOMATICALLY on attach so drawn regions prefill.
  const detectRan = useRef<string>('')
  useEffect(() => {
    if (!src) return
    const key = JSON.stringify(src.source)
    if (detectRan.current === key) return
    detectRan.current = key
    setDetecting(true)
    detectText(src.source)
      .then((d) => {
        setBlocks(d.blocks)
        setTypography(d.typography)
      })
      .catch(() => {
        /* silent — manual marking still works */
      })
      .finally(() => setDetecting(false))
  }, [src])

  function textInRect(r: { x: number; y: number; w: number; h: number }): string {
    const hits = blocks.filter((b) => {
      const ix = Math.max(0, Math.min(r.x + r.w, b.x_pct + b.w_pct) - Math.max(r.x, b.x_pct))
      const iy = Math.max(0, Math.min(r.y + r.h, b.y_pct + b.h_pct) - Math.max(r.y, b.y_pct))
      return ix * iy > 0.3 * (b.w_pct * b.h_pct)
    })
    return hits.map((b) => b.text).join(' ').trim()
  }

  function addRegion(rect: { x: number; y: number; w: number; h: number }) {
    const id = newRegionId()
    setRegions((prev) => [
      ...prev,
      { ...rect, id, current: textInRect(rect), next: '', mode: 'replace' },
    ])
    setActiveRegion(id)
  }

  function regionsFromBlocks() {
    if (!blocks.length) {
      setError('No text blocks were detected on this image — draw a box over the text instead.')
      return
    }
    setRegions(
      blocks.map((b) => ({
        id: newRegionId(),
        x: b.x_pct,
        y: b.y_pct,
        w: b.w_pct,
        h: b.h_pct,
        current: b.text,
        next: '',
        mode: 'replace' as const,
      })),
    )
    setCardPos({})
    setActiveRegion(null)
  }

  function patchRegion(id: string, patch: Partial<Region>) {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRegion(id: string) {
    setRegions((prev) => prev.filter((r) => r.id !== id))
    setCardPos((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeRegion === id) setActiveRegion(null)
  }

  // A region is runnable when it has replacement text OR is a removal.
  const readyRegions = regions.filter((r) => r.mode === 'remove' || r.next.trim())

  function snapToBlocks(r: Region): Region {
    let { x, y, w, h } = r
    for (const b of blocks) {
      const ix = Math.max(0, Math.min(x + w, b.x_pct + b.w_pct) - Math.max(x, b.x_pct))
      const iy = Math.max(0, Math.min(y + h, b.y_pct + b.h_pct) - Math.max(y, b.y_pct))
      if (ix * iy > 0.3 * (b.w_pct * b.h_pct)) {
        const nx = Math.min(x, b.x_pct)
        const ny = Math.min(y, b.y_pct)
        w = Math.max(x + w, b.x_pct + b.w_pct) - nx
        h = Math.max(y + h, b.y_pct + b.h_pct) - ny
        x = nx
        y = ny
      }
    }
    return { ...r, x, y, w, h }
  }

  async function generate() {
    if (!src || starting || readyRegions.length === 0) return
    setStarting(true)
    setError(null)
    setJob(null)
    setViewCandidate(null)
    setAccepted(null)
    setRecomposeNote('')
    setActiveRegion(null)
    const snapped = readyRegions.map(snapToBlocks)
    setRegions((prev) => prev.map((r) => snapped.find((s) => s.id === r.id) ?? r))
    try {
      const j = await createEdit({
        source: src.source,
        regions: snapped.map((r) => ({
          x_pct: r.x,
          y_pct: r.y,
          w_pct: r.w,
          h_pct: r.h,
          current_text: r.current || undefined,
          new_text: r.next.trim(),
          mode: r.mode,
        })),
        candidates: 2,
        quality,
        typography: typography || undefined,
      })
      setJob(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  async function accept(index: number) {
    if (!job || accepting) return
    setAccepting(true)
    setError(null)
    try {
      const run = await acceptEdit(job.job_id, index, {
        title:
          readyRegions.find((r) => r.mode === 'replace')?.next.trim() || src?.title,
        editedFrom: src?.editedFrom,
      })
      setAccepted(run)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAccepting(false)
    }
  }

  // Deferred recompose: sizes are only CHIPS until the post-accept console's
  // Generate is pressed — same recompose path as the Banner Builder (the
  // accepted image is a fresh MVP master; add_sizes recomposes off it).
  const acceptedSize = accepted?.banners?.[0]?.size
  async function startRecompose() {
    if (!accepted || !extraSizes.length || recomposing) return
    setRecomposing(true)
    setError(null)
    try {
      await addSizes(accepted.run_id, 'c1', extraSizes)
      setRecomposeNote(
        `Recomposing ${extraSizes.length} size${extraSizes.length > 1 ? 's' : ''} — watch them fill in under Generate.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRecomposing(false)
    }
  }

  async function addCustomSize(text: string): Promise<string | null> {
    const norm = (text || '').trim().toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '')
    if (!/^\d{2,4}x\d{2,4}$/.test(norm)) {
      setError(`“${text.trim()}” is not a size — use width x height, e.g. 500x500.`)
      return null
    }
    if (sizeConfig?.sizes.includes(norm)) return norm
    try {
      const cfg = await addCustomSizeApi(norm)
      setSizeConfig(cfg)
      return norm
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  const currentCandidate =
    job && viewCandidate !== null
      ? job.candidates.find((c) => c?.ready && c.index === viewCandidate) ?? null
      : null
  const stageUrl =
    showOriginal || !currentCandidate ? src?.url ?? '' : currentCandidate.url ?? src?.url ?? ''

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      {error && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-50 flex w-full max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-lg backdrop-blur"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Upload a banner to edit"
        onChange={(e) => {
          void onUpload(e.target.files)
          e.target.value = ''
        }}
      />

      {!src ? (
        <EmptyDropzone
          onFiles={(f) => void onUpload(f)}
          onUpload={() => fileRef.current?.click()}
          onGallery={() => setGalleryOpen(true)}
        />
      ) : (
        <>
          {/* Exit — top-right of the canvas */}
          <button
            type="button"
            onClick={exitEdit}
            title="Close this edit"
            aria-label="Close this edit"
            className="absolute right-4 top-4 z-40 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/90 text-muted-foreground shadow backdrop-blur transition-colors hover:border-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>

          <EditCanvas
            url={stageUrl}
            regions={currentCandidate && !showOriginal ? [] : regions}
            cardPos={cardPos}
            setCardPos={setCardPos}
            activeRegion={activeRegion}
            setActiveRegion={setActiveRegion}
            onAddRegion={addRegion}
            onPatchRegion={patchRegion}
            onRemoveRegion={removeRegion}
            disabled={!!currentCandidate && !showOriginal}
            shiftForColumn={!!job && !accepted}
          />

          {/* -------- candidates: vertical column on the RIGHT -------- */}
          {job && !accepted && (
            <div className="absolute bottom-28 right-6 top-6 z-30 flex w-56 flex-col gap-3">
              {/* status on top */}
              <div className="shrink-0 rounded-xl border border-border bg-card/95 px-3 py-2 text-center shadow backdrop-blur">
                {job.status === 'running' ? (
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    Generating candidates…
                  </span>
                ) : job.status === 'failed' ? (
                  <span className="text-xs font-medium text-destructive">
                    Generation failed{job.error ? `: ${job.error}` : ''}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-foreground">Pick the best one</span>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                {job.candidates.map((c, i) =>
                  c?.ready && c.url ? (
                    <div
                      key={i}
                      className={cn(
                        'overflow-hidden rounded-xl border bg-card shadow-md transition-all',
                        viewCandidate === c.index
                          ? 'border-primary ring-2 ring-primary/40'
                          : 'border-border hover:border-foreground/25',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setViewCandidate(c.index)}
                        className="block w-full"
                        title="Preview this candidate on the canvas"
                      >
                        <img src={c.url} alt={`Candidate ${i + 1}`} className="max-h-36 w-full object-contain" />
                      </button>
                      <div className="space-y-1.5 border-t border-border p-2">
                        <QaBadge qaOk={c.qa_ok} qaRead={c.qa_read} />
                        <Button
                          size="sm"
                          className="h-7 w-full text-xs"
                          disabled={accepting}
                          onClick={() => void accept(c.index)}
                        >
                          {accepting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Use this
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/40 p-2 text-center"
                    >
                      {c?.error ? (
                        <>
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          <span className="text-[11px] text-destructive">{c.error}</span>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">Candidate {i + 1}…</span>
                        </>
                      )}
                    </div>
                  ),
                )}
              </div>

              {/* compare at the bottom */}
              {currentCandidate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full shrink-0 shadow"
                  onPointerDown={() => setShowOriginal(true)}
                  onPointerUp={() => setShowOriginal(false)}
                  onPointerLeave={() => setShowOriginal(false)}
                  title="Hold to see the original"
                >
                  <Eye className="h-4 w-4" /> Hold to compare
                </Button>
              )}
            </div>
          )}

          {/* -------- bottom console: main OR post-accept (same spot) -------- */}
          <div className="absolute inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
            {accepted ? (
              /* Post-accept console REPLACES the main one: pick sizes, then ITS
                 Generate starts the recompose (nothing runs before that). */
              <div className="flex w-full max-w-3xl flex-nowrap items-center gap-2 overflow-x-auto rounded-2xl border border-emerald-600/40 bg-card/95 p-2 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85),0_12px_28px_-10px_rgba(0,0,0,0.6)] ring-1 ring-black/5 backdrop-blur-md">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" /> Saved
                </span>
                <Divider />
                {recomposeNote ? (
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                    {recomposeNote}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSizesOpen(true)}
                      title="Pick the sizes to recompose this corrected banner into"
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 font-display text-[13px] font-medium text-foreground transition-colors hover:border-foreground/25"
                    >
                      <Ruler className="h-4 w-4" /> Pick sizes
                    </button>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                      {extraSizes.length === 0 ? (
                        <span className="truncate text-xs text-muted-foreground">
                          No sizes selected yet — the corrected banner is a fresh MVP master.
                        </span>
                      ) : (
                        extraSizes.map((s) => (
                          <span
                            key={s}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary bg-primary/10 py-0.5 pl-2.5 pr-1.5 font-display text-xs font-semibold text-primary"
                          >
                            {s}
                            <button
                              type="button"
                              onClick={() => setExtraSizes((prev) => prev.filter((x) => x !== s))}
                              title={`Remove ${s}`}
                              aria-label={`Remove size ${s}`}
                              className="hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </span>
                    <Button
                      size="lg"
                      className="shrink-0 bg-emerald-600 px-6 font-display text-white hover:bg-emerald-700"
                      disabled={!extraSizes.length || recomposing}
                      onClick={() => void startRecompose()}
                      title={
                        extraSizes.length
                          ? 'Recompose the corrected banner into the selected sizes'
                          : 'Pick at least one size first'
                      }
                    >
                      {recomposing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Generate
                    </Button>
                  </>
                )}
                <Divider />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => resetForSource(null)}
                  title="Finish and start another edit"
                >
                  <Pencil className="h-4 w-4" /> Edit another
                </Button>
              </div>
            ) : (
              /* Main console — ONE row, big Generate. */
              <div className="flex w-full max-w-3xl flex-nowrap items-center gap-2 overflow-x-auto rounded-2xl border border-border bg-card/95 p-2 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85),0_12px_28px_-10px_rgba(0,0,0,0.6)] ring-1 ring-black/5 backdrop-blur-md">
                <span
                  className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40"
                  title={`${src.title || 'attached'} · ${src.width}×${src.height}`}
                >
                  <img src={src.url} alt="Current banner" className="h-full w-full object-cover" />
                </span>
                <ConsoleAction onClick={() => fileRef.current?.click()} title="Upload another image" label="Upload">
                  <Upload className="h-4 w-4" />
                </ConsoleAction>
                <ConsoleAction onClick={() => setGalleryOpen(true)} title="Pick from the gallery" label="Gallery">
                  <ImagePlus className="h-4 w-4" />
                </ConsoleAction>

                <Divider />

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={regionsFromBlocks}
                  disabled={detecting}
                  title="Create a region for every detected text block"
                >
                  {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                  <span className="hidden md:inline">{detecting ? 'Reading…' : 'Auto-detect'}</span>
                </Button>

                <Divider />

                <span className="flex shrink-0 items-center" title="Image model quality">
                  <span className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                    {(['low', 'medium', 'high'] as const).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuality(q)}
                        aria-pressed={quality === q}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                          quality === q
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {q === 'medium' ? 'Med' : q}
                      </button>
                    ))}
                  </span>
                </span>

                <Button
                  size="lg"
                  className={cn(
                    'ml-auto min-w-[150px] shrink-0 bg-emerald-600 px-8 font-display text-base text-white hover:bg-emerald-700',
                    readyRegions.length > 0 && !starting && job?.status !== 'running' && 'tb-glow-success',
                  )}
                  disabled={readyRegions.length === 0 || starting || job?.status === 'running'}
                  onClick={() => void generate()}
                  title={
                    readyRegions.length === 0
                      ? 'Mark a region and type its new text (or set it to Remove) first'
                      : 'Generate the correction'
                  }
                >
                  {starting || job?.status === 'running' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  Generate
                </Button>
              </div>
            )}
          </div>

          {sizesOpen && (
            <div className="absolute inset-0 z-50">
              <AddSizesModal
                groups={sizeConfig?.groups ?? []}
                availableSizes={sizeConfig?.sizes ?? []}
                existingSizes={acceptedSize ? [acceptedSize] : src ? [`${src.width}x${src.height}`] : []}
                onAddCustomSize={addCustomSize}
                onCancel={() => setSizesOpen(false)}
                onGenerate={(sizes) => {
                  // Deferred by design: picking sizes only records them as chips —
                  // the post-accept console's Generate starts the recompose.
                  setExtraSizes(sizes)
                  setSizesOpen(false)
                }}
              />
            </div>
          )}
        </>
      )}

      <GalleryPickModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onPick={(pick) => {
          setGalleryOpen(false)
          resetForSource(pick)
        }}
      />
    </div>
  )
}

function ConsoleAction({
  children,
  onClick,
  title,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-secondary px-2.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      {children}
      <span className="text-[9px] font-medium leading-none">{label}</span>
    </button>
  )
}

const Divider = () => <span aria-hidden className="h-6 w-px shrink-0 bg-border" />

function QaBadge({ qaOk, qaRead }: { qaOk: boolean | null; qaRead: string }) {
  if (qaOk === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" /> Text verified
      </span>
    )
  }
  if (qaOk === false) {
    return (
      <span
        title={qaRead ? `Read as: ${qaRead}` : undefined}
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
      >
        <AlertTriangle className="h-3 w-3" /> Check result
      </span>
    )
  }
  return <span className="inline-block px-2 text-[10px] text-muted-foreground">QA unavailable</span>
}

function EmptyDropzone({
  onFiles,
  onUpload,
  onGallery,
}: {
  onFiles: (f: FileList | null) => void
  onUpload: () => void
  onGallery: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      className="flex h-full items-center justify-center p-8"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <div
        className={cn(
          'w-full max-w-lg rounded-3xl border-2 border-dashed p-10 text-center transition-colors animate-fade-up',
          over ? 'border-primary bg-primary/5' : 'border-border bg-card/40',
        )}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
          <Pencil className="h-6 w-6" />
        </div>
        <h3 className="font-display text-lg font-bold tracking-tight">Fix a banner’s text</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Drag &amp; drop a banner here — or upload / pick one from the gallery. Mark the wrong
          text, replace it or remove it; everything else stays pixel-identical.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={onUpload}>
            <Upload className="h-4 w-4" /> Upload image
          </Button>
          <Button variant="outline" onClick={onGallery}>
            <ImagePlus className="h-4 w-4" /> From gallery
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------
type DragState =
  | { kind: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; id: string; startX: number; startY: number; orig: Region }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; orig: Region }
  | { kind: 'card'; id: string; dx: number; dy: number }
  | null

function EditCanvas({
  url,
  regions,
  cardPos,
  setCardPos,
  activeRegion,
  setActiveRegion,
  onAddRegion,
  onPatchRegion,
  onRemoveRegion,
  disabled,
  shiftForColumn,
}: {
  url: string
  regions: Region[]
  cardPos: Record<string, CardPos>
  setCardPos: React.Dispatch<React.SetStateAction<Record<string, CardPos>>>
  activeRegion: string | null
  setActiveRegion: (id: string | null) => void
  onAddRegion: (r: { x: number; y: number; w: number; h: number }) => void
  onPatchRegion: (id: string, patch: Partial<Region>) => void
  onRemoveRegion: (id: string) => void
  disabled?: boolean
  /** While candidates occupy the right column, shift the banner left. */
  shiftForColumn?: boolean
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const imgBoxRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [imgRect, setImgRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  function measure() {
    const outer = outerRef.current
    const box = imgBoxRef.current
    if (!outer || !box) return
    const o = outer.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    setImgRect({ left: b.left - o.left, top: b.top - o.top, width: b.width, height: b.height })
  }
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (outerRef.current) ro.observe(outerRef.current)
    if (imgBoxRef.current) ro.observe(imgBoxRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, shiftForColumn])

  function pctPoint(e: { clientX: number; clientY: number }) {
    const box = imgBoxRef.current
    if (!box) return null
    const r = box.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    }
  }
  function outerPoint(e: { clientX: number; clientY: number }) {
    const o = outerRef.current?.getBoundingClientRect()
    if (!o) return { x: 0, y: 0 }
    return { x: e.clientX - o.left, y: e.clientY - o.top }
  }

  function defaultCardPos(index: number): CardPos {
    const outer = outerRef.current?.getBoundingClientRect()
    const ir = imgRect
    if (!outer || !ir) return { x: 8, y: 8 + index * 150 }
    const left = Math.max(8, ir.left - CARD_W - 24)
    const right = Math.min(outer.width - CARD_W - 8, ir.left + ir.width + 24)
    const side = index % 2 === 0 ? left : right
    const y = Math.max(8, ir.top + Math.floor(index / 2) * 168)
    return { x: side, y }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    if (drag.kind === 'draw') {
      const p = pctPoint(e)
      if (p) setDrag({ ...drag, x1: p.x, y1: p.y })
    } else if (drag.kind === 'move') {
      const p = pctPoint(e)
      if (!p) return
      const nx = Math.max(0, Math.min(100 - drag.orig.w, drag.orig.x + (p.x - drag.startX)))
      const ny = Math.max(0, Math.min(100 - drag.orig.h, drag.orig.y + (p.y - drag.startY)))
      onPatchRegion(drag.id, { x: nx, y: ny })
    } else if (drag.kind === 'resize') {
      const p = pctPoint(e)
      if (!p) return
      const o = drag.orig
      let x0 = o.x
      let y0 = o.y
      let x1 = o.x + o.w
      let y1 = o.y + o.h
      if (drag.corner.includes('w')) x0 = Math.min(p.x, x1 - 1)
      if (drag.corner.includes('e')) x1 = Math.max(p.x, x0 + 1)
      if (drag.corner.includes('n')) y0 = Math.min(p.y, y1 - 1)
      if (drag.corner.includes('s')) y1 = Math.max(p.y, y0 + 1)
      onPatchRegion(drag.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    } else if (drag.kind === 'card') {
      const p = outerPoint(e)
      setCardPos((prev) => ({ ...prev, [drag.id]: { x: p.x - drag.dx, y: p.y - drag.dy } }))
    }
  }

  function onPointerUp() {
    if (drag?.kind === 'draw') {
      const r = {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
      if (r.w > 1.5 && r.h > 1.5) onAddRegion(r)
    }
    setDrag(null)
  }

  const draftRect =
    drag?.kind === 'draw'
      ? {
          x: Math.min(drag.x0, drag.x1),
          y: Math.min(drag.y0, drag.y1),
          w: Math.abs(drag.x1 - drag.x0),
          h: Math.abs(drag.y1 - drag.y0),
        }
      : null

  /** The connector line points at the region's NUMBER BADGE (top-left), not
   * the region center — the badge is the visual handle of the region. */
  function badgePoint(r: Region) {
    if (!imgRect) return { x: 0, y: 0 }
    return {
      x: imgRect.left + (r.x / 100) * imgRect.width + 12,
      y: imgRect.top + (r.y / 100) * imgRect.height - 10,
    }
  }

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full overflow-hidden pb-28 pt-4"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
        {imgRect &&
          regions.map((r, i) => {
            const pos = cardPos[r.id] ?? defaultCardPos(i)
            const b = badgePoint(r)
            const cardCx = pos.x + CARD_W / 2
            const fromX = cardCx < b.x ? pos.x + CARD_W : pos.x
            const fromY = pos.y + 24
            return (
              <g key={r.id}>
                <line
                  x1={fromX}
                  y1={fromY}
                  x2={b.x}
                  y2={b.y}
                  stroke="hsl(217 90% 55%)"
                  strokeWidth={activeRegion === r.id ? 2 : 1.25}
                  strokeDasharray="5 4"
                  opacity={0.7}
                />
                <circle cx={b.x} cy={b.y} r={3.5} fill="hsl(217 90% 55%)" opacity={0.9} />
              </g>
            )
          })}
      </svg>

      <div
        className={cn(
          'flex h-full items-center justify-center transition-[padding]',
          shiftForColumn && 'pr-72',
        )}
      >
        <div
          ref={imgBoxRef}
          className={cn(
            'relative max-h-[56vh] max-w-[52%] select-none overflow-hidden rounded-xl border border-border shadow-xl',
            !disabled && 'cursor-crosshair',
          )}
          onPointerDown={(e) => {
            if (disabled) return
            const p = pctPoint(e)
            if (!p) return
            setActiveRegion(null)
            try {
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
            } catch {
              /* best-effort */
            }
            setDrag({ kind: 'draw', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
        >
          <img src={url} alt="Banner being edited" className="block max-h-[56vh] max-w-full" draggable={false} onLoad={measure} />
          {regions.map((r, i) => {
            const active = activeRegion === r.id
            const removeMode = r.mode === 'remove'
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={`Region ${i + 1}${active ? ' (editing — drag to move, corners to resize)' : ''}`}
                title={active ? 'Drag to move · corners to resize' : 'Double-click to move/resize'}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setActiveRegion(r.id)
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (!active) return
                  const p = pctPoint(e)
                  if (!p) return
                  setDrag({ kind: 'move', id: r.id, startX: p.x, startY: p.y, orig: { ...r } })
                }}
                className={cn(
                  'absolute rounded border-2',
                  removeMode
                    ? 'border-red-500 bg-red-500/10'
                    : r.next.trim()
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-primary bg-primary/10',
                  active && 'cursor-move border-amber-400 bg-amber-400/10 ring-2 ring-amber-400/40',
                )}
                style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
              >
                <span
                  className={cn(
                    'absolute -left-px -top-5 rounded px-1.5 font-display text-[11px] font-bold text-primary-foreground',
                    removeMode ? 'bg-red-500' : 'bg-primary',
                  )}
                >
                  {i + 1}
                </span>
                {active &&
                  (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <span
                      key={corner}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setDrag({ kind: 'resize', id: r.id, corner, orig: { ...r } })
                      }}
                      className={cn(
                        'absolute z-10 h-3 w-3 rounded-full border-2 border-background bg-amber-400',
                        corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                        corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                        corner === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                        corner === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                      )}
                    />
                  ))}
              </div>
            )
          })}
          {draftRect && (
            <div
              className="absolute rounded border-2 border-dashed border-primary bg-primary/10"
              style={{
                left: `${draftRect.x}%`,
                top: `${draftRect.y}%`,
                width: `${draftRect.w}%`,
                height: `${draftRect.h}%`,
              }}
            />
          )}
        </div>
      </div>

      {/* floating cards */}
      {regions.map((r, i) => {
        const pos = cardPos[r.id] ?? defaultCardPos(i)
        const removeMode = r.mode === 'remove'
        return (
          <div
            key={r.id}
            className={cn(
              'absolute z-20 rounded-xl border bg-card/95 shadow-lg backdrop-blur transition-shadow',
              activeRegion === r.id
                ? 'border-amber-400/60'
                : removeMode
                  ? 'border-red-500/50'
                  : 'border-border',
            )}
            style={{ left: pos.x, top: pos.y, width: CARD_W }}
          >
            <div
              className="flex cursor-grab items-center gap-1.5 rounded-t-xl border-b border-border bg-secondary/60 px-2 py-1.5 active:cursor-grabbing"
              onPointerDown={(e) => {
                const p = outerPoint(e)
                setDrag({ kind: 'card', id: r.id, dx: p.x - pos.x, dy: p.y - pos.y })
              }}
              title="Drag to move this card"
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
              <span
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded font-display text-[10px] font-bold text-primary-foreground',
                  removeMode ? 'bg-red-500' : 'bg-primary',
                )}
              >
                {i + 1}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">
                {r.current ? r.current.slice(0, 26) : 'marked region'}
              </span>
              <button
                type="button"
                onClick={() => onRemoveRegion(r.id)}
                title="Remove this region"
                aria-label={`Remove region ${i + 1}`}
                className="ml-auto text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 p-2">
              {/* Replace / Remove mode switch */}
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary p-0.5">
                <button
                  type="button"
                  onClick={() => onPatchRegion(r.id, { mode: 'replace' })}
                  aria-pressed={!removeMode}
                  title="Replace the marked text with new text"
                  className={cn(
                    'inline-flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors',
                    !removeMode
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Type className="h-3 w-3" /> Replace
                </button>
                <button
                  type="button"
                  onClick={() => onPatchRegion(r.id, { mode: 'remove' })}
                  aria-pressed={removeMode}
                  title="Erase the marked text entirely — background is rebuilt"
                  className={cn(
                    'inline-flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors',
                    removeMode
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Eraser className="h-3 w-3" /> Remove
                </button>
              </div>
              <input
                value={r.current}
                onChange={(e) => onPatchRegion(r.id, { current: e.target.value })}
                placeholder="Current text (auto-detected)"
                aria-label={`Region ${i + 1} current text`}
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px] text-foreground/80 transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
              />
              {removeMode ? (
                <p className="rounded-md border border-dashed border-red-500/40 bg-red-500/5 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  This text will be <b className="font-semibold text-red-500">removed</b> — the
                  background is rebuilt seamlessly.
                </p>
              ) : (
                <textarea
                  value={r.next}
                  onChange={(e) => onPatchRegion(r.id, { next: e.target.value })}
                  rows={2}
                  placeholder="New text — exactly as it should read"
                  aria-label={`Region ${i + 1} new text`}
                  className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium text-foreground transition-colors placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
                />
              )}
            </div>
          </div>
        )
      })}

      {regions.length === 0 && !disabled && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center">
          <span className="rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow backdrop-blur">
            Drag a box over the wrong text — or hit <b className="font-semibold text-foreground">Auto-detect</b> below
          </span>
        </div>
      )}
    </div>
  )
}

/** One selectable banner tile inside a picker batch. */
interface PickItem {
  label: string
  url: string
  size: string
  title: string
  width: number
  height: number
  master: boolean
}

/** A whole generation (run) grouped like the main gallery. */
interface PickBatch {
  runId: string
  title: string
  by: string
  at: string
  versions: { n: number; items: PickItem[] }[]
}

function pickBatches(runs: RunData[]): PickBatch[] {
  // The server list is newest-first already — keep that order.
  const out: PickBatch[] = []
  for (const run of runs) {
    const byConcept = new Map<string, PickItem[]>()
    const order: string[] = []
    for (const b of run.banners) {
      if (b.status !== 'ok' || !b.url) continue
      if (!byConcept.has(b.concept)) {
        byConcept.set(b.concept, [])
        order.push(b.concept)
      }
      const [w, h] = b.size.split('x').map(Number)
      byConcept.get(b.concept)!.push({
        label: b.label,
        url: assetUrl(b.url),
        size: b.size,
        title: b.title,
        width: w || 0,
        height: h || 0,
        master: b.phase === 'master',
      })
    }
    if (!order.length) continue
    const versions = order.map((ck, i) => {
      const m = /(\d+)/.exec(ck)
      const items = byConcept.get(ck)!
      // Master first, then by pixel area — same as the main gallery.
      items.sort((a, b) => (Number(b.master) - Number(a.master)) || a.width * a.height - b.width * b.height)
      return { n: m ? parseInt(m[1], 10) : i + 1, items }
    })
    out.push({
      runId: run.run_id,
      title: versions[0].items.find((x) => x.title)?.title ?? '',
      by: run.created_by || '',
      at: run.created_at,
      versions,
    })
  }
  return out
}

/**
 * Pick a banner from the shared gallery — organized exactly like the main
 * gallery: newest batches first, grouped per generation with versions, creator
 * and time shown, plus a Mine / Everyone filter. Click ONE banner to attach it.
 */
function GalleryPickModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (src: SourceState) => void
}) {
  const { user } = useAuth()
  const myEmail = (user?.email || '').toLowerCase()
  const [runs, setRuns] = useState<RunData[] | null>(null)
  const [mineOnly, setMineOnly] = useState(true)
  useEffect(() => {
    if (!open) return
    setRuns(null)
    listRuns().then((r) => setRuns(r ?? []))
  }, [open])

  const batches = useMemo(() => pickBatches(runs ?? []), [runs])
  const visible = useMemo(
    () => (mineOnly ? batches.filter((b) => b.by.toLowerCase() === myEmail) : batches),
    [batches, mineOnly, myEmail],
  )

  if (!open) return null
  const segBtn = (on: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
      on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    )
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick a banner to edit"
        className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-fade-up"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
          <ImagePlus className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold">Pick a banner to edit</h2>
          <span className="ml-auto inline-flex shrink-0 items-center rounded-lg border border-border bg-secondary p-0.5">
            <button
              type="button"
              onClick={() => setMineOnly(true)}
              aria-pressed={mineOnly}
              title="Show only your banners"
              className={segBtn(mineOnly)}
            >
              <User className="h-3.5 w-3.5" /> Mine
            </button>
            <button
              type="button"
              onClick={() => setMineOnly(false)}
              aria-pressed={!mineOnly}
              title="Show everyone’s banners"
              className={segBtn(!mineOnly)}
            >
              <Users className="h-3.5 w-3.5" /> Everyone
            </button>
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close gallery picker"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {runs === null ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading banners…
            </div>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {mineOnly && batches.length > 0
                ? 'None of these are yours — switch to Everyone to see the whole gallery.'
                : 'No banners in the gallery yet — generate some first, or upload an image.'}
            </p>
          ) : (
            visible.map((batch) => (
              <section key={batch.runId} className="rounded-2xl border border-border bg-card/40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
                  {batch.title && (
                    <span className="truncate font-display text-[13px] font-semibold">{batch.title}</span>
                  )}
                  {batch.by && (
                    <span className="text-[11px] text-muted-foreground" title={batch.by}>
                      by {formatUserName(batch.by)}
                    </span>
                  )}
                  {batch.at && (
                    <span
                      className="text-[11px] text-muted-foreground/80"
                      title={new Date(batch.at).toLocaleString()}
                    >
                      · {new Date(batch.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                <div className="space-y-3 border-t border-border px-3 py-3">
                  {batch.versions.map((v) => (
                    <div key={v.n}>
                      <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                        Version {v.n}
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5">
                        {v.items.map((it) => (
                          <button
                            key={it.label}
                            type="button"
                            onClick={() =>
                              onPick({
                                source: { run_id: batch.runId, label: it.label },
                                url: it.url,
                                width: it.width,
                                height: it.height,
                                title: it.title,
                                editedFrom: { run_id: batch.runId, label: it.label },
                              })
                            }
                            className="group overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                            title={`Edit this ${it.size}${it.title ? ` · ${it.title}` : ''}`}
                          >
                            <span className="block aspect-square bg-muted/40">
                              <img src={it.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                            </span>
                            <span className="flex items-center justify-between gap-1 border-t border-border px-2 py-1">
                              <span className="truncate font-display text-[11px] font-semibold">{it.size}</span>
                              {it.master && (
                                <span className="shrink-0 rounded border border-primary/35 px-1 text-[9px] text-primary">
                                  MVP
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Eye,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ScanText,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatUserName } from '@/lib/utils'
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
  hints: string
}

interface SourceState {
  source: EditSource
  url: string
  width: number
  height: number
  title: string
  /** provenance for the accepted run, when picked from the gallery */
  editedFrom?: { run_id: string; label: string }
}

let regionUid = 0
const newRegionId = () => `rg${++regionUid}`

/**
 * Banner **Edit** workspace: attach an already-generated banner, mark the text
 * region(s) to fix, type the replacement — the correction is a masked edit and
 * every pixel outside the marked regions is guaranteed to stay the original.
 * An accepted result becomes a normal run and can be recomposed into more sizes.
 */
export function BannerEdit() {
  const [src, setSrc] = useState<SourceState | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [typography, setTypography] = useState('')
  const [candidates, setCandidates] = useState(2)
  const [detecting, setDetecting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<EditJob | null>(null)
  const [viewCandidate, setViewCandidate] = useState<number | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [accepted, setAccepted] = useState<RunData | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [addSizesOpen, setAddSizesOpen] = useState(false)
  const [recomposeNote, setRecomposeNote] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Shared size groups for the add-sizes step (same organization as everywhere).
  const [sizeConfig, setSizeConfig] = useState<SizeConfig | null>(null)
  useEffect(() => {
    getSizeConfig().then(setSizeConfig).catch(() => {})
  }, [])

  // Poll a running job until every candidate settles.
  useEffect(() => {
    if (!job || job.status !== 'running') return
    let alive = true
    const iv = window.setInterval(async () => {
      try {
        const fresh = await getEditJob(job.job_id)
        if (alive) setJob(fresh)
      } catch {
        /* transient poll error — keep trying */
      }
    }, 2500)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [job])

  // Auto-select the first ready candidate so the result appears without a click.
  useEffect(() => {
    if (!job || viewCandidate !== null) return
    const first = job.candidates.find((c) => c?.ready)
    if (first) setViewCandidate(first.index)
  }, [job, viewCandidate])

  function resetForSource(next: SourceState | null) {
    setSrc(next)
    setRegions([])
    setTypography('')
    setJob(null)
    setViewCandidate(null)
    setAccepted(null)
    setRecomposeNote('')
    setError(null)
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

  async function autoDetect() {
    if (!src || detecting) return
    setDetecting(true)
    setError(null)
    try {
      const d = await detectText(src.source)
      setTypography(d.typography)
      if (d.blocks.length) {
        setRegions(
          d.blocks.map((b) => ({
            id: newRegionId(),
            x: b.x_pct,
            y: b.y_pct,
            w: b.w_pct,
            h: b.h_pct,
            current: b.text,
            next: '',
            hints: '',
          })),
        )
      } else {
        setError('No text blocks were detected — draw a box over the text yourself.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetecting(false)
    }
  }

  const readyRegions = regions.filter((r) => r.next.trim())
  async function generate() {
    if (!src || starting || readyRegions.length === 0) return
    setStarting(true)
    setError(null)
    setJob(null)
    setViewCandidate(null)
    setAccepted(null)
    setRecomposeNote('')
    try {
      const j = await createEdit({
        source: src.source,
        regions: readyRegions.map((r) => ({
          x_pct: r.x,
          y_pct: r.y,
          w_pct: r.w,
          h_pct: r.h,
          current_text: r.current || undefined,
          new_text: r.next.trim(),
          hints: r.hints || undefined,
        })),
        candidates,
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
        title: readyRegions[0]?.next.trim() || src?.title,
        editedFrom: src?.editedFrom,
      })
      setAccepted(run)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAccepting(false)
    }
  }

  const acceptedSize = accepted?.banners?.[0]?.size
  async function recomposeInto(sizes: string[]) {
    if (!accepted) return
    setAddSizesOpen(false)
    try {
      await addSizes(accepted.run_id, 'c1', sizes)
      setRecomposeNote(
        `Recomposing ${sizes.length} size${sizes.length > 1 ? 's' : ''} — watch them fill in under Generate.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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

  // What the center stage shows: an accepted result > a picked candidate > source.
  const currentCandidate =
    job && viewCandidate !== null
      ? job.candidates.find((c) => c?.ready && c.index === viewCandidate) ?? null
      : null
  const stageUrl =
    showOriginal || !currentCandidate ? src?.url ?? '' : currentCandidate.url ?? src?.url ?? ''

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* ---------------- Left rail: source + regions ---------------- */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border bg-card lg:w-[360px] lg:border-b-0 lg:border-r">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <h2 className="font-display text-sm font-bold tracking-tight">Edit a banner</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Fix wrong text on a finished banner. Everything outside the marked regions
              stays pixel-identical — guaranteed.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload
            </Button>
            <Button variant="outline" onClick={() => setGalleryOpen(true)}>
              <ImagePlus className="h-4 w-4" /> From gallery
            </Button>
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
          </div>

          {src && (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <span className="min-w-0 truncate text-xs text-muted-foreground" title={src.title}>
                  {src.title || 'attached image'} · {src.width}×{src.height}
                </span>
                <button
                  type="button"
                  onClick={() => resetForSource(null)}
                  title="Detach"
                  aria-label="Detach this image"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => void autoDetect()}
                disabled={detecting}
                title="Find the text blocks automatically and pre-fill their current text"
              >
                {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                {detecting ? 'Detecting…' : 'Auto-detect text'}
              </Button>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Corrections
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    drag on the image to mark text
                  </span>
                </div>
                {regions.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    No regions yet — drag a box over the wrong text, or use Auto-detect.
                  </p>
                )}
                {regions.map((r, i) => (
                  <div key={r.id} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary font-display text-[11px] font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRegions((prev) => prev.filter((x) => x.id !== r.id))}
                        title="Remove this region"
                        aria-label={`Remove region ${i + 1}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Input
                      value={r.current}
                      onChange={(e) =>
                        setRegions((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, current: e.target.value } : x)),
                        )
                      }
                      placeholder="Current text (optional)"
                      aria-label={`Region ${i + 1} current text`}
                      className="h-8 text-xs"
                    />
                    <Textarea
                      value={r.next}
                      onChange={(e) =>
                        setRegions((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, next: e.target.value } : x)),
                        )
                      }
                      rows={2}
                      placeholder="New text — exactly as it should read"
                      aria-label={`Region ${i + 1} new text`}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Candidates</span>
                <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCandidates(n)}
                      aria-pressed={candidates === n}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        candidates === n
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground">variants to pick from</span>
              </div>

              <Button
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                size="lg"
                disabled={readyRegions.length === 0 || starting || job?.status === 'running'}
                onClick={() => void generate()}
                title="Generate the correction — only the marked regions change"
              >
                {starting || job?.status === 'running' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Generate correction
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </aside>

      {/* ---------------- Center: canvas + candidates ---------------- */}
      <section className="relative min-h-[55vh] min-w-0 flex-1 bg-background lg:min-h-0">
        <div className="flex h-full flex-col">
          {error && (
            <div
              role="alert"
              className="m-4 mb-0 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {!src ? (
            <EmptyState onUpload={() => fileRef.current?.click()} onGallery={() => setGalleryOpen(true)} />
          ) : (
            <>
              <div className="min-h-0 flex-1 p-4">
                <EditCanvas
                  url={stageUrl}
                  regions={currentCandidate && !showOriginal ? [] : regions}
                  onAddRegion={(r) =>
                    setRegions((prev) => [...prev, { ...r, id: newRegionId(), current: '', next: '', hints: '' }])
                  }
                  disabled={!!currentCandidate && !showOriginal}
                />
              </div>

              {currentCandidate && (
                <div className="flex items-center justify-center gap-2 pb-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onPointerDown={() => setShowOriginal(true)}
                    onPointerUp={() => setShowOriginal(false)}
                    onPointerLeave={() => setShowOriginal(false)}
                    title="Hold to see the original"
                  >
                    <Eye className="h-4 w-4" /> Hold to compare
                  </Button>
                </div>
              )}

              {job && (
                <div className="border-t border-border bg-card/60 p-4">
                  {accepted ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="h-4 w-4" /> Saved to the gallery
                      </span>
                      <span className="text-xs text-muted-foreground">
                        The corrected banner is a new version under Generate.
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        {recomposeNote ? (
                          <span className="text-xs font-medium text-primary">{recomposeNote}</span>
                        ) : (
                          <Button size="sm" onClick={() => setAddSizesOpen(true)}>
                            <Plus className="h-4 w-4" /> Add sizes
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetForSource(null)}
                          title="Start another edit"
                        >
                          <Pencil className="h-4 w-4" /> New edit
                        </Button>
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        {job.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {job.status === 'running'
                          ? 'Generating candidates — pick one when they appear…'
                          : job.status === 'failed'
                            ? `Generation failed${job.error ? `: ${job.error}` : ''}`
                            : 'Pick the best candidate:'}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {job.candidates.map((c, i) =>
                          c?.ready && c.url ? (
                            <div
                              key={i}
                              className={cn(
                                'w-44 overflow-hidden rounded-xl border bg-card shadow-sm transition-all',
                                viewCandidate === c.index
                                  ? 'border-primary ring-2 ring-primary/40'
                                  : 'border-border hover:border-foreground/25',
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setViewCandidate(c.index)}
                                className="block w-full"
                                title="Preview this candidate"
                              >
                                <img src={c.url} alt={`Candidate ${i + 1}`} className="h-28 w-full object-contain" />
                              </button>
                              <div className="space-y-1.5 border-t border-border p-2">
                                <QaBadge qaOk={c.qa_ok} qaRead={c.qa_read} />
                                <Button
                                  size="sm"
                                  className="h-7 w-full text-xs"
                                  disabled={accepting}
                                  onClick={() => void accept(c.index)}
                                >
                                  {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  Use this
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div
                              key={i}
                              className="flex h-40 w-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/40 p-2 text-center"
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
                        {job.status !== 'running' && !accepted && (
                          <button
                            type="button"
                            onClick={() => void generate()}
                            className="flex h-40 w-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                            title="Generate a fresh set of candidates"
                          >
                            <RefreshCw className="h-4 w-4" />
                            <span className="text-[11px]">Retry</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {addSizesOpen && accepted && (
          <div className="absolute inset-0 z-30">
            <AddSizesModal
              groups={sizeConfig?.groups ?? []}
              availableSizes={sizeConfig?.sizes ?? []}
              existingSizes={acceptedSize ? [acceptedSize] : []}
              onAddCustomSize={addCustomSize}
              onCancel={() => setAddSizesOpen(false)}
              onGenerate={(sizes) => void recomposeInto(sizes)}
            />
          </div>
        )}
      </section>

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
        <AlertTriangle className="h-3 w-3" /> Check spelling
      </span>
    )
  }
  return <span className="inline-block px-2 text-[10px] text-muted-foreground">QA unavailable</span>
}

function EmptyState({ onUpload, onGallery }: { onUpload: () => void; onGallery: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8 animate-fade-up">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
          <Pencil className="h-6 w-6" />
        </div>
        <h3 className="font-display text-lg font-bold tracking-tight">Fix a banner’s text</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Attach a generated banner, mark the wrong text, type the correction — the rest of
          the design stays untouched.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={onUpload}>
            <Upload className="h-4 w-4" /> Upload image
          </Button>
          <Button variant="outline" onClick={onGallery}>
            <ImagePlus className="h-4 w-4" /> Pick from gallery
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The image with a drag-to-draw region overlay (rectangles, % coords). */
function EditCanvas({
  url,
  regions,
  onAddRegion,
  disabled,
}: {
  url: string
  regions: Region[]
  onAddRegion: (r: { x: number; y: number; w: number; h: number }) => void
  disabled?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  function pct(e: { clientX: number; clientY: number }) {
    const el = boxRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    }
  }

  const draftRect = draft
    ? {
        x: Math.min(draft.x0, draft.x1),
        y: Math.min(draft.y0, draft.y1),
        w: Math.abs(draft.x1 - draft.x0),
        h: Math.abs(draft.y1 - draft.y0),
      }
    : null

  return (
    <div className="flex h-full items-center justify-center">
      <div
        ref={boxRef}
        className={cn(
          'relative max-h-full max-w-full select-none overflow-hidden rounded-xl border border-border shadow-lg',
          !disabled && 'cursor-crosshair',
        )}
        onPointerDown={(e) => {
          if (disabled) return
          const p = pct(e)
          if (!p) return
          try {
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          } catch {
            /* capture is best-effort — the drag still tracks via onPointerMove */
          }
          setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
        }}
        onPointerMove={(e) => {
          if (!draft) return
          const p = pct(e)
          if (p) setDraft({ ...draft, x1: p.x, y1: p.y })
        }}
        onPointerUp={() => {
          if (draftRect && draftRect.w > 1.5 && draftRect.h > 1.5) onAddRegion(draftRect)
          setDraft(null)
        }}
      >
        <img src={url} alt="Banner being edited" className="block max-h-[62vh] max-w-full" draggable={false} />
        {regions.map((r, i) => (
          <div
            key={r.id}
            className={cn(
              'absolute rounded border-2',
              r.next.trim() ? 'border-emerald-500 bg-emerald-500/10' : 'border-primary bg-primary/10',
            )}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
          >
            <span className="absolute -left-px -top-5 rounded bg-primary px-1.5 font-display text-[11px] font-bold text-primary-foreground">
              {i + 1}
            </span>
          </div>
        ))}
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
  )
}

/** Pick a banner from the shared gallery (any viewable banner, newest first). */
function GalleryPickModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (src: SourceState) => void
}) {
  const [runs, setRuns] = useState<RunData[] | null>(null)
  useEffect(() => {
    if (!open) return
    setRuns(null)
    listRuns().then((r) => setRuns(r ?? []))
  }, [open])

  const items = useMemo(() => {
    const out: { runId: string; label: string; url: string; size: string; title: string; by: string; width: number; height: number }[] = []
    for (const run of [...(runs ?? [])].reverse()) {
      for (const b of run.banners) {
        if (b.status !== 'ok' || !b.url) continue
        const [w, h] = b.size.split('x').map(Number)
        out.push({
          runId: run.run_id,
          label: b.label,
          url: assetUrl(b.url),
          size: b.size,
          title: b.title,
          by: run.created_by || '',
          width: w || 0,
          height: h || 0,
        })
      }
    }
    return out
  }, [runs])

  if (!open) return null
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
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close gallery picker"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {runs === null ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading banners…
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No banners in the gallery yet — generate some first, or upload an image.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {items.map((it) => (
                <button
                  key={`${it.runId}|${it.label}`}
                  type="button"
                  onClick={() =>
                    onPick({
                      source: { run_id: it.runId, label: it.label },
                      url: it.url,
                      width: it.width,
                      height: it.height,
                      title: it.title,
                      editedFrom: { run_id: it.runId, label: it.label },
                    })
                  }
                  className="group overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                  title={`${it.size}${it.title ? ` · ${it.title}` : ''}`}
                >
                  <span className="block aspect-square bg-muted/40">
                    <img src={it.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                  </span>
                  <span className="block border-t border-border px-2 py-1.5">
                    <span className="block truncate font-display text-xs font-semibold">{it.size}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {it.title || (it.by ? `by ${formatUserName(it.by)}` : '')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

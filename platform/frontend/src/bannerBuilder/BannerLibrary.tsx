import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Download,
  Gauge,
  DownloadCloud,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatUserName } from '@/lib/utils'
import type { SizeGroup } from './sizesApi'

export interface LibraryItem {
  label: string // banner label (concept__size) — NOT unique across runs
  runId: string // owning run, so a delete is scoped to the right run
  src: string // full-size image URL (ready to use)
  downloadHref: string // href that downloads this single PNG (already correctly named)
  size: string // e.g. "1200x1200"
  version: number
  title: string
  subtitle?: string
  button?: string
  brief?: string // the creative-director's per-size brief
  prompt?: string // the exact prompt sent to the image model
  promptOverride?: string | null // user-edited prompt (truthy => this banner uses an edited prompt)
  style?: string // the composed art-direction string
  concept?: string // owning concept (for approve/reject)
  approvalStatus?: string // awaiting | approved | rejected
  createdBy?: string
  qa?: string | null // post-generation QA warning, else null
  genMs?: number | null // render time for this size
  model?: string // image model used
  quality?: string // low | medium | high
  effort?: string // GPT-5.5 thinking effort used
  createdAt?: string // run creation timestamp (ISO)
  artTags?: { label: string; value: string }[] // Art-Director selections
}

/** Subtle checkerboard so transparent PNGs read against any theme. */
const CHECKER: CSSProperties = {
  backgroundImage:
    'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)',
  backgroundSize: '22px 22px',
}

/**
 * Full-screen banner detail view. Three columns:
 *   LEFT   — details + the Art-Director selections as tags (who, model, render time).
 *   CENTER — the image (prev/next + arrow keys), with this generation's other sizes
 *            as a filmstrip beneath it.
 *   RIGHT  — a Higgsfield-styled panel: the PROMPT card, an INFORMATION card, and
 *            the action buttons.
 *
 * Closes on the X button, Escape, and clicks on the scrim/empty area. Returns null
 * when closed or when there is nothing to show. Side panels collapse on small screens.
 */
export function BannerLibrary({
  open,
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
  downloadAllHref,
  onApprove,
  onReject,
  onRegenerate,
  onAddSizes,
  availableSizes,
  sizeGroups,
  onAddCustomSize,
  existingSizes,
}: {
  open: boolean
  items: LibraryItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  /** Delete the current banner. Provided only for the run's owner. */
  onDelete?: (runId: string, label: string) => void
  downloadAllHref?: string
  onApprove?: () => void
  onReject?: () => void
  /** Re-roll the current banner in place. Provided only for the run's owner.
   *  promptOverride: an edited prompt to re-roll from (sticks); '' resets to the
   *  generated prompt; undefined is a plain re-roll. */
  onRegenerate?: (runId: string, label: string, promptOverride?: string) => void
  /** Add more sizes to THIS version (recomposed off its master). Owner-only; already
   *  bound to the version's run + concept by the parent. */
  onAddSizes?: (sizes: string[]) => void
  /** Every size the app can generate — the add-sizes picker offers these. */
  availableSizes?: string[]
  /** The shared size groups — the picker mirrors the dashboard's organization. */
  sizeGroups?: SizeGroup[]
  /** Save a new custom size (shared). Resolves to the normalized size, or null. */
  onAddCustomSize?: (size: string) => Promise<string | null>
  /** Sizes this version already has, so the picker marks them as generated. */
  existingSizes?: string[]
}): JSX.Element | null {
  const count = items.length
  // Clamp the requested index into range so a shrinking list never points past the end.
  const safeIndex = count ? Math.min(Math.max(index, 0), count - 1) : 0
  const current = count ? items[safeIndex] : undefined

  const stripRef = useRef<HTMLDivElement>(null)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [adExpanded, setAdExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  // Prompt editing (owner-only, when onRegenerate is provided): "Edit prompt"
  // opens a BIG modal with the whole prompt + Regenerate / Cancel inside it.
  const [editing, setEditing] = useState(false)
  // Add-sizes picker modal (owner-only, when onAddSizes is provided) — mirrors
  // the dashboard's size-group organization.
  const [addingSizes, setAddingSizes] = useState(false)

  function copyPrompt() {
    if (!current?.prompt) return
    navigator.clipboard?.writeText(current.prompt).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

  // Close both modals whenever the viewed banner changes (navigate / close), so
  // a half-typed edit or selection never bleeds across banners.
  useEffect(() => {
    setEditing(false)
    setAddingSizes(false)
  }, [current?.runId, current?.label])

  const promptEdited = Boolean(current?.promptOverride)
  function regenerateFromModal(draft: string) {
    if (!current || !onRegenerate) return
    const next = draft.trim()
    // Unchanged text = a plain re-roll (keeps whatever prompt the frame already
    // uses); changed text = an override that sticks for future re-rolls.
    if (next === (current.prompt ?? '').trim()) onRegenerate(current.runId, current.label)
    else onRegenerate(current.runId, current.label, next)
    setEditing(false)
  }
  function resetPrompt() {
    if (!current || !onRegenerate) return
    onRegenerate(current.runId, current.label, '') // '' clears the override server-side
    setEditing(false)
  }

  // Reconcile an out-of-range index (e.g. after a delete) back to the parent.
  useEffect(() => {
    if (open && count && safeIndex !== index) onIndexChange(safeIndex)
  }, [open, count, safeIndex, index, onIndexChange])

  // Keyboard: Escape closes, arrows navigate (clamped at the ends). While a
  // modal (prompt editor / size picker) is open, the modal owns the keyboard —
  // Escape closes IT, not the whole viewer, and arrows don't switch banners.
  useEffect(() => {
    if (!open || !count) return
    const onKey = (e: KeyboardEvent) => {
      if (editing || addingSizes) {
        if (e.key === 'Escape') {
          setEditing(false)
          setAddingSizes(false)
        }
        return
      }
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onIndexChange(Math.max(safeIndex - 1, 0))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onIndexChange(Math.min(safeIndex + 1, count - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, count, safeIndex, onClose, onIndexChange, editing, addingSizes])

  // Keep the active thumbnail scrolled into view as the selection moves.
  useEffect(() => {
    if (!open) return
    const strip = stripRef.current
    if (!strip) return
    const active = strip.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [open, safeIndex])

  if (!open || !current) return null

  const atStart = safeIndex <= 0
  const atEnd = safeIndex >= count - 1
  const hasTags = !!(current.artTags && current.artTags.length)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Banner preview"
      className="fixed inset-0 z-[100] flex animate-fade-in"
    >
      {/* Scrim — clicking the empty space closes the view. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/85 backdrop-blur-md"
      />

      {/* ---------------- LEFT: details & tags ---------------- */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 bg-card/85 p-4 backdrop-blur-xl lg:flex"
      >
        <SectionLabel>Details</SectionLabel>

        {current.createdBy && (
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-xs font-bold text-primary">
              {initials(formatUserName(current.createdBy))}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {formatUserName(current.createdBy)}
              </div>
              <div className="text-[11px] text-muted-foreground">Creator</div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/50 p-3">
          <MetaRow icon={Cpu} label="Model" value={current.model} />
          <MetaRow icon={Gauge} label="Quality" value={current.quality ? cap(current.quality) : undefined} />
          {current.effort && <MetaRow icon={Brain} label="Thinking" value={cap(current.effort)} />}
          <MetaRow icon={Clock} label="Render time" value={fmtMs(current.genMs)} />
        </div>

        {current.qa && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{current.qa}</span>
          </div>
        )}

        <div>
          <SectionLabel>Art Director</SectionLabel>
          {/* Quick-read tags of what the user picked. */}
          {hasTags ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {current.artTags!.map((t, i) => (
                <span
                  key={i}
                  title={t.label}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-1 text-[11px]"
                >
                  <span className="text-muted-foreground">{t.label}</span>
                  <span className="font-medium text-foreground">{t.value}</span>
                </span>
              ))}
            </div>
          ) : !current.style ? (
            <p className="mt-2 text-xs text-muted-foreground">Auto — the AI chose the direction.</p>
          ) : null}

          {/* The full composed art-direction prompt — collapsed by default, expandable. */}
          {current.style && (
            <div className="mt-2.5 border-t border-border/60 pt-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Full art direction
              </div>
              <p
                className={cn(
                  'whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/80',
                  !adExpanded && 'line-clamp-4',
                )}
              >
                {current.style}
              </p>
              <button
                type="button"
                onClick={() => setAdExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {adExpanded ? 'See less' : 'See all'}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', adExpanded && 'rotate-180')} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- CENTER: image + filmstrip ---------------- */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Slim top bar */}
        <div className="flex shrink-0 items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-display text-sm font-bold tracking-tight text-foreground">{current.size}</span>
            <span className="shrink-0 rounded-md border border-primary/35 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              v{current.version}
            </span>
            {current.title && <span className="truncate text-sm text-muted-foreground">{current.title}</span>}
            {current.qa && (
              <span
                title={`Heads up: ${current.qa}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="h-3 w-3" /> Check
              </span>
            )}
          </div>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {safeIndex + 1} / {count}
          </span>
          {/* Small screens have no side panels — keep Download reachable. */}
          <Button asChild size="sm" variant="outline" className="shrink-0 md:hidden">
            <a href={current.downloadHref} download title={`Download ${current.size} PNG`}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Stage */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-3 sm:px-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <button
            type="button"
            onClick={() => onIndexChange(Math.max(safeIndex - 1, 0))}
            disabled={atStart}
            title="Previous"
            aria-label="Previous banner"
            className="absolute left-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div
            className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl border border-border shadow-2xl"
            style={CHECKER}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              key={current.label}
              src={current.src}
              alt={`${current.title || 'Banner'} — ${current.size}`}
              className="max-h-[calc(100vh-13rem)] max-w-full object-contain animate-fade-in"
            />
          </div>

          <button
            type="button"
            onClick={() => onIndexChange(Math.min(safeIndex + 1, count - 1))}
            disabled={atEnd}
            title="Next"
            aria-label="Next banner"
            className="absolute right-3 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Filmstrip — the other sizes from this generation. */}
        {count > 1 && (
          <div
            ref={stripRef}
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-3"
          >
            {items.map((it, i) => {
              const active = i === safeIndex
              return (
                <button
                  key={it.label}
                  type="button"
                  data-active={active}
                  onClick={() => onIndexChange(i)}
                  title={`${it.size}${it.title ? ` · ${it.title}` : ''}`}
                  aria-label={`Show ${it.size}`}
                  aria-current={active}
                  className={cn(
                    'group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-card transition-all',
                    active
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-border opacity-70 hover:border-foreground/30 hover:opacity-100',
                  )}
                >
                  <span className="absolute inset-0" style={CHECKER} />
                  <img src={it.src} alt="" loading="lazy" className="relative h-full w-full object-contain" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ---------------- RIGHT: Higgsfield-style panel ---------------- */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/60 bg-card/85 p-4 backdrop-blur-xl md:flex"
      >
        {/* PROMPT card */}
        <div className="rounded-xl border border-border bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Prompt
              {promptEdited && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  edited
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              {current.prompt && (
                <Button size="sm" variant="outline" onClick={copyPrompt} className="h-7 gap-1 px-2 text-xs">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
              {onRegenerate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  className="h-7 gap-1 px-2 text-xs"
                  title="Open the full prompt in a large editor and regenerate this size"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit prompt
                </Button>
              )}
            </div>
          </div>
          {current.prompt ? (
            <>
              <p
                className={cn(
                  'whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/85',
                  !promptExpanded && 'line-clamp-5',
                )}
              >
                {current.prompt}
              </p>
              <button
                type="button"
                onClick={() => setPromptExpanded((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {promptExpanded ? 'See less' : 'See all'}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', promptExpanded && 'rotate-180')} />
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not recorded for this banner{onRegenerate ? ' — “Edit prompt” lets you write one and regenerate.' : '.'}
            </p>
          )}
        </div>

        {/* INFORMATION card */}
        <div className="rounded-xl border border-border bg-background/50 px-3 py-1">
          <div className="border-b border-border/60 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Information
          </div>
          <InfoLine label="Size" value={current.size} />
          <InfoLine label="Version" value={`v${current.version}`} />
          <InfoLine label="Created" value={fmtDate(current.createdAt) || '—'} />
        </div>

        {/* Actions */}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {(onApprove || onReject) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={onReject}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button onClick={onApprove} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <Check className="h-4 w-4" /> Approve
              </Button>
            </div>
          )}
          <Button asChild className="w-full">
            <a href={current.downloadHref} download title={`Download ${current.size} PNG`}>
              <Download className="h-4 w-4" /> Download
            </a>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline">
              <a href={current.src} target="_blank" rel="noreferrer" title="Open full size in a new tab">
                <ExternalLink className="h-4 w-4" /> Open
              </a>
            </Button>
            {downloadAllHref ? (
              <Button asChild variant="outline">
                <a href={downloadAllHref} download title="Download all sizes as a zip">
                  <DownloadCloud className="h-4 w-4" /> All sizes
                </a>
              </Button>
            ) : (
              <span />
            )}
          </div>
          {/* Add sizes — opens a picker organized exactly like the dashboard's
              size groups. Regenerate lives INSIDE the prompt editor now. */}
          {onAddSizes && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setAddingSizes(true)}
              title="Generate more sizes of this version"
            >
              <Plus className="h-4 w-4" /> Add sizes
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              onClick={() => onDelete(current.runId, current.label)}
              className="w-full text-destructive hover:border-destructive hover:text-destructive"
              title="Delete this banner"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </aside>

      {/* ---------------- Modals (above the whole viewer) ---------------- */}
      {editing && onRegenerate && (
        <PromptEditModal
          key={`${current.runId}|${current.label}`}
          size={current.size}
          version={current.version}
          initial={current.prompt ?? ''}
          edited={promptEdited}
          onCancel={() => setEditing(false)}
          onRegenerate={regenerateFromModal}
          onReset={resetPrompt}
        />
      )}
      {addingSizes && onAddSizes && (
        <AddSizesModal
          groups={sizeGroups ?? []}
          availableSizes={availableSizes ?? []}
          existingSizes={existingSizes ?? []}
          onAddCustomSize={onAddCustomSize}
          onCancel={() => setAddingSizes(false)}
          onGenerate={(picked) => {
            onAddSizes(picked)
            setAddingSizes(false)
          }}
        />
      )}
    </div>,
    document.body,
  )
}

/**
 * BIG prompt editor: the whole prompt in a large textarea with Regenerate and
 * Cancel inside the modal (plus "Reset to generated" when an edit is active).
 * Unchanged text regenerates as a plain re-roll; changed text becomes a sticky
 * override (see regenerateFromModal).
 */
function PromptEditModal({
  size,
  version,
  initial,
  edited,
  onCancel,
  onRegenerate,
  onReset,
}: {
  size: string
  version: number
  initial: string
  edited: boolean
  onCancel: () => void
  onRegenerate: (draft: string) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit prompt"
        className="relative z-10 flex h-[min(85vh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] animate-fade-up"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold text-foreground">Edit prompt</h2>
          <span className="rounded-md border border-primary/35 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            {size} · v{version}
          </span>
          {edited && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              edited
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            title="Close"
            aria-label="Close prompt editor"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          autoFocus
          placeholder="Describe the banner to generate…"
          className="min-h-0 w-full flex-1 resize-none bg-background/50 px-5 py-4 text-sm leading-relaxed text-foreground/90 outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {edited && (
            <Button
              variant="ghost"
              onClick={onReset}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              title="Discard the edit and regenerate from the original generated prompt"
            >
              <RotateCcw className="h-4 w-4" /> Reset to generated
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => onRegenerate(draft)}
              disabled={!draft.trim()}
              className="gap-1.5"
              title="Regenerate this size from the prompt above"
            >
              <RefreshCw className="h-4 w-4" /> Regenerate
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Add-sizes picker: the SAME group organization as the dashboard's size rail
 * (collapsible groups + search + custom sizes). Sizes the version already has
 * show as checked-and-disabled so groups read complete.
 */
function AddSizesModal({
  groups,
  availableSizes,
  existingSizes,
  onAddCustomSize,
  onCancel,
  onGenerate,
}: {
  groups: SizeGroup[]
  availableSizes: string[]
  existingSizes: string[]
  onAddCustomSize?: (size: string) => Promise<string | null>
  onCancel: () => void
  onGenerate: (sizes: string[]) => void
}) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups.length ? [groups[0].id] : []),
  )
  const [customValue, setCustomValue] = useState('')
  const [customBusy, setCustomBusy] = useState(false)
  // Custom sizes saved from THIS modal — offered immediately even before the
  // parent's config state refreshes.
  const [extraSizes, setExtraSizes] = useState<string[]>([])

  const existing = new Set(existingSizes)
  const known = new Set([...availableSizes, ...extraSizes])
  const display: SizeGroup[] = (() => {
    const base = groups.length
      ? groups.map((g) => ({ ...g, sizes: g.sizes.filter((s) => known.has(s)) }))
      : [{ id: 'all', label: 'All sizes', sizes: [...known] }]
    const covered = new Set(base.flatMap((g) => g.sizes))
    const other = [...known].filter((s) => !covered.has(s))
    return other.length ? [...base, { id: 'other', label: 'Other', sizes: other }] : base
  })()

  function toggle(size: string) {
    if (existing.has(size)) return
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(size)) next.delete(size)
      else next.add(size)
      return next
    })
  }
  async function addCustom() {
    if (!onAddCustomSize || !customValue.trim() || customBusy) return
    setCustomBusy(true)
    try {
      const size = await onAddCustomSize(customValue)
      if (size) {
        setExtraSizes((prev) => (prev.includes(size) ? prev : [...prev, size]))
        if (!existing.has(size)) setSel((prev) => new Set(prev).add(size))
        setCustomValue('')
      }
    } finally {
      setCustomBusy(false)
    }
  }

  const chip = (s: string) => {
    const done = existing.has(s)
    const on = sel.has(s)
    return (
      <button
        key={s}
        type="button"
        onClick={() => toggle(s)}
        disabled={done}
        aria-pressed={on}
        title={done ? 'Already generated for this version' : ''}
        className={cn(
          'flex items-center justify-between gap-1.5 rounded-md border px-2.5 py-1.5 font-display text-[12px] font-semibold transition-colors',
          done
            ? 'cursor-default border-border bg-secondary/50 text-muted-foreground/70'
            : on
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border bg-secondary text-muted-foreground hover:border-foreground/25 hover:text-foreground',
        )}
      >
        <span>{s}</span>
        {(done || on) && <Check className={cn('h-3.5 w-3.5', done && 'opacity-50')} />}
      </button>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = q ? [...known].filter((s) => s.includes(q)) : []

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add sizes"
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] animate-fade-up"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold text-foreground">Add sizes</h2>
          <span className="text-xs text-muted-foreground">
            recomposed from this version’s master
          </span>
          <button
            type="button"
            onClick={onCancel}
            title="Close"
            aria-label="Close size picker"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search sizes"
              placeholder="Search sizes…"
              className="h-8 w-full rounded-md border border-input bg-secondary pl-8 pr-7 text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear"
                aria-label="Clear size search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {q ? (
            matches.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{matches.map(chip)}</div>
            ) : (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                No sizes match “{query}” — add it below as a custom size.
              </p>
            )
          ) : (
            display.map((g) => {
              if (!g.sizes.length) return null
              const open = openGroups.has(g.id)
              const selCount = g.sizes.filter((s) => sel.has(s)).length
              return (
                <div key={g.id} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => {
                        const next = new Set(prev)
                        if (next.has(g.id)) next.delete(g.id)
                        else next.add(g.id)
                        return next
                      })
                    }
                    className="flex w-full items-center justify-between bg-secondary/50 px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">
                      {g.label}
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
                    <div className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4">{g.sizes.map(chip)}</div>
                  )}
                </div>
              )
            })
          )}

          {onAddCustomSize && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2">
              <input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addCustom()
                  }
                }}
                aria-label="New custom size (width x height)"
                placeholder="Custom size — e.g. 500x500"
                className="h-8 w-full min-w-0 flex-1 rounded-md border border-input bg-secondary px-2.5 text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-2.5 text-xs"
                disabled={customBusy || !customValue.trim()}
                onClick={() => void addCustom()}
                title="Save as a shared custom size and select it"
              >
                {customBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={sel.size === 0}
            onClick={() => onGenerate(Array.from(sel))}
            className="gap-1.5"
            title="Recompose this version into the selected sizes"
          >
            <Plus className="h-4 w-4" />
            {sel.size ? `Generate ${sel.size} size${sel.size > 1 ? 's' : ''}` : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Break the composed art-direction string into labelled rows so the viewer can
 * scan exactly what the Art Director was briefed with (Look / Casting / Colour /
 * Layout / Finish / Localisation / Brand), instead of one long paragraph. Falls
 * back to a single "Art direction" row when the string carries no known labels.
 */
export function artDirectionRows(style: string): { label: string; text: string }[] {
  const s = (style || '').trim()
  if (!s) return []
  const SECTIONS: { key: string; label: string }[] = [
    { key: 'Look:', label: 'Look' },
    { key: 'Casting:', label: 'Casting' },
    { key: 'Colour direction:', label: 'Colour' },
    { key: 'Composition:', label: 'Layout' },
    { key: 'Finish:', label: 'Finish' },
    { key: 'Localise', label: 'Localisation' },
    { key: 'Brand palette:', label: 'Brand' },
  ]
  const marks = SECTIONS.map((sec) => ({ ...sec, i: s.indexOf(sec.key) }))
    .filter((m) => m.i >= 0)
    .sort((a, b) => a.i - b.i)
  if (!marks.length) return [{ label: 'Art direction', text: s }]
  const rows: { label: string; text: string }[] = []
  const lead = s.slice(0, marks[0].i).replace(/[—\-\s]+$/, '').trim()
  if (lead) rows.push({ label: 'Style note', text: lead })
  marks.forEach((m, idx) => {
    const start = m.i + (m.key.endsWith(':') ? m.key.length : 0)
    const end = idx + 1 < marks.length ? marks[idx + 1].i : s.length
    const text = s
      .slice(start, end)
      .trim()
      .replace(/^[:\s]+/, '')
      .replace(/\s+/g, ' ')
    if (text) rows.push({ label: m.label, text })
  })
  return rows
}

// --- small presentational helpers -----------------------------------------
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function fmtMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</div>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value?: string | null
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto truncate font-medium text-foreground">{value || '—'}</span>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-semibold text-foreground">{value}</span>
    </div>
  )
}

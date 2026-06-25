import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, DownloadCloud, ExternalLink, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface LibraryItem {
  label: string // banner label (concept__size) — NOT unique across runs
  runId: string // owning run, so a delete is scoped to the right run
  src: string // full-size image URL (ready to use)
  downloadHref: string // href that downloads this single PNG (already correctly named)
  size: string // e.g. "1200x1200"
  version: number
  title: string
}

/** Subtle checkerboard so transparent PNGs read against any theme. */
const CHECKER: CSSProperties = {
  backgroundImage:
    'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)',
  backgroundSize: '22px 22px',
}

/**
 * Full-screen banner lightbox: a large object-contained preview on a
 * checkerboard, prev/next navigation (buttons + arrow keys), a toolbar with
 * per-item and bulk download plus delete, and a clickable thumbnail filmstrip.
 *
 * Closes on the X button, Escape, and clicks on the scrim — but not on the
 * image or toolbar. Returns null when closed or when there is nothing to show.
 */
export function BannerLibrary({
  open,
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
  downloadAllHref,
}: {
  open: boolean
  items: LibraryItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  onDelete: (runId: string, label: string) => void
  downloadAllHref?: string
}): JSX.Element | null {
  const count = items.length
  // Clamp the requested index into range so a shrinking list never points past the end.
  const safeIndex = count ? Math.min(Math.max(index, 0), count - 1) : 0
  const current = count ? items[safeIndex] : undefined

  const stripRef = useRef<HTMLDivElement>(null)

  // Reconcile an out-of-range index (e.g. after a delete) back to the parent.
  useEffect(() => {
    if (open && count && safeIndex !== index) onIndexChange(safeIndex)
  }, [open, count, safeIndex, index, onIndexChange])

  // Keyboard: Escape closes, arrows navigate (clamped at the ends).
  useEffect(() => {
    if (!open || !count) return
    const onKey = (e: KeyboardEvent) => {
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
  }, [open, count, safeIndex, onClose, onIndexChange])

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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Banner preview"
      className="fixed inset-0 z-[100] flex flex-col animate-fade-in"
    >
      {/* Scrim — clicking the empty space closes the lightbox. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-md"
      />

      {/* Toolbar */}
      <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/70 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-display text-sm font-bold tracking-tight text-foreground">
            {current.size}
          </span>
          <span className="shrink-0 rounded-md border border-primary/35 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            v{current.version}
          </span>
          {current.title && (
            <span className="truncate text-sm text-muted-foreground">{current.title}</span>
          )}
        </div>

        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {safeIndex + 1} / {count}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={current.src} target="_blank" rel="noreferrer" title="Open full size in a new tab">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          </Button>

          <Button asChild size="sm" variant="outline">
            <a href={current.downloadHref} download title={`Download ${current.size} PNG`}>
              <Download className="h-4 w-4" /> Download
            </a>
          </Button>

          {downloadAllHref && (
            <Button asChild size="sm" variant="outline">
              <a href={downloadAllHref} download title="Download all as a zip">
                <DownloadCloud className="h-4 w-4" /> Download all
              </a>
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => onDelete(current.runId, current.label)}
            title="Delete this banner"
            className="text-destructive hover:border-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-5 sm:px-16"
        onClick={(e) => {
          // Click the empty area around the banner (not the image or the arrows) closes.
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
          // Stop scrim close-through when interacting with the image itself.
          onClick={(e) => e.stopPropagation()}
        >
          <img
            key={current.label}
            src={current.src}
            alt={`${current.title || 'Banner'} — ${current.size}`}
            className="max-h-[calc(100vh-15rem)] max-w-full object-contain animate-fade-in"
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

      {/* Filmstrip */}
      {count > 1 && (
        <div
          ref={stripRef}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border/60 bg-card/70 px-4 py-3 backdrop-blur-xl"
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
                <img
                  src={it.src}
                  alt=""
                  loading="lazy"
                  className="relative h-full w-full object-contain"
                />
              </button>
            )
          })}
        </div>
      )}
    </div>,
    document.body,
  )
}

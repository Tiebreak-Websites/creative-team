import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Lightweight centered modal: dimmed click-away backdrop + a card panel.
 * Esc closes; body scroll is locked while open. No Radix dependency — matches
 * the app's existing hand-rolled popovers.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    // Remember what was focused so we can restore it when the modal closes.
    prevFocusRef.current = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : []
    // Move focus into the dialog (first focusable, else the dialog itself).
    ;(focusables()[0] ?? dialog)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trap Tab so focus can't escape behind the modal.
      if (e.key === 'Tab' && dialog) {
        const items = focusables()
        if (!items.length) {
          e.preventDefault()
          dialog.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      // Restore focus to whatever opened the modal.
      prevFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 animate-fade-in"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] animate-fade-up',
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="space-y-0.5">
              {title && <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>}
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  )
}

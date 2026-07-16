import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, Type, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listGoogleFonts, type GoogleFont } from './api'

/**
 * Page-font picker: the whole Google Fonts catalog with each row PREVIEWED in
 * its own font. Previews load lazily as rows scroll into view — each family
 * fetches a tiny css2 stylesheet subset to the characters of its own name, so
 * browsing stays light. Picking a font applies it to the entire landing page
 * (canvas + export); "Template default" restores per-template fonts.
 */
let catalogCache: GoogleFont[] | null = null
const loadedPreviews = new Set<string>()

function ensurePreview(family: string) {
  if (loadedPreviews.has(family)) return
  loadedPreviews.add(family)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  const text = encodeURIComponent(`${family}AaBbGg0123 handgloves`)
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&text=${text}&display=swap`
  document.head.appendChild(link)
}

function FontRow({
  font,
  active,
  onPick,
}: {
  font: GoogleFont
  active: boolean
  onPick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ensurePreview(font.family)
          setVisible(true)
          io.disconnect()
        }
      },
      { root: el.closest('.font-list'), rootMargin: '160px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [font.family])
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-sm leading-tight"
          style={visible ? { fontFamily: `'${font.family}', sans-serif` } : undefined}
        >
          {font.family}
        </span>
        <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{font.category}</span>
      </span>
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
    </button>
  )
}

export function FontPicker({
  fontFamily,
  fonts,
  onChange,
}: {
  fontFamily: string
  fonts: 'system' | 'google'
  /** One global choice: a family name, or '' with the fonts strategy to keep. */
  onChange: (v: { font_family: string; fonts: 'system' | 'google' }) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [catalog, setCatalog] = useState<GoogleFont[] | null>(catalogCache)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || catalog) return
    listGoogleFonts()
      .then((f) => {
        catalogCache = f
        setCatalog(f)
      })
      .catch(() => setFailed(true))
  }, [open, catalog])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Preview the current pick in the trigger too.
  useEffect(() => {
    if (fontFamily) ensurePreview(fontFamily)
  }, [fontFamily])

  const filtered = useMemo(() => {
    if (!catalog) return []
    const query = q.trim().toLowerCase()
    const list = query ? catalog.filter((f) => f.family.toLowerCase().includes(query)) : catalog
    return list.slice(0, 150)
  }, [catalog, q])
  const total = catalog
    ? q.trim()
      ? catalog.filter((f) => f.family.toLowerCase().includes(q.trim().toLowerCase())).length
      : catalog.length
    : 0

  const label = fontFamily || (fonts === 'google' ? 'Template default' : 'System fonts')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Page font — applied to the whole landing page"
        className="flex h-8 w-full items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs transition-colors hover:border-foreground/30"
      >
        <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-left"
          style={fontFamily ? { fontFamily: `'${fontFamily}', sans-serif` } : undefined}
        >
          {label}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-9 z-[60] rounded-xl border border-border bg-card shadow-xl animate-pop-in">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Google Fonts…"
              aria-label="Search fonts"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="font-list max-h-64 overflow-y-auto p-1" role="listbox" aria-label="Fonts">
            {!q && (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={!fontFamily && fonts === 'google'}
                  onClick={() => {
                    onChange({ font_family: '', fonts: 'google' })
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                    !fontFamily && fonts === 'google' ? 'font-semibold' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Template default (Google bundle)
                  {!fontFamily && fonts === 'google' && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={!fontFamily && fonts === 'system'}
                  onClick={() => {
                    onChange({ font_family: '', fonts: 'system' })
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                    !fontFamily && fonts === 'system' ? 'font-semibold' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  System fonts (offline, fastest)
                  {!fontFamily && fonts === 'system' && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <div className="mx-2 my-1 border-t border-border" />
              </>
            )}
            {!catalog && !failed && (
              <p className="flex items-center justify-center gap-1.5 px-2 py-4 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the catalog…
              </p>
            )}
            {failed && <p className="px-2 py-4 text-center text-[11px] text-destructive">Could not load the font catalog.</p>}
            {filtered.map((f) => (
              <FontRow
                key={f.family}
                font={f}
                active={fontFamily === f.family}
                onPick={() => {
                  onChange({ font_family: f.family, fonts: 'google' })
                  setOpen(false)
                }}
              />
            ))}
            {catalog && filtered.length === 0 && (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">No fonts match “{q}”.</p>
            )}
            {catalog && total > filtered.length && (
              <p className="px-2 py-1.5 text-center text-[10px] text-muted-foreground">
                {filtered.length} of {total} — type to narrow down
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

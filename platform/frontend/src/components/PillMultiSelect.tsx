import { useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PillOption {
  value: string
  label: string
  /** Flag image URL, when the option has one. */
  flag?: string
  /** Heading this option sits under in the picker. Omit for a flat list. */
  group?: string
}

/**
 * Selected values as removable pills, plus a collapsible picker to add more.
 *
 * The picker is inline rather than a popover: this lives inside a scrolling
 * modal, where an absolutely-positioned dropdown gets clipped or floats away
 * from its trigger as the dialog scrolls.
 *
 * Selection is stored in CATALOGUE order, not click order, so a saved list
 * always reads the same way.
 */
export function PillMultiSelect({
  options,
  selected,
  onChange,
  addLabel = 'Add',
  searchPlaceholder = 'Search…',
  emptyHint = 'None selected yet.',
}: {
  options: PillOption[]
  selected: string[]
  onChange: (next: string[]) => void
  addLabel?: string
  searchPlaceholder?: string
  emptyHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const chosen = useMemo(
    () => options.filter((o) => selected.includes(o.value)),
    [options, selected],
  )

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    // Re-sort into catalogue order so the stored list is stable.
    onChange(options.filter((o) => next.includes(o.value)).map((o) => o.value))
  }

  // Groups in first-seen order, filtered by the search box.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (o: PillOption) =>
      !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    const out: { group: string; items: PillOption[] }[] = []
    for (const o of options) {
      if (!match(o)) continue
      const key = o.group ?? ''
      const bucket = out.find((g) => g.group === key)
      if (bucket) bucket.items.push(o)
      else out.push({ group: key, items: [o] })
    }
    return out
  }, [options, query])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chosen.map((o) => (
          <span
            key={o.value}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pl-1.5 pr-1 text-xs"
          >
            {o.flag && <img src={o.flag} alt="" className="h-3 w-[18px] rounded-[2px] object-cover" />}
            <span className="max-w-[160px] truncate">{o.label}</span>
            <button
              type="button"
              onClick={() => toggle(o.value)}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-destructive"
              title={`Remove ${o.label}`}
              aria-label={`Remove ${o.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {chosen.length === 0 && (
          <span className="text-xs text-muted-foreground">{emptyHint}</span>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs transition-colors',
            open
              ? 'border-primary/60 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-border bg-background p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-foreground/30"
            />
          </div>

          <div className="max-h-52 space-y-2 overflow-y-auto">
            {groups.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">No match.</p>
            )}
            {groups.map(({ group, items }) => (
              <div key={group || 'ungrouped'}>
                {group && (
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                )}
                <div className="grid gap-0.5 sm:grid-cols-2">
                  {items.map((o) => {
                    const on = selected.includes(o.value)
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => toggle(o.value)}
                        aria-pressed={on}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
                          on ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary',
                        )}
                      >
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          {on && <Check className="h-3 w-3 text-primary" />}
                        </span>
                        {o.flag && (
                          <img src={o.flag} alt="" className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover" />
                        )}
                        <span className="truncate">{o.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 text-[11px] text-muted-foreground hover:text-destructive"
            >
              Clear all ({chosen.length})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

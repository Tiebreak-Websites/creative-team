import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Megaphone, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createCampaign, type CampaignInfo } from './api'

/**
 * Searchable campaign combobox — replaces the flat native <select> that stopped
 * scaling once teams created dozens of campaigns. Search-as-you-type over
 * name/tag/market, last-used campaigns on top, the rest grouped by tag, plus
 * inline "new campaign" creation that attaches immediately.
 */
const RECENTS_KEY = 'inv:campaign-recents'

function readRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...readRecents().filter((x) => x !== id)].slice(0, 5)))
  } catch {
    /* best-effort */
  }
}

type Row =
  | { kind: 'detach' }
  | { kind: 'header'; label: string }
  | { kind: 'item'; c: CampaignInfo; recent?: boolean }

export function CampaignPicker({
  campaigns,
  value,
  onChange,
  onCreated,
  className,
}: {
  campaigns: CampaignInfo[]
  value: string
  onChange: (campaignId: string) => void
  /** New campaign created inline — add it to the caller's list. */
  onCreated: (c: CampaignInfo) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const createRef = useRef<HTMLInputElement>(null)
  const current = campaigns.find((c) => c.campaign_id === value) ?? null

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

  useEffect(() => {
    if (!open) return
    setQ('')
    setCreating(false)
    setErr('')
    setActive(0)
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])
  useEffect(() => {
    if (creating) requestAnimationFrame(() => createRef.current?.focus())
  }, [creating])

  const rows = useMemo<Row[]>(() => {
    const query = q.trim().toLowerCase()
    const match = (c: CampaignInfo) =>
      !query || [c.name, c.tag, c.market].some((v) => (v || '').toLowerCase().includes(query))
    const filtered = campaigns.filter(match)
    const recIds = readRecents()
    const recents = recIds
      .map((id) => filtered.find((c) => c.campaign_id === id))
      .filter((c): c is CampaignInfo => Boolean(c))
    const grouped = new Map<string, CampaignInfo[]>()
    for (const c of filtered) {
      if (recents.includes(c)) continue
      const g = c.tag || 'Other'
      if (!grouped.has(g)) grouped.set(g, [])
      grouped.get(g)!.push(c)
    }
    const out: Row[] = []
    if (value && !query) out.push({ kind: 'detach' })
    if (recents.length) {
      out.push({ kind: 'header', label: 'Recent' })
      recents.forEach((c) => out.push({ kind: 'item', c, recent: true }))
    }
    for (const [g, list] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push({ kind: 'header', label: g })
      list.forEach((c) => out.push({ kind: 'item', c }))
    }
    return out
  }, [campaigns, q, value, open]) // eslint-disable-line react-hooks/exhaustive-deps -- `open` refreshes recents

  const selectable = useMemo(() => rows.filter((r) => r.kind !== 'header'), [rows])
  useEffect(() => setActive(0), [q])

  function pick(id: string) {
    onChange(id)
    if (id) pushRecent(id)
    setOpen(false)
  }

  async function create() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    setErr('')
    try {
      const c = await createCampaign({ name })
      onCreated(c)
      setNewName('')
      setCreating(false)
      pick(c.campaign_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(selectable.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = selectable[active]
      if (row?.kind === 'item') pick(row.c.campaign_id)
      else if (row?.kind === 'detach') pick('')
      else if (selectable.length === 0 && q.trim()) {
        // nothing matches — offer the fast path: create with the typed name
        setCreating(true)
        setNewName(q.trim())
      }
    }
  }

  let cursor = -1
  return (
    <div ref={ref} className={cn('relative min-w-28', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={current ? `Campaign: ${current.name} — its assets appear in the Assets tab` : 'Attach an LP Materials campaign — its assets appear in the Assets tab'}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-8 w-full items-center gap-1.5 rounded-lg border border-border bg-secondary px-2 text-xs transition-colors hover:border-foreground/25"
      >
        <Megaphone className={cn('h-3.5 w-3.5 shrink-0', current ? 'text-primary' : 'text-muted-foreground')} />
        <span className={cn('min-w-0 flex-1 truncate text-left', !current && 'text-muted-foreground')}>
          {current?.name ?? 'No campaign'}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-[60] w-72 animate-pop-in rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search campaigns…"
              aria-label="Search campaigns"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Campaigns">
            {rows.map((r, i) => {
              if (r.kind === 'header') {
                return (
                  <p key={`h:${r.label}:${i}`} className="px-2 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {r.label}
                  </p>
                )
              }
              cursor += 1
              const idx = cursor
              if (r.kind === 'detach') {
                return (
                  <button
                    key="detach"
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => pick('')}
                    onMouseEnter={() => setActive(idx)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground',
                      active === idx && 'bg-accent text-foreground',
                    )}
                  >
                    <X className="h-3.5 w-3.5" /> No campaign — detach
                  </button>
                )
              }
              const isCur = r.c.campaign_id === value
              return (
                <button
                  key={r.c.campaign_id + (r.recent ? ':r' : '')}
                  type="button"
                  role="option"
                  aria-selected={isCur}
                  onClick={() => pick(r.c.campaign_id)}
                  onMouseEnter={() => setActive(idx)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active === idx ? 'bg-accent' : 'hover:bg-accent/60',
                    isCur && 'font-semibold',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{r.c.name}</span>
                    {(r.c.market || r.c.items > 0) && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {[r.c.market, r.c.items > 0 ? `${r.c.items} assets` : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {isCur && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              )
            })}
            {selectable.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No campaigns match “{q}” — press Enter to create it.
              </p>
            )}
          </div>

          <div className="border-t border-border p-1">
            {creating ? (
              <div className="space-y-1 p-1">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={createRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void create()
                    }}
                    placeholder="New campaign name…"
                    aria-label="New campaign name"
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void create()}
                    disabled={busy || !newName.trim()}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
                  </button>
                </div>
                {err && <p className="px-1 text-[10px] text-destructive">{err}</p>}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setNewName(q.trim())
                }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> New campaign…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

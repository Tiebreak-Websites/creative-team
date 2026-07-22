// Admin › Target Markets — the CreativeOPS design: region summary cards, a
// proper table (flag / country / code / region badge / actions) and an
// add-or-edit modal. The list is still saved whole through PUT /admin/markets.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { countryFlagUrl } from '@/lib/flags'
import { getMarkets, putMarkets, REGIONS, type Market } from './taxApi'

const REGION_BADGE: Record<string, string> = {
  LATAM: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  GCC: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  NA: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  APAC: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  EU: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
}

function RegionBadge({ region }: { region: string }) {
  if (!region) return <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">—</span>
  return (
    <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide',
      REGION_BADGE[region] ?? 'bg-secondary text-muted-foreground')}>
      {region}
    </span>
  )
}

export function MarketsSettings() {
  const [list, setList] = useState<Market[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** null = closed; index -1 = adding; >=0 = editing that row. */
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    getMarkets().then(setList).catch((e) => setError(e.message))
  }, [])

  const byRegion = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of list ?? []) {
      const r = m.region || '—'
      counts.set(r, (counts.get(r) ?? 0) + 1)
    }
    // Fixed region order first, ungrouped last.
    return [...REGIONS.filter((r) => counts.has(r)).map((r) => [r, counts.get(r)!] as const),
            ...(counts.has('—') ? [['—', counts.get('—')!] as const] : [])]
  }, [list])

  const save = (next: Market[]) => {
    setBusy(true)
    setError(null)
    putMarkets(next)
      .then((ms) => { setList(ms); setEditing(null) })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  if (list === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const sorted = [...list].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Markets</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Target markets / countries, grouped by region.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      {byRegion.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {byRegion.map(([region, n]) => (
            <div key={region} className="rounded-2xl border border-border bg-card p-4">
              <p className="font-display text-2xl font-bold tabular-nums">{n}</p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {region}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="font-display text-base font-bold">Markets</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
          <Button size="sm" className="ml-auto" onClick={() => setEditing(-1)}>
            <Plus className="h-3.5 w-3.5" /> Add market
          </Button>
        </div>

        {sorted.length === 0 ? (
          <p className="border-t border-border p-10 text-center text-xs text-muted-foreground">
            No markets yet — add the first one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <th className="py-2 pl-4 pr-2 font-semibold">Flag</th>
                  <th className="px-2 py-2 font-semibold">Country</th>
                  <th className="px-2 py-2 font-semibold">Code</th>
                  <th className="px-2 py-2 font-semibold">Region</th>
                  <th className="py-2 pl-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const idx = list.indexOf(m)
                  const flag = countryFlagUrl(m.code)
                  return (
                    <tr key={m.code} className="border-t border-border/70 hover:bg-secondary/40">
                      <td className="py-2.5 pl-4 pr-2">
                        {flag ? (
                          <img src={flag} alt="" className="h-3.5 w-5 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 font-medium">{m.label}</td>
                      <td className="px-2 py-2.5">
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] uppercase text-muted-foreground">
                          {m.code}
                        </span>
                      </td>
                      <td className="px-2 py-2.5"><RegionBadge region={m.region} /></td>
                      <td className="py-2.5 pl-2 pr-4">
                        <span className="flex items-center justify-end gap-1">
                          <button
                            type="button" title={`Edit ${m.label}`} aria-label={`Edit ${m.label}`}
                            onClick={() => setEditing(idx)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" title={`Remove ${m.label}`} aria-label={`Remove ${m.label}`}
                            disabled={busy}
                            onClick={() => save(list.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <MarketModal
          initial={editing >= 0 ? list[editing] : null}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(m) => {
            const next = editing >= 0
              ? list.map((x, i) => (i === editing ? m : x))
              : [...list, m]
            save(next)
          }}
        />
      )}
    </div>
  )
}

function MarketModal({
  initial, busy, onClose, onSave,
}: {
  initial: Market | null
  busy: boolean
  onClose: () => void
  onSave: (m: Market) => void
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const flag = countryFlagUrl(code.trim())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim() || !label.trim()) return
    onSave({ code: code.trim().toLowerCase(), label: label.trim(), region })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">
            {initial ? `Edit ${initial.label}` : 'Add market'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="mk-code" className="text-xs">Country code (ISO, 2 letters)</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="mk-code" value={code} autoFocus={!initial}
                onChange={(e) => setCode(e.target.value)}
                className="h-9 w-24 font-mono lowercase" placeholder="br" maxLength={12}
              />
              {flag && (
                <img src={flag} alt="" className="h-4 w-6 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="mk-label" className="text-xs">Country / market name</Label>
            <Input
              id="mk-label" value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 h-9" placeholder="Brazil"
            />
          </div>
          <div>
            <Label htmlFor="mk-region" className="text-xs">Region</Label>
            <select
              id="mk-region" value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              <option value="">— none —</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !code.trim() || !label.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

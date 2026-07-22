// Admin › Languages — the CreativeOPS design: a table of flag / label / code /
// RTL / usage, an add-or-edit modal, delete guarded server-side (a language in
// use by a landing page 409s). The registry is still saved whole via
// PUT /lp-builder/languages, the same contract as always.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { flagUrl } from '@/lib/flags'
import { listSections, putLanguages, listProjects, type Language } from '@/lpBuilder/api'
import { listCampaigns } from '@/emailBuilder/api'

// Right-to-left scripts among plausible codes — display-only badge.
const RTL_CODES = new Set(['ar', 'he', 'fa', 'ur'])

export function LanguagesSettings() {
  const [list, setList] = useState<Language[] | null>(null)
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** null = closed; -1 = adding; >=0 = editing that row. */
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    listSections()
      .then((d) => setList(d.languages))
      .catch((e) => setError(e.message))
    // Usage = email campaigns + landing pages in the language. Best-effort:
    // the counts inform, they don't gate (the server guards deletes anyway).
    Promise.allSettled([listCampaigns(), listProjects()]).then(([cs, ps]) => {
      const counts: Record<string, number> = {}
      if (cs.status === 'fulfilled') {
        for (const c of cs.value) counts[c.language] = (counts[c.language] ?? 0) + 1
      }
      if (ps.status === 'fulfilled') {
        for (const p of ps.value) {
          const lang = (p as { language?: string }).language
          if (lang) counts[lang] = (counts[lang] ?? 0) + 1
        }
      }
      setUsage(counts)
    })
  }, [])

  const sorted = useMemo(
    () => [...(list ?? [])].sort((a, b) => a.label.localeCompare(b.label)),
    [list],
  )

  const save = (next: Language[]) => {
    setBusy(true)
    setError(null)
    putLanguages(next)
      .then((ls) => { setList(ls); setEditing(null) })
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Languages</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Languages used across the builder — every brand and language picker draws from this list.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="font-display text-base font-bold">Languages</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
          <Button size="sm" className="ml-auto" onClick={() => setEditing(-1)}>
            <Plus className="h-3.5 w-3.5" /> Add language
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <th className="py-2 pl-4 pr-2 font-semibold">Flag</th>
                <th className="px-2 py-2 font-semibold">Label</th>
                <th className="px-2 py-2 font-semibold">Code</th>
                <th className="px-2 py-2 font-semibold">RTL</th>
                <th className="px-2 py-2 text-right font-semibold">Used by</th>
                <th className="py-2 pl-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const idx = list.indexOf(l)
                const flag = flagUrl(l.code)
                const rtl = RTL_CODES.has(l.code)
                const used = usage[l.code] ?? 0
                return (
                  <tr key={l.code} className="border-t border-border/70 hover:bg-secondary/40">
                    <td className="py-2.5 pl-4 pr-2">
                      {flag ? (
                        <img src={flag} alt="" className="h-3.5 w-5 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-medium">{l.label}</td>
                    <td className="px-2 py-2.5">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {l.code}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
                        {rtl ? 'RTL' : 'LTR'}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{used}</td>
                    <td className="py-2.5 pl-2 pr-4">
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button" title={`Edit ${l.label}`} aria-label={`Edit ${l.label}`}
                          onClick={() => setEditing(idx)}
                          className="rounded p-1 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button" title={`Remove ${l.label}`} aria-label={`Remove ${l.label}`}
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
      </div>

      {editing !== null && (
        <LanguageModal
          initial={editing >= 0 ? list[editing] : null}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(l) => {
            const next = editing >= 0
              ? list.map((x, i) => (i === editing ? l : x))
              : [...list, l]
            save(next)
          }}
        />
      )}
    </div>
  )
}

function LanguageModal({
  initial, busy, onClose, onSave,
}: {
  initial: Language | null
  busy: boolean
  onClose: () => void
  onSave: (l: Language) => void
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const flag = flagUrl(code.trim().toLowerCase())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim() || !label.trim()) return
    onSave({ code: code.trim().toLowerCase(), label: label.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">
            {initial ? `Edit ${initial.label}` : 'Add language'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="lg-code" className="text-xs">Code (ISO 639-1, e.g. en, pt)</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="lg-code" value={code} autoFocus={!initial}
                onChange={(e) => setCode(e.target.value)}
                className="h-9 w-24 font-mono lowercase" placeholder="en" maxLength={8}
              />
              {flag && (
                <img src={flag} alt="" className="h-4 w-6 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
              )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              The flag confirms the code maps to the country you meant.
            </p>
          </div>
          <div>
            <Label htmlFor="lg-label" className="text-xs">Label</Label>
            <Input
              id="lg-label" value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 h-9" placeholder="English"
            />
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

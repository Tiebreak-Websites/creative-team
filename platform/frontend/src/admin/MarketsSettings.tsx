// Admin › Target Markets — the ordered market list campaigns and automations
// reference. Same edit-whole-list shape as the language registry.

import { useEffect, useState } from 'react'
import { Check, Loader2, MapPin, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getMarkets, putMarkets, type Market } from './taxApi'

export function MarketsSettings() {
  const [draft, setDraft] = useState<Market[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getMarkets().then(setDraft).catch((e) => setError(e.message))
  }, [])

  if (draft === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const set = (i: number, patch: Partial<Market>) =>
    setDraft((d) => (d ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-bold">Target Markets</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        The market list campaigns and automations reference — a short code and a
        display name, in the order you want pickers to show them.
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <div className="space-y-1.5">
        {draft.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex h-8 w-7 shrink-0 items-center justify-center">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <Input
              value={m.code}
              onChange={(e) => set(i, { code: e.target.value })}
              className="h-8 w-24 text-xs"
              placeholder="br"
              aria-label="Market code"
            />
            <Input
              value={m.label}
              onChange={(e) => set(i, { label: e.target.value })}
              className="h-8 flex-1 text-xs"
              placeholder="Brazil"
              aria-label="Market label"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => (d ?? []).filter((_, j) => j !== i))}
              className="rounded p-1 text-muted-foreground hover:text-destructive"
              title="Remove market"
              aria-label={`Remove ${m.label || m.code}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {draft.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No markets yet — add the first one.
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm"
                onClick={() => setDraft((d) => [...(d ?? []), { code: '', label: '' }])}>
          <Plus className="h-3.5 w-3.5" /> Add market
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            setSaved(false)
            setError(null)
            putMarkets((draft ?? []).filter((m) => m.code.trim() && m.label.trim()))
              .then((ms) => {
                setDraft(ms)
                setSaved(true)
                window.setTimeout(() => setSaved(false), 2000)
              })
              .catch((e) => setError(e.message))
              .finally(() => setSaving(false))
          }}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save markets
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </div>
  )
}

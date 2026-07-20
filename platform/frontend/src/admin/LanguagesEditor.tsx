// The global language registry — the list every brand's language picker and
// every landing page draws from.
//
// It lives in Settings › Brands because that is where languages are assigned to
// a brand: editing the master list next to the pickers that consume it keeps
// "add a language" and "give it to a brand" one screen apart instead of two
// tools apart. The Blocks page only *reads* this list.

import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { flagUrl } from '@/lib/flags'
import { listSections, putLanguages, type Language } from '@/lpBuilder/api'

export function LanguagesEditor({ onError }: { onError: (m: string) => void }) {
  const [draft, setDraft] = useState<Language[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    listSections()
      .then((d) => setDraft(d.languages))
      .catch((e) => onError(e.message))
  }, [onError])

  const set = (i: number, patch: Partial<Language>) =>
    setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-bold">Languages</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        The global list every brand and landing page draws from. A language in use by a landing page
        cannot be removed.
      </p>

      <div className="space-y-1.5">
        {draft.map((l, i) => {
          const url = flagUrl(l.code)
          return (
            <div key={i} className="flex items-center gap-2">
              {/* The flag confirms the code maps to the country you meant —
                  'no' vs 'nb' is otherwise invisible until it ships. */}
              <span className="flex h-8 w-7 shrink-0 items-center justify-center">
                {url ? (
                  <img
                    src={url}
                    alt=""
                    className="h-3.5 w-5 rounded-[2px] object-cover ring-1 ring-inset ring-black/10"
                  />
                ) : (
                  <span className="text-[9px] text-muted-foreground">—</span>
                )}
              </span>
              <Input
                value={l.code}
                onChange={(e) => set(i, { code: e.target.value })}
                className="h-8 w-20 text-xs"
                aria-label="Language code"
              />
              <Input
                value={l.label}
                onChange={(e) => set(i, { label: e.target.value })}
                className="h-8 flex-1 text-xs"
                aria-label="Language label"
              />
              <button
                type="button"
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remove language"
                aria-label={`Remove ${l.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, { code: '', label: '' }])}>
          <Plus className="h-3.5 w-3.5" /> Add language
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            setSaved(false)
            putLanguages(draft.filter((l) => l.code && l.label))
              .then((ls) => {
                setDraft(ls)
                setSaved(true)
                window.setTimeout(() => setSaved(false), 2000)
              })
              .catch((e) => onError(e.message))
              .finally(() => setSaving(false))
          }}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save languages
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </div>
  )
}

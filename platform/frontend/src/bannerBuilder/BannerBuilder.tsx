import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { Meta, RunData, Tool } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { ApiError, getRun } from '../api'
import { createRun } from './campaignApi'
import type { CampaignRunRequest } from './campaignApi'
import { OutputPane } from './Results'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** A concept card as the user edits it: Title (required), Subtitle, Button. */
interface ConceptCard {
  key: string
  title: string
  subtitle: string
  button: string
}

let uid = 0
function blankCard(): ConceptCard {
  uid += 1
  return { key: `k${uid}`, title: '', subtitle: '', button: '' }
}

// Accumulated run ids live in the URL (?runs=a,b,c) so a page refresh restores
// every batch from the backend (which still holds the runs + PNGs on disk).
const RUNS_PARAM = 'runs'

function readRunIdsFromUrl(): string[] {
  try {
    const p = new URLSearchParams(window.location.search)
    const multi = p.get(RUNS_PARAM)
    if (multi) return multi.split(',').map((s) => s.trim()).filter(Boolean)
    const legacy = p.get('run')
    return legacy ? [legacy] : []
  } catch {
    return []
  }
}

function writeRunIdsToUrl(ids: string[]) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('run')
    if (ids.length) url.searchParams.set(RUNS_PARAM, ids.join(','))
    else url.searchParams.delete(RUNS_PARAM)
    window.history.replaceState(null, '', url.toString())
  } catch {
    /* best-effort */
  }
}

export function BannerBuilder({ meta }: { tool: Tool; meta: Meta }) {
  // ---- Campaign settings ----
  const efforts = meta.thinking_efforts ?? [
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extended' },
  ]
  const [sizes, setSizes] = useState<Set<string>>(new Set([meta.master_size]))
  const [model, setModel] = useState(meta.models[0] ?? 'gpt-image-2')
  const [quality, setQuality] = useState(
    meta.default_quality ?? meta.qualities[meta.qualities.length - 1] ?? 'high',
  )
  const [effort, setEffort] = useState(meta.default_effort ?? 'xhigh')
  const [locale, setLocale] = useState('en')
  const [style, setStyle] = useState('')

  // ---- Concept cards ----
  const [cards, setCards] = useState<ConceptCard[]>([blankCard()])

  const [formError, setFormError] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<{ env: string; label: string; docs_url: string }[] | null>(null)

  const [runs, setRuns] = useState<RunData[]>([])
  const [polling, setPolling] = useState(false)
  const runsRef = useRef<RunData[]>(runs)
  runsRef.current = runs

  // Poll every non-terminal run until all reach a terminal status. New runs are
  // appended (never replace the old ones). The Generate button is disabled while
  // any run is active, so the [polling] flip is enough to re-arm the loop.
  useEffect(() => {
    if (!polling) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      const active = runsRef.current.filter((r) => !TERMINAL_STATUSES.includes(r.status))
      if (active.length === 0) {
        if (!cancelled) setPolling(false)
        return
      }
      const results = await Promise.all(active.map((r) => getRun(r.run_id).catch(() => null)))
      if (cancelled) return
      const byId = new Map<string, RunData>()
      results.forEach((d) => {
        if (d) byId.set(d.run_id, d)
      })
      if (byId.size) setRuns((prev) => prev.map((r) => byId.get(r.run_id) ?? r))
      timer = window.setTimeout(tick, 2000)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [polling])

  // Restore previous batches after a refresh from ?runs=a,b,c. A 404 drops just
  // that id; runs still in flight resume polling. Merges (never clobbers a run
  // started while these fetches were in flight). Runs once on mount.
  useEffect(() => {
    const ids = readRunIdsFromUrl()
    if (ids.length === 0) return
    let alive = true
    ;(async () => {
      const settled = await Promise.all(
        ids.map((id) =>
          getRun(id)
            .then((data) => ({ id, data: data as RunData | null, gone: false }))
            .catch((e) => ({ id, data: null, gone: e instanceof ApiError && e.status === 404 })),
        ),
      )
      if (!alive) return
      const restored = settled.filter((s) => s.data).map((s) => s.data as RunData)
      if (restored.length) {
        setRuns((prev) => {
          const have = new Set(prev.map((r) => r.run_id))
          const fresh = restored.filter((r) => !have.has(r.run_id))
          return fresh.length ? [...fresh, ...prev] : prev
        })
        if (restored.some((r) => !TERMINAL_STATUSES.includes(r.status))) setPolling(true)
      }
      const keepIds = ids.filter((id) => !settled.find((s) => s.id === id && s.gone))
      const existing = runsRef.current.map((r) => r.run_id)
      writeRunIdsToUrl([...keepIds.filter((id) => !existing.includes(id)), ...existing])
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const running = runs.some((r) => !TERMINAL_STATUSES.includes(r.status))

  // ---- Sizes ----
  function toggleSize(s: string) {
    if (s === meta.master_size) return // master always on
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  // ---- Cards: add / remove / reorder ----
  function updateCard(key: string, patch: Partial<ConceptCard>) {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }
  function addCard() {
    setCards((prev) => (prev.length >= 5 ? prev : [...prev, blankCard()]))
  }
  function removeCard(key: string) {
    setCards((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.key !== key)))
  }
  function moveCard(index: number, dir: -1 | 1) {
    setCards((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  // ---- Drag to reorder ----
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  function onDrop(index: number) {
    setCards((prev) => {
      if (dragIndex === null || dragIndex === index) return prev
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  const canRun = cards.length > 0 && cards.every((c) => c.title.trim().length > 0)

  async function startRun() {
    setFormError(null)
    setFormErrors([])
    setMissing(null)
    const payload: CampaignRunRequest = {
      model,
      quality,
      effort,
      locale: locale.trim() || 'en',
      sizes: Array.from(sizes),
      style: style.trim() || undefined,
      concepts: cards.map((c, i) => {
        const p: CampaignRunRequest['concepts'][number] = { key: `c${i + 1}`, title: c.title.trim() }
        if (c.subtitle.trim()) p.subtitle = c.subtitle.trim()
        if (c.button.trim()) p.button = c.button.trim()
        return p
      }),
    }
    try {
      const initial = await createRun(payload)
      const ids = [...runsRef.current.map((r) => r.run_id), initial.run_id]
      setRuns((prev) => [...prev, initial])
      setPolling(true)
      writeRunIdsToUrl(ids)
    } catch (e) {
      if (e instanceof ApiError && e.status === 424) setMissing(e.missingSecrets ?? [])
      else if (e instanceof ApiError && e.errors) setFormErrors(e.errors)
      else setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- Left: brief builder ---------------- */}
      <aside className="flex w-[420px] shrink-0 flex-col border-r border-border bg-background">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {missing && (
            <Alert tone="warn">
              A required key is missing:{' '}
              {missing.map((s) => s.label).join(', ')}. Set it in the server <code>.env</code>.
            </Alert>
          )}
          {formError && <Alert tone="err">{formError}</Alert>}
          {formErrors.length > 0 && (
            <Alert tone="err">
              <div className="font-medium">Couldn't proceed:</div>
              <ul className="mt-1 list-disc pl-4">
                {formErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* Campaign settings */}
          <section className="space-y-4">
            <SectionLabel>Campaign</SectionLabel>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sizes</Label>
                <Badge variant="soft">{sizes.size} selected</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {meta.sizes.map((s) => {
                  const isMaster = s === meta.master_size
                  const on = sizes.has(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSize(s)}
                      title={isMaster ? 'Master — always generated first' : ''}
                      className={cn(
                        'flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        on
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        isMaster && 'cursor-default',
                      )}
                    >
                      <span>{s}</span>
                      {isMaster && <span className="text-[10px] uppercase tracking-wide opacity-70">master</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Model">
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.models.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Image quality">
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.qualities.map((q) => (
                      <SelectItem key={q} value={q}>{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Thinking" hint="GPT-5.5">
                <Select value={effort} onValueChange={setEffort}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {efforts.map((ef) => (
                      <SelectItem key={ef.value} value={ef.value}>{ef.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Locale">
                <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en" />
              </Field>
            </div>

            <Field label="Style" hint="optional">
              <Input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="warm editorial, orange accents"
              />
            </Field>
          </section>

          {/* Concepts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>Concepts</SectionLabel>
              <Badge variant="soft">{cards.length}/5</Badge>
            </div>

            {cards.map((c, i) => (
              <div
                key={c.key}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onDragEnd={() => setDragIndex(null)}
                className={cn(
                  'space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-shadow',
                  dragIndex === i && 'opacity-60 ring-2 ring-primary/40',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    Concept
                  </div>
                  <div className="flex items-center gap-0.5">
                    <IconBtn onClick={() => moveCard(i, -1)} disabled={i === 0} title="Move up">
                      <ChevronUp className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn onClick={() => moveCard(i, 1)} disabled={i === cards.length - 1} title="Move down">
                      <ChevronDown className="h-4 w-4" />
                    </IconBtn>
                    {cards.length > 1 && (
                      <IconBtn onClick={() => removeCard(c.key)} title="Remove concept">
                        <X className="h-4 w-4" />
                      </IconBtn>
                    )}
                  </div>
                </div>

                <Field label="Title">
                  <Input
                    value={c.title}
                    onChange={(e) => updateCard(c.key, { title: e.target.value })}
                    placeholder="Oil prices fell. The ringgit moved."
                  />
                </Field>
                <Field label="Subtitle" hint="optional">
                  <Textarea
                    rows={2}
                    value={c.subtitle}
                    onChange={(e) => updateCard(c.key, { subtitle: e.target.value })}
                    placeholder="Three signals, one connected story."
                  />
                </Field>
                <Field label="Button" hint="optional">
                  <Input
                    value={c.button}
                    onChange={(e) => updateCard(c.key, { button: e.target.value })}
                    placeholder="Learn more"
                  />
                </Field>
              </div>
            ))}

            {cards.length < 5 && (
              <Button variant="outline" className="w-full border-dashed" onClick={addCard}>
                <Plus className="h-4 w-4" />
                Add concept
              </Button>
            )}
          </section>
        </div>

        {/* Sticky generate footer */}
        <div className="shrink-0 border-t border-border bg-background p-4">
          <Button className="w-full" size="lg" onClick={startRun} disabled={!canRun || running}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate banners
              </>
            )}
          </Button>
          {!canRun && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Give each concept a title to generate.
            </p>
          )}
        </div>
      </aside>

      {/* ---------------- Right: results ---------------- */}
      <section className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
        <OutputPane runs={runs} />
      </section>
    </div>
  )
}

// ---- small presentational helpers ----
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">· {hint}</span>}
      </Label>
      {children}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Alert({ tone, children }: { tone: 'err' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'err'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-700',
      )}
    >
      {children}
    </div>
  )
}

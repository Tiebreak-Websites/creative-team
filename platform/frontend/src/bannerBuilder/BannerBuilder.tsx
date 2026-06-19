import { useEffect, useState } from 'react'
import type { Meta, Tool } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { ApiError, getRun, zipUrl } from '../api'
import { createRun } from './campaignApi'
import type { CampaignRunRequest } from './campaignApi'
import { usePolling } from '../hooks/usePolling'
import { Toolbar, MissingSecret } from '../shell/States'
import { Icon } from '../components/Icon'
import { OutputPane } from './Results'

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

export function BannerBuilder({ tool, meta }: { tool: Tool; meta: Meta }) {
  // ---- Campaign settings ----
  const [sizes, setSizes] = useState<Set<string>>(new Set([meta.master_size]))
  const [model, setModel] = useState(meta.models[0] ?? 'gpt-image-2')
  const [quality, setQuality] = useState(meta.qualities[0] ?? 'medium')
  const [locale, setLocale] = useState('en')
  const [style, setStyle] = useState('')

  // ---- Concept cards ----
  const [cards, setCards] = useState<ConceptCard[]>([blankCard()])

  const [formError, setFormError] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<{ env: string; label: string; docs_url: string }[] | null>(null)

  const [runId, setRunId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const { data: runData, setData: setRunData } = usePolling(() => getRun(runId!), polling, 2000)

  useEffect(() => {
    if (runData && TERMINAL_STATUSES.includes(runData.status)) setPolling(false)
  }, [runData])

  const running = !!runData && !TERMINAL_STATUSES.includes(runData.status)
  const anyOk = !!runData && runData.banners.some((b) => b.status === 'ok')

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
      setRunId(initial.run_id)
      setRunData(initial)
      setPolling(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 424) setMissing(e.missingSecrets ?? [])
      else if (e instanceof ApiError && e.errors) setFormErrors(e.errors)
      else setFormError(e instanceof Error ? e.message : String(e))
    }
  }

  const exportAction = anyOk ? (
    <a className="btn" href={zipUrl(runData!.run_id)}>
      <Icon name="download" size={15} /> Download all
    </a>
  ) : null

  return (
    <div className="tool">
      <Toolbar tool={tool} actions={exportAction} />
      <div className="workspace">
        <aside className="panel-left">
          <div className="scroll">
            {missing && <MissingSecret secrets={missing} />}
            {formError && <div className="alert err">{formError}</div>}
            {formErrors.length > 0 && (
              <div className="alert err">
                Couldn't proceed:
                <ul>
                  {formErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ---- Campaign settings ---- */}
            <div className="section">
              <div className="section-head">
                <h3>Campaign settings</h3>
              </div>

              <label className="field">
                <span>Sizes · {sizes.size} selected</span>
                <div className="size-grid">
                  {meta.sizes.map((s) => {
                    const isMaster = s === meta.master_size
                    const on = sizes.has(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        className={`chip ${on ? 'on' : ''} ${isMaster ? 'locked' : ''}`}
                        onClick={() => toggleSize(s)}
                        title={isMaster ? 'Master — always generated first' : ''}
                      >
                        {s}
                        {isMaster ? ' · master' : ''}
                      </button>
                    )
                  })}
                </div>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Model</span>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {meta.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Quality</span>
                  <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                    {meta.qualities.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Locale</span>
                  <input
                    className="input"
                    type="text"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                    placeholder="en"
                  />
                </label>
                <label className="field">
                  <span>Style (optional)</span>
                  <input
                    className="input"
                    type="text"
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    placeholder="warm editorial, orange accents"
                  />
                </label>
              </div>
            </div>

            {/* ---- Concept cards ---- */}
            <div className="section">
              <div className="section-head">
                <h3>Concepts · {cards.length}/5</h3>
              </div>

              {cards.map((c, i) => (
                <div
                  className={`concept-card ${dragIndex === i ? 'dragging' : ''}`}
                  key={c.key}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <div className="concept-head">
                    <span className="ckey">
                      <span className="concept-num">{i + 1}</span> Concept
                    </span>
                    <span className="card-tools" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => moveCard(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => moveCard(i, 1)}
                        disabled={i === cards.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                      {cards.length > 1 && (
                        <button type="button" className="link-btn" onClick={() => removeCard(c.key)}>
                          Remove
                        </button>
                      )}
                    </span>
                  </div>

                  <label className="field">
                    <span>Title</span>
                    <input
                      className="input"
                      type="text"
                      value={c.title}
                      onChange={(e) => updateCard(c.key, { title: e.target.value })}
                      placeholder="Oil prices fell. The ringgit moved."
                    />
                  </label>
                  <label className="field">
                    <span>Subtitle (optional)</span>
                    <textarea
                      value={c.subtitle}
                      onChange={(e) => updateCard(c.key, { subtitle: e.target.value })}
                      placeholder="Three signals, one connected story."
                    />
                  </label>
                  <label className="field">
                    <span>Button (optional)</span>
                    <input
                      className="input"
                      type="text"
                      value={c.button}
                      onChange={(e) => updateCard(c.key, { button: e.target.value })}
                      placeholder="Learn more"
                    />
                  </label>
                </div>
              ))}

              {cards.length < 5 && (
                <button type="button" className="btn ghost" style={{ width: '100%' }} onClick={addCard}>
                  + Add concept
                </button>
              )}
            </div>
          </div>

          <div className="gen-foot">
            <button className="btn block" onClick={startRun} disabled={!canRun || running}>
              {running ? (
                <>
                  <span className="spinner light" /> Generating…
                </>
              ) : (
                'Generate banners'
              )}
            </button>
            {!canRun && <div className="hint">Give each concept a title to generate.</div>}
          </div>
        </aside>

        <section className="panel-right">
          <OutputPane run={runData} />
        </section>
      </div>
    </div>
  )
}

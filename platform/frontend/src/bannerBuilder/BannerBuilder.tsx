import { useEffect, useState } from 'react'
import type { ConceptForm, Meta, Tool } from '../types'
import { TERMINAL_STATUSES } from '../types'
import { ApiError, createRun, getRun, suggestConcepts, zipUrl } from '../api'
import type { ConceptPayload, RunRequest } from '../api'
import { usePolling } from '../hooks/usePolling'
import { Toolbar, MissingSecret } from '../shell/States'
import { Icon } from '../components/Icon'
import { OutputPane } from './Results'

let uid = 0
function blankConcept(): ConceptForm {
  uid += 1
  return { key: `k${uid}`, hook_phrase: '', creative_brief: '', button_bg: null }
}

export function BannerBuilder({ tool, meta }: { tool: Tool; meta: Meta }) {
  const [bannerText, setBannerText] = useState('')
  const [cta, setCta] = useState('')
  const [locale, setLocale] = useState('en')
  const [model, setModel] = useState(meta.models[0] ?? 'gpt-image-2')
  const [quality, setQuality] = useState(meta.qualities[0] ?? 'medium')
  const [sizes, setSizes] = useState<Set<string>>(new Set([meta.master_size]))
  const [concepts, setConcepts] = useState<ConceptForm[]>([blankConcept()])

  const [aiBusy, setAiBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<{ env: string; label: string; docs_url: string }[] | null>(null)

  const [runId, setRunId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const { data: runData, setData: setRunData } = usePolling(() => getRun(runId!), polling, 2000)

  useEffect(() => {
    if (runData && TERMINAL_STATUSES.includes(runData.status)) setPolling(false)
  }, [runData])

  const hasCta = cta.trim().length > 0
  const titleLower = bannerText.trim().toLowerCase()
  const aiAvailable = tool.secrets.find((s) => s.env === 'ANTHROPIC_API_KEY')?.present === true
  const running = !!runData && !TERMINAL_STATUSES.includes(runData.status)
  const anyOk = !!runData && runData.banners.some((b) => b.status === 'ok')

  function toggleSize(s: string) {
    if (s === meta.master_size) return
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function updateConcept(key: string, patch: Partial<ConceptForm>) {
    setConcepts((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }
  function addConcept() {
    setConcepts((prev) => (prev.length >= 5 ? prev : [...prev, blankConcept()]))
  }
  function removeConcept(key: string) {
    setConcepts((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.key !== key)))
  }

  async function runAiAssist() {
    if (!bannerText.trim()) {
      setFormError('Enter the banner text first.')
      return
    }
    setAiBusy(true)
    setFormError(null)
    setFormErrors([])
    try {
      const suggested = await suggestConcepts({
        banner_text: bannerText.trim(),
        cta: hasCta ? cta.trim() : undefined,
        locale,
        concept_count: Math.max(1, concepts.length),
      })
      setConcepts(
        suggested.map((s, i) => ({
          key: `ai_${Date.now()}_${i}`,
          hook_phrase: s.hook_phrase,
          creative_brief: s.creative_brief,
          button_bg: s.button_combo?.[0] ?? null,
        })),
      )
    } catch (e) {
      if (e instanceof ApiError && e.errors) setFormErrors(e.errors)
      else setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiBusy(false)
    }
  }

  const canRun =
    bannerText.trim().length > 0 &&
    concepts.length > 0 &&
    concepts.every((c) => c.hook_phrase.trim() && c.creative_brief.trim())

  async function startRun() {
    setFormError(null)
    setFormErrors([])
    setMissing(null)
    const fallbackBg = meta.button_combos[0]
    const payload: RunRequest = {
      banner_text: bannerText.trim(),
      locale,
      model,
      quality,
      sizes: Array.from(sizes),
      concepts: concepts.map((c, i) => {
        const p: ConceptPayload = {
          key: `c${i + 1}`,
          title: bannerText.trim(),
          locale,
          hook_phrase: c.hook_phrase.trim(),
          creative_brief: c.creative_brief.trim(),
        }
        if (hasCta) {
          p.cta = cta.trim()
          const combo = meta.button_combos.find((bc) => bc.bg === c.button_bg) ?? fallbackBg
          if (combo) p.button_combo = [combo.bg, combo.text]
        }
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

            <div className="section">
              <div className="section-head">
                <h3>Copy</h3>
              </div>
              <label className="field">
                <span>Banner text (rendered verbatim)</span>
                <textarea
                  value={bannerText}
                  onChange={(e) => setBannerText(e.target.value)}
                  placeholder="Oil prices fell. The ringgit moved. PETRONAS earnings shifted."
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>CTA (optional)</span>
                  <input
                    className="input"
                    type="text"
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    placeholder="Learn more"
                  />
                </label>
                <label className="field">
                  <span>Locale</span>
                  <input
                    className="input"
                    type="text"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  />
                </label>
              </div>
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
            </div>

            <div className="section">
              <div className="section-head">
                <h3>Sizes</h3>
              </div>
              <div className="size-grid">
                {meta.sizes.map((s) => {
                  const isMaster = s === meta.master_size
                  const on = sizes.has(s)
                  return (
                    <button
                      key={s}
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
            </div>

            <div className="section">
              <div className="section-head">
                <h3>Concepts · {concepts.length}/5</h3>
                <button
                  className="btn sm secondary"
                  onClick={runAiAssist}
                  disabled={aiBusy || !aiAvailable}
                  title={aiAvailable ? 'Draft concepts from the banner text' : 'Add ANTHROPIC_API_KEY to enable AI assist'}
                >
                  {aiBusy ? (
                    <>
                      <span className="spinner" /> Generating
                    </>
                  ) : (
                    '✦ AI assist'
                  )}
                </button>
              </div>

              {concepts.map((c, i) => {
                const hookOk =
                  c.hook_phrase.trim() && titleLower.includes(c.hook_phrase.trim().toLowerCase())
                return (
                  <div className="concept-card" key={c.key}>
                    <div className="concept-head">
                      <span className="ckey">
                        <span className="concept-num">{i + 1}</span> Concept
                      </span>
                      {concepts.length > 1 && (
                        <button className="link-btn" onClick={() => removeConcept(c.key)}>
                          Remove
                        </button>
                      )}
                    </div>
                    <label className="field">
                      <span>Hook · 2–4 words from the banner text</span>
                      <input
                        className="input"
                        type="text"
                        value={c.hook_phrase}
                        onChange={(e) => updateConcept(c.key, { hook_phrase: e.target.value })}
                        placeholder="OIL PRICES FELL"
                      />
                      {c.hook_phrase.trim().length > 0 &&
                        (hookOk ? (
                          <div className="hint good">✓ found in banner text</div>
                        ) : (
                          <div className="hint bad">✗ not a verbatim fragment of the banner text</div>
                        ))}
                    </label>
                    <label className="field">
                      <span>Creative brief</span>
                      <textarea
                        value={c.creative_brief}
                        onChange={(e) => updateConcept(c.key, { creative_brief: e.target.value })}
                        placeholder="Type-hero poster. Hook in saturated orange against a deep charcoal gradient…"
                      />
                    </label>
                    {hasCta && (
                      <label className="field">
                        <span>Button colour</span>
                        <div className="swatches">
                          {meta.button_combos.map((bc) => (
                            <div
                              key={bc.bg}
                              className={`swatch ${c.button_bg === bc.bg ? 'on' : ''}`}
                              style={{ background: bc.bg }}
                              title={`${bc.bg} / ${bc.text}`}
                              onClick={() => updateConcept(c.key, { button_bg: bc.bg })}
                            />
                          ))}
                        </div>
                      </label>
                    )}
                  </div>
                )
              })}

              {concepts.length < 5 && (
                <button className="btn ghost" style={{ width: '100%' }} onClick={addConcept}>
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
            {!canRun && (
              <div className="hint">Add banner text and fill each concept's hook + brief.</div>
            )}
          </div>
        </aside>

        <section className="panel-right">
          <OutputPane run={runData} />
        </section>
      </div>
    </div>
  )
}

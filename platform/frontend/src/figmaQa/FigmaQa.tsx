import { useState } from 'react'
import type { Tool } from '../types'
import { Toolbar, MissingSecret } from '../shell/States'
import { Icon } from '../components/Icon'

interface Finding {
  check: string
  severity: string
  device?: string
  nodeId?: string
  message: string
  rewrite?: string
  preview?: string
}

interface QaResult {
  status: 'ok' | 'partial' | 'error'
  summary?: {
    fileKey?: string
    fileName?: string
    lang?: string
    brand?: string
    devices?: string[]
    counts?: { total: number; errors: number; warnings: number }
    tone?: string
    warnings?: string[]
  }
  report_markdown?: string | null
  findings?: Finding[]
  posted?: number
  error?: string | null
}

const CHECK_LABELS: Record<string, string> = {
  parity: 'Cross-device parity',
  placeholder: 'Placeholder text',
  'broken-image': 'Broken images',
  overflow: 'Text overflow',
  'cta-dummy': 'CTA — placeholder label',
  'cta-mismatch': 'CTA — label mismatch',
  'regulator-phrase': 'Regulator phrases',
  'wrong-language': 'Wrong language',
  tone: 'Conversion tone',
}

const CHECK_ORDER = Object.keys(CHECK_LABELS)

export function FigmaQa({ tool }: { tool: Tool }) {
  const figmaSecret = tool.secrets.find((s) => s.env === 'FIGMA_API_KEY')
  const aiAvailable = tool.secrets.find((s) => s.env === 'ANTHROPIC_API_KEY')?.present === true

  const [figmaUrl, setFigmaUrl] = useState('')
  const [lang, setLang] = useState('es')
  const [brand, setBrand] = useState('')
  const [postComments, setPostComments] = useState(false)
  const [toneCheck, setToneCheck] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] =
    useState<{ env: string; label: string; docs_url: string }[] | null>(null)
  const [result, setResult] = useState<QaResult | null>(null)

  const canRun = figmaUrl.trim().length > 0 && lang.trim().length > 0 && !busy

  async function run() {
    setBusy(true)
    setError(null)
    setMissing(null)
    setResult(null)
    try {
      const r = await fetch(`/api/tools/${tool.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figma_url: figmaUrl.trim(),
          lang: lang.trim(),
          brand: brand.trim() || undefined,
          post_comments: postComments,
          tone: toneCheck,
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.status === 424) {
        setMissing(body.missing_secrets ?? [])
        return
      }
      if (!r.ok) {
        setError(body.detail ? JSON.stringify(body.detail) : `Request failed (HTTP ${r.status}).`)
        return
      }
      setResult(body as QaResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const counts = result?.summary?.counts
  const findings = result?.findings ?? []

  // Group findings by check, in display order.
  const grouped: Record<string, Finding[]> = {}
  for (const f of findings) (grouped[f.check] ??= []).push(f)
  const orderedKeys = [
    ...CHECK_ORDER.filter((k) => grouped[k]),
    ...Object.keys(grouped).filter((k) => !CHECK_ORDER.includes(k)),
  ]

  return (
    <div className="tool">
      <Toolbar
        tool={tool}
        actions={
          <button className="btn" disabled={!canRun} onClick={run}>
            {busy ? (
              <>
                <span className="spinner light" /> Running…
              </>
            ) : (
              'Run QA'
            )}
          </button>
        }
      />
      <div className="page">
        <div className="page-inner">
          {missing && <MissingSecret secrets={missing} />}
          {error && <div className="alert err">{error}</div>}

          {/* ---------- Form ---------- */}
          <div className="card">
            <label className="field">
              <span>Figma file URL *</span>
              <input
                className="input"
                type="text"
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/ABC123/My-Localized-LP?node-id=1-2"
              />
              <div className="hint muted">
                Any figma.com/design/… or /file/… link — the file key is parsed for you.
              </div>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Language code *</span>
                <input
                  className="input"
                  type="text"
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  placeholder="es"
                />
              </label>
              <label className="field">
                <span>Brand (optional)</span>
                <input
                  className="input"
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="braintrade-template"
                />
              </label>
            </div>

            <label className="field" style={{ marginBottom: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={postComments}
                  onChange={(e) => setPostComments(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Post findings as Figma comments
              </span>
              <div className="hint muted">Requires a token with Comments:Write scope. Off by default.</div>
            </label>

            <label className="field" style={{ marginBottom: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={toneCheck}
                  onChange={(e) => setToneCheck(e.target.checked)}
                  disabled={!aiAvailable}
                  style={{ width: 'auto' }}
                />
                AI conversion-tone check
              </span>
              <div className="hint muted">
                {aiAvailable
                  ? 'Adds Claude tone judgment (slower). Language check always runs when a key is set.'
                  : 'Add ANTHROPIC_API_KEY to enable AI language/tone judgment.'}
              </div>
            </label>
          </div>

          {/* ---------- Result ---------- */}
          {result && result.status === 'error' && (
            <div className="alert err">{result.error || 'QA failed.'}</div>
          )}

          {result && result.status !== 'error' && (
            <>
              {result.summary?.warnings && result.summary.warnings.length > 0 && (
                <div className="alert warn">
                  <ul style={{ margin: 0 }}>
                    {result.summary.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card">
                <div className="section-head" style={{ marginBottom: 14 }}>
                  <h3>Result</h3>
                  {typeof result.posted === 'number' && (
                    <span className="pill ver">{result.posted} comment(s) posted</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Stat label="Issues" value={counts?.total ?? 0} />
                  <Stat label="Errors" value={counts?.errors ?? 0} tone="danger" />
                  <Stat label="Warnings" value={counts?.warnings ?? 0} tone="warn" />
                  <Stat label="Devices" value={result.summary?.devices?.length ?? 0} />
                </div>

                <p className="muted" style={{ margin: '14px 0 0', fontSize: 12.5 }}>
                  {result.summary?.fileName} · lang <code className="inline">{result.summary?.lang}</code> ·
                  brand <code className="inline">{result.summary?.brand}</code> · tone{' '}
                  <code className="inline">{result.summary?.tone}</code>
                </p>
              </div>

              {findings.length === 0 ? (
                <div className="card">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: 'var(--ok)',
                      fontWeight: 600,
                    }}
                  >
                    <Icon name="check-circle" size={18} /> No issues found.
                  </div>
                </div>
              ) : (
                <div className="card">
                  <h3 style={{ marginBottom: 14 }}>Findings</h3>
                  {orderedKeys.map((key) => (
                    <div key={key} style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--muted)',
                          marginBottom: 8,
                        }}
                      >
                        {CHECK_LABELS[key] ?? key}
                        <span className="pill ver">{grouped[key].length}</span>
                      </div>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {grouped[key].map((f, i) => (
                          <li
                            key={i}
                            style={{
                              display: 'flex',
                              gap: 10,
                              padding: '10px 0',
                              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                            }}
                          >
                            <span
                              className="pill"
                              style={{
                                flex: 'none',
                                height: 'fit-content',
                                background:
                                  f.severity === 'error' ? 'var(--danger-soft)' : 'var(--warn-soft)',
                                color: f.severity === 'error' ? '#a51b1b' : 'var(--warn)',
                              }}
                            >
                              {f.severity}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{f.message}</div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  marginTop: 4,
                                  fontSize: 12,
                                  color: 'var(--muted)',
                                }}
                              >
                                {f.device && <span>{f.device}</span>}
                                {f.nodeId && <code className="inline">{f.nodeId}</code>}
                              </div>
                              {f.rewrite && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    fontSize: 12.5,
                                    color: 'var(--text-2)',
                                    background: 'var(--surface-sunken)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '6px 9px',
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                    Suggested rewrite:
                                  </span>{' '}
                                  {f.rewrite}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'danger' | 'warn'
}) {
  const color =
    tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)'
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 90,
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

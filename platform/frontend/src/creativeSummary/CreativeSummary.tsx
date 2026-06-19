import { useState } from 'react'
import type { Tool } from '../types'
import { Toolbar, MissingSecret } from '../shell/States'
import { Icon } from '../components/Icon'

interface FigmaOp {
  op: string
  text: string
  name: string
  x: number
  y: number
  width: number
  fontSize: number
}

interface SummaryResult {
  status: string
  summary_markdown: string
  summary_text: string
  language: string
  english_only: boolean
  figma_ops: FigmaOp[]
  figma_comment: { message: string; node_id: string | null }
  posted_comment: boolean
  post_error?: string
  plugin_code?: string
  frame: { node_id: string | null; name: string | null }
}

type MissingSecretFlag = { env: string; label: string; docs_url: string }

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export function CreativeSummary({ tool }: { tool: Tool }) {
  const [figmaUrl, setFigmaUrl] = useState('')
  const [postComment, setPostComment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<MissingSecretFlag[] | null>(null)
  const [result, setResult] = useState<SummaryResult | null>(null)
  const [copied, setCopied] = useState(false)

  const canRun = figmaUrl.trim().length > 0 && !busy

  async function run() {
    setBusy(true)
    setError(null)
    setMissing(null)
    setResult(null)
    setCopied(false)
    try {
      const r = await fetch(`${BASE}/tools/creative-summary/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figma_url: figmaUrl.trim(), post_comment: postComment }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.status === 424) {
        setMissing(body.missing_secrets ?? [])
        return
      }
      if (!r.ok) {
        setError(body.error ?? `Run failed (HTTP ${r.status}).`)
        return
      }
      setResult(body as SummaryResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.summary_text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  function download(kind: 'md' | 'txt') {
    if (!result) return
    const content = kind === 'md' ? result.summary_markdown : result.summary_text
    const mime = kind === 'md' ? 'text/markdown' : 'text/plain'
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `creative-summary.${kind}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="tool">
      <Toolbar tool={tool} />
      <div className="page">
        <div className="page-inner">
          {missing && <MissingSecret secrets={missing} />}
          {error && <div className="alert err">{error}</div>}

          <div className="card">
            <h3 style={{ marginBottom: 4 }}>Creative Summary</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              Paste a Figma landing-page URL. We read the LP copy and generate a short
              bilingual summary of what it promotes, written for a sales agent.
            </p>

            <label className="field">
              <span>Figma LP URL</span>
              <input
                className="input"
                type="text"
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/AbC123/My-LP?node-id=12-34"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canRun) run()
                }}
              />
              <div className="hint muted">
                Targets the frame in the URL's <code className="inline">node-id</code>, or the
                widest desktop frame on the first page.
              </div>
            </label>

            <label
              className="field"
              style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={postComment}
                onChange={(e) => setPostComment(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span style={{ margin: 0 }}>Post the summary to Figma as a pinned comment</span>
            </label>

            <div className="btn-row" style={{ marginTop: 4 }}>
              <button className="btn" onClick={run} disabled={!canRun}>
                {busy ? (
                  <>
                    <span className="spinner light" /> Generating…
                  </>
                ) : (
                  <>
                    <Icon name="sparkles" size={15} /> Generate summary
                  </>
                )}
              </button>
            </div>
          </div>

          {result && (
            <div className="card">
              <div
                className="section-head"
                style={{ marginBottom: 14, alignItems: 'flex-start' }}
              >
                <div>
                  <h3 style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14 }}>
                    Summary
                  </h3>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    {result.frame.name ? `Frame: ${result.frame.name}` : 'Generated'} ·{' '}
                    {result.english_only ? 'English-only' : `${result.language} + English`}
                  </p>
                </div>
                <div className="btn-row">
                  <button className="btn sm secondary" onClick={copy}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button className="btn sm secondary" onClick={() => download('md')}>
                    <Icon name="download" size={14} /> .md
                  </button>
                  <button className="btn sm secondary" onClick={() => download('txt')}>
                    <Icon name="download" size={14} /> .txt
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '14px 16px',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  fontSize: 14,
                }}
              >
                {result.summary_text}
              </div>

              {result.posted_comment && (
                <div className="alert" style={{ marginTop: 14, marginBottom: 0, background: 'var(--ok-soft)', border: '1px solid #bfe6cb', color: '#15803d' }}>
                  ✓ Posted to Figma as a pinned comment on the frame.
                </div>
              )}
              {result.post_error && (
                <div className="alert warn" style={{ marginTop: 14, marginBottom: 0 }}>
                  Summary generated, but the Figma comment didn't post: {result.post_error}
                </div>
              )}

              <div
                className="alert"
                style={{ marginTop: 14, marginBottom: 0, background: 'var(--accent-soft)', border: '1px solid #d6daff', color: 'var(--accent)' }}
              >
                Place it on the canvas with the <strong>Creative Tools</strong> Figma plugin — open
                it on this file and click “Apply latest result”, or enter code{' '}
                <code className="inline">{result.plugin_code ?? '—'}</code>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

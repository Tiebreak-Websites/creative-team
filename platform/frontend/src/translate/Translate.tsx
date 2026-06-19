import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Tool } from '../types'
import { Toolbar, MissingSecret } from '../shell/States'
import { Icon } from '../components/Icon'

// --- API types (local to this tool; api.ts is shared and not edited) ----------

interface SecretFlag {
  env: string
  label: string
  docs_url: string
}

interface ValidationFailure {
  id: string
  source: string
  translation: string
  failures?: { rule: string; message: string }[]
}

interface LocaleResult {
  locale: string
  strings: Record<string, string> // { nodeId: translatedText }
  pairs: {
    id: string
    source: string
    translation: string
    role?: string | null
    isCta?: boolean
    charLimit?: number | null
  }[]
  validation: {
    passed: number
    failed: number
    missing: number
    total: number
    failures: ValidationFailure[]
    error?: string | null
  }
  figma_ops: {
    op: string
    sourcePageName: string
    newPageName: string
    replacements: Record<string, string>
  }
}

interface TranslateResult {
  status: 'ok' | 'error'
  error?: string
  source?: {
    count: number
    lang: string
    pageName: string
    fileName: string | null
    fileKey: string
    skippedCount: number
    strings: { id: string; source: string; nodeCount: number }[]
  }
  locales?: LocaleResult[]
  plugin_code?: string
}

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

// Inline styles for the translation table (styles.css is shared and not edited).
const TH: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface-sunken)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted)',
  position: 'sticky',
  top: 0,
}
const TD: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  color: 'var(--text-2)',
}
const ROW_FAIL: CSSProperties = { background: 'var(--warn-soft)' }
const TAG_PILL: CSSProperties = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 600,
  verticalAlign: 'middle',
}

// -----------------------------------------------------------------------------

export function Translate({ tool }: { tool: Tool }) {
  const [figmaUrl, setFigmaUrl] = useState('')
  const [locales, setLocales] = useState('')
  const [page, setPage] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<SecretFlag[] | null>(null)
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [active, setActive] = useState(0)

  const canRun = figmaUrl.trim().length > 0 && locales.trim().length > 0 && !busy

  async function run() {
    setBusy(true)
    setError(null)
    setMissing(null)
    setResult(null)
    setActive(0)
    try {
      const r = await fetch(`${BASE}/tools/translate-figma/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figma_url: figmaUrl.trim(),
          locales: locales.trim(),
          page: page.trim() || undefined,
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
      if (body.status === 'error') {
        setError(body.error ?? 'Translation failed.')
        return
      }
      setResult(body as TranslateResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool">
      <Toolbar tool={tool} />
      <div className="page">
        <div className="page-inner">
          {missing && <MissingSecret secrets={missing} />}
          {error && <div className="alert err">{error}</div>}

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Translate a Figma page</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              Paste a Figma page URL and target locales. The tool extracts the page's text,
              translates it with Claude, validates each locale, and returns per-locale results
              to preview and download.
            </p>
            <label className="field">
              <span>Figma page URL *</span>
              <input
                className="input"
                type="text"
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/<fileKey>/My-Landing-Page"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Target locales * — comma-separated</span>
                <input
                  className="input"
                  type="text"
                  value={locales}
                  onChange={(e) => setLocales(e.target.value)}
                  placeholder="de,es,fr"
                />
              </label>
              <label className="field">
                <span>Page name (optional)</span>
                <input
                  className="input"
                  type="text"
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  placeholder="LP Template"
                />
              </label>
            </div>
            <button className="btn" onClick={run} disabled={!canRun}>
              {busy ? (
                <>
                  <span className="spinner light" /> Translating…
                </>
              ) : (
                <>
                  <Icon name="languages" size={15} /> Translate
                </>
              )}
            </button>
            {busy && (
              <div className="hint muted" style={{ marginTop: 10 }}>
                Fetching the file, extracting text, and translating each locale — this can take
                30–60s for a few locales.
              </div>
            )}
          </div>

          {result?.source && result.locales && (
            <Results result={result} active={active} onSelect={setActive} />
          )}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------

function Results({
  result,
  active,
  onSelect,
}: {
  result: TranslateResult
  active: number
  onSelect: (i: number) => void
}) {
  const source = result.source!
  const locales = result.locales!
  const current = locales[active] ?? locales[0]

  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Source</h3>
        <p className="muted" style={{ margin: 0 }}>
          <strong>{source.count}</strong> unique string{source.count === 1 ? '' : 's'} extracted
          {source.pageName ? (
            <>
              {' '}
              from page <code className="inline">{source.pageName}</code>
            </>
          ) : null}{' '}
          · source language <code className="inline">{source.lang}</code>
          {source.skippedCount > 0 ? <> · {source.skippedCount} skipped (do-not-translate)</> : null}
        </p>
      </div>

      <div className="card">
        <div className="size-grid" style={{ marginBottom: 16 }}>
          {locales.map((l, i) => (
            <button
              key={l.locale}
              className={`chip ${i === active ? 'on' : ''}`}
              onClick={() => onSelect(i)}
            >
              {l.locale}
              {l.validation.failed > 0 || l.validation.missing > 0 ? ' ⚠' : ' ✓'}
            </button>
          ))}
        </div>

        {current && <LocaleCard locale={current} fileKey={source.fileKey} />}
      </div>

      <div className="card">
        <p style={{ margin: 0 }}>
          Create the translated pages on the canvas with the <strong>Creative Tools</strong> Figma
          plugin: open it on this file and click “Apply latest result”, or enter code{' '}
          <code className="inline">{result.plugin_code ?? '—'}</code>. It duplicates the page per
          locale and swaps the text. Each locale's Download JSON also includes its{' '}
          <code className="inline">figma_ops</code>.
        </p>
      </div>
    </>
  )
}

function LocaleCard({ locale, fileKey }: { locale: LocaleResult; fileKey: string }) {
  const v = locale.validation
  const ok = v.failed === 0 && v.missing === 0 && !v.error

  const downloadHref = useMemo(() => {
    const payload = {
      locale: locale.locale,
      strings: locale.strings,
      figma_ops: locale.figma_ops,
      validation: v,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    return URL.createObjectURL(blob)
  }, [locale, v])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <span className="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <span className={`status-dot ${ok ? 'ok' : 'fail'}`} />
          {locale.locale}
        </span>
        <span className="muted" style={{ fontSize: 12, flex: 1 }}>
          {v.error ? (
            <>validation unavailable</>
          ) : (
            <>
              {v.passed}/{v.total} passed
              {v.failed > 0 ? ` · ${v.failed} failed` : ''}
              {v.missing > 0 ? ` · ${v.missing} missing` : ''}
            </>
          )}
        </span>
        <a className="btn sm secondary" href={downloadHref} download={`${fileKey}.translate-${locale.locale}.json`}>
          <Icon name="download" size={14} /> Download JSON
        </a>
      </div>

      {v.error && <div className="alert warn">Validation could not run: {v.error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH}>Source</th>
              <th style={TH}>{locale.locale}</th>
            </tr>
          </thead>
          <tbody>
            {locale.pairs.map((p) => {
              const failed = v.failures?.some((f) => f.id === p.id)
              return (
                <tr key={p.id} style={failed ? ROW_FAIL : undefined}>
                  <td style={TD}>
                    {p.source}
                    {p.isCta ? <span style={TAG_PILL}>CTA</span> : null}
                    {p.charLimit ? <span style={TAG_PILL}>≤{p.charLimit}</span> : null}
                  </td>
                  <td style={TD}>{p.translation}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {v.failures && v.failures.length > 0 && (
        <div className="alert warn" style={{ marginTop: 12 }}>
          {v.failures.length} string{v.failures.length === 1 ? '' : 's'} flagged by validation:
          <ul>
            {v.failures.slice(0, 8).map((f) => (
              <li key={f.id}>
                <code>{f.source}</code> — {(f.failures ?? []).map((r) => r.rule).join(', ')}
              </li>
            ))}
            {v.failures.length > 8 && <li>…and {v.failures.length - 8} more (see the downloaded JSON).</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

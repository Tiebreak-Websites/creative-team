import { useState } from 'react'
import type { Tool } from '../types'
import { Toolbar } from './States'

/**
 * Schema-driven form for simple batch tools. Not exercised in v1 (the Banner
 * Builder ships a custom UI), but it's the path tool #2 (e.g. Figma QA) plugs
 * into — it renders `tool.fields` and POSTs to /api/tools/{id}/run.
 */
export function GenericToolForm({ tool }: { tool: Tool }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function set(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }))
  }

  async function submit() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const r = await fetch(`/api/tools/${tool.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(body.detail ? JSON.stringify(body.detail) : `HTTP ${r.status}`)
        return
      }
      setResult(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool">
      <Toolbar
        tool={tool}
        actions={
          tool.fields.length > 0 && (
            <button className="btn" disabled={busy} onClick={submit}>
              {busy ? 'Running…' : 'Run'}
            </button>
          )
        }
      />
      <div className="page">
        <div className="page-inner">
          {error && <div className="alert err">{error}</div>}
          <div className="card">
            {tool.fields.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                This tool has no inputs configured yet.
              </p>
            )}
            {tool.fields.map((f) => (
              <label className="field" key={f.name}>
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                {f.type === 'textarea' ? (
                  <textarea value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
                ) : f.type === 'select' && f.options ? (
                  <select value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}>
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    type="text"
                    value={values[f.name] ?? ''}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
                {f.help && <div className="hint muted">{f.help}</div>}
              </label>
            ))}
          </div>
          {result != null && (
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Result</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

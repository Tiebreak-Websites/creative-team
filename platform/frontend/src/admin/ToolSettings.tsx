import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useToolConfig } from '../hooks/useToolConfig'
import { Icon } from '../components/Icon'
import type { Tool } from '../types'
import { BrandSettings } from './BrandSettings'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/**
 * Admin-only page: pick a tool, edit its `instructions` (textarea) and `options`
 * (JSON editor with live validation), Save -> PUT. Non-admins get a polite
 * "admins only" notice (the backend enforces it too — this is just UX).
 */
export function ToolSettings({ tools }: { tools: Tool[] }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Only the available, runnable tools have a backend config. Skip teasers
  // (coming-soon / desktop-only) so the picker never offers a tool whose config
  // endpoint would 404.
  const configurable = useMemo(
    () => tools.filter((t) => t.status === 'available'),
    [tools],
  )
  const [toolId, setToolId] = useState<string | null>(null)

  useEffect(() => {
    if (!toolId && configurable.length) setToolId(configurable[0].id)
  }, [configurable, toolId])

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="page-inner">
          <div className="card">
            <h3 style={{ marginBottom: 6 }}>Admins only</h3>
            <p className="muted" style={{ margin: 0 }}>
              Tool settings can only be edited by an administrator. Ask a project owner
              if you need a change made here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="tool">
      <header className="toolbar">
        <div className="ttitle">
          <h1>Tool Settings</h1>
          <span className="pill ver">Admin</span>
        </div>
      </header>
      <div className="page">
        <div className="page-inner">
          <BrandSettings />
          <div className="card">
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Tool</span>
              <select
                className="input"
                value={toolId ?? ''}
                onChange={(e) => setToolId(e.target.value)}
              >
                {configurable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <div className="hint muted">
                Edit the help text and options shown inside each tool. Changes apply
                immediately for everyone.
              </div>
            </label>
          </div>

          {toolId && <ConfigEditor key={toolId} toolId={toolId} />}
        </div>
      </div>
    </div>
  )
}

function ConfigEditor({ toolId }: { toolId: string }) {
  const { config, loading, error, reload } = useToolConfig(toolId)

  const [instructions, setInstructions] = useState('')
  const [optionsText, setOptionsText] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Hydrate the editors when the loaded config arrives.
  useEffect(() => {
    if (config) {
      setInstructions(config.instructions ?? '')
      setOptionsText(JSON.stringify(config.options ?? {}, null, 2))
      setJsonError(null)
      setSaveError(null)
      setSaved(false)
    }
  }, [config])

  function onOptionsChange(text: string) {
    setOptionsText(text)
    setSaved(false)
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Options must be a JSON object (e.g. { "key": "value" }).')
      } else {
        setJsonError(null)
      }
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON.')
    }
  }

  async function save() {
    if (jsonError) return
    let options: unknown
    try {
      options = JSON.parse(optionsText)
    } catch {
      setJsonError('Invalid JSON.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const r = await fetch(`${BASE}/tools/${toolId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instructions, options }),
      })
      if (r.status === 403) {
        setSaveError('Admins only — you don’t have permission to save this.')
        return
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setSaveError(body.detail ?? `Save failed (HTTP ${r.status}).`)
        return
      }
      const updated = await r.json()
      setInstructions(updated.instructions ?? '')
      setOptionsText(JSON.stringify(updated.options ?? {}, null, 2))
      setSaved(true)
      reload()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="card muted">
        <span className="spinner" /> Loading config…
      </div>
    )
  }
  if (error) {
    return <div className="alert err">Could not load config: {error}</div>
  }

  return (
    <div className="card">
      {saveError && <div className="alert err">{saveError}</div>}

      <label className="field">
        <span>Instructions (markdown)</span>
        <textarea
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value)
            setSaved(false)
          }}
          rows={8}
          placeholder="## How to use this tool…"
        />
        <div className="hint muted">
          Shown as a help block inside the tool. Supports ## headings, - bullets,
          **bold**, _italic_, and `code`.
        </div>
      </label>

      <label className="field">
        <span>Options (JSON)</span>
        <textarea
          value={optionsText}
          onChange={(e) => onOptionsChange(e.target.value)}
          rows={12}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
        />
        {jsonError ? (
          <div className="hint bad">{jsonError}</div>
        ) : (
          <div className="hint good">Valid JSON</div>
        )}
      </label>

      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn" onClick={save} disabled={saving || !!jsonError}>
          {saving ? (
            <>
              <span className="spinner light" /> Saving…
            </>
          ) : (
            <>
              <Icon name="check-circle" size={15} /> Save changes
            </>
          )}
        </button>
        {saved && <span className="hint good" style={{ margin: 0 }}>✓ Saved</span>}
      </div>
    </div>
  )
}

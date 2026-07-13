import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  composePage,
  createSection,
  deleteSection,
  DEVICE_WIDTH,
  putLanguages,
  updateSection,
  uploadLpAsset,
  type Device,
  type Language,
  type Project,
  type SectionDef,
} from './api'

/** Admin — manage the section template library + the global language list. */
export function AdminTemplates({
  sections,
  languages,
  onBack,
  onChanged,
  onError,
}: {
  sections: SectionDef[]
  languages: Language[]
  onBack: () => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [editing, setEditing] = useState<SectionDef | null>(null)
  const [langsDraft, setLangsDraft] = useState<Language[]>(languages)
  const [savingLangs, setSavingLangs] = useState(false)
  useEffect(() => setLangsDraft(languages), [languages])

  const ordered = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections])

  if (editing) {
    return (
      <SectionEditor
        section={editing}
        languages={languages}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          onChanged()
        }}
        onError={onError}
      />
    )
  }

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-6 py-8">
      <div className="mb-6 flex items-center gap-3 animate-fade-up">
        <Button variant="ghost" size="icon" onClick={onBack} title="Back" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The section library every landing page is built from. Built-ins can be edited or disabled, never deleted.
          </p>
        </div>
      </div>

      <div className="space-y-2 animate-fade-up" style={{ animationDelay: '80ms' }}>
        {ordered.map((s) => (
          <div key={s.key} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
            <span className="w-20 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
              {s.category}
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', !s.enabled && 'text-muted-foreground line-through')}>
              {s.name}
            </span>
            {s.built_in && (
              <span className="shrink-0 rounded border border-primary/35 px-1.5 text-[9px] font-semibold text-primary">BUILT-IN</span>
            )}
            <span className="shrink-0 text-[10px] text-muted-foreground">{s.languages.join(' · ')}</span>
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title="Show in the builder's Add tab">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) =>
                  updateSection(s.key, { enabled: e.target.checked }).then(onChanged).catch((err) => onError(err.message))
                }
                aria-label={`Enable ${s.name}`}
              />
              enabled
            </label>
            <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Clone into a new custom section"
              onClick={() => {
                const key = window.prompt('Key for the clone (lowercase-with-dashes):', `${s.key}-copy`)
                if (!key) return
                createSection({ key, name: `${s.name} (copy)`, clone_of: s.key })
                  .then(onChanged)
                  .catch((err) => onError(err.message))
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {!s.built_in && (
              <Button
                variant="outline"
                size="sm"
                className="hover:border-destructive hover:text-destructive"
                title="Delete this custom section"
                onClick={() => {
                  if (window.confirm(`Delete section "${s.name}"?`)) {
                    deleteSection(s.key).then(onChanged).catch((err) => onError(err.message))
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 animate-fade-up rounded-2xl border border-border bg-card p-4" style={{ animationDelay: '160ms' }}>
        <h2 className="font-display text-base font-bold">Languages</h2>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          The global list templates and landing pages can use. A language in use by a landing page cannot be removed.
        </p>
        <div className="space-y-1.5">
          {langsDraft.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={l.code}
                onChange={(e) => setLangsDraft((d) => d.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
                className="h-8 w-20 text-xs"
                aria-label="Language code"
              />
              <Input
                value={l.label}
                onChange={(e) => setLangsDraft((d) => d.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className="h-8 flex-1 text-xs"
                aria-label="Language label"
              />
              <button
                type="button"
                onClick={() => setLangsDraft((d) => d.filter((_, j) => j !== i))}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                title="Remove language"
                aria-label={`Remove ${l.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setLangsDraft((d) => [...d, { code: '', label: '' }])}>
            <Plus className="h-3.5 w-3.5" /> Add language
          </Button>
          <Button
            size="sm"
            disabled={savingLangs}
            onClick={() => {
              setSavingLangs(true)
              putLanguages(langsDraft.filter((l) => l.code && l.label))
                .then(() => onChanged())
                .catch((e) => onError(e.message))
                .finally(() => setSavingLangs(false))
            }}
          >
            {savingLangs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save languages
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section editor — split code editors + live preview through the compositor
// ---------------------------------------------------------------------------
function SectionEditor({
  section,
  languages,
  onBack,
  onSaved,
  onError,
}: {
  section: SectionDef
  languages: Language[]
  onBack: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState(section.name)
  const [category, setCategory] = useState(section.category)
  const [html, setHtml] = useState(section.html)
  const [css, setCss] = useState(section.css)
  const [texts, setTexts] = useState<Record<string, Record<string, string>>>(section.texts)
  const [assets, setAssets] = useState<Record<string, string>>(section.assets)
  const [lang, setLang] = useState('en')
  const [device, setDevice] = useState<Device>('desktop')
  const [srcdoc, setSrcdoc] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  const fileRef = useRef<HTMLInputElement>(null)
  const [assetKey, setAssetKey] = useState('')

  const imgKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const m of html.matchAll(/data-lp-img="([A-Za-z0-9_.-]+)"/g)) keys.add(m[1])
    return [...keys]
  }, [html])
  const textKeys = useMemo(() => {
    const keys = new Set<string>(Object.keys(texts[lang] ?? {}))
    for (const m of html.matchAll(/data-lp-(?:text|rich)="([A-Za-z0-9_.-]+)"/g)) keys.add(m[1])
    // Repeat inner fields appear as key.N.field in defaults; keep en's keys too
    for (const k of Object.keys(texts.en ?? {})) keys.add(k)
    return [...keys].sort()
  }, [html, texts, lang])

  // live preview through the shared compositor (draft shadows the stored section)
  useEffect(() => {
    const t = window.setTimeout(() => {
      const fakeProject = {
        id: 'preview', name: 'Preview', brand_id: '', language: lang, campaign_id: '',
        sections: [{ iid: 'p1', template_key: section.key, texts: {}, images: {}, links: {}, repeats: {}, props: {} }],
        tokens: {}, form: { action_url: '', success_url: '' }, fonts: 'system',
        meta_title: '', meta_description: '', created_by: '', created_at: '', updated_at: '',
      } as unknown as Project
      composePage(fakeProject, 'preview', { key: section.key, name, category, html, css, texts, assets } as never)
        .then((h) => {
          setSrcdoc(h)
          setPreviewErr(null)
        })
        .catch((e) => setPreviewErr(e.message))
    }, 400)
    return () => window.clearTimeout(t)
  }, [html, css, texts, assets, lang, section.key, name, category])

  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const measure = () => setScale(Math.min(1, (el.clientWidth - 24) / DEVICE_WIDTH[device]))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device])

  function save() {
    setSaving(true)
    updateSection(section.key, { name, category, html, css, texts, assets })
      .then(onSaved)
      .catch((e) => onError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-2">
        <Button variant="ghost" size="icon" onClick={onBack} title="Back without saving" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56 text-sm font-semibold" aria-label="Section name" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" aria-label="Category">
          {['hero', 'content', 'social-proof', 'conversion', 'legal'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground">{section.key}</span>
        <span className="ml-auto inline-flex items-center rounded-lg border border-border bg-secondary p-0.5">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => {
            const Icon = d === 'desktop' ? Monitor : d === 'tablet' ? Tablet : Smartphone
            return (
              <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} title={`${DEVICE_WIDTH[d]}px`}
                      className={cn('rounded-md px-2 py-1 transition-colors', device === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" aria-label="Preview language">
          {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* code + texts */}
        <div className="flex w-1/2 min-w-0 flex-col border-r border-border">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">HTML (data-lp-* slots)</p>
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} rows={14} spellCheck={false}
                      className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-[11px] leading-relaxed focus-visible:border-primary focus-visible:outline-none"
                      aria-label="Section HTML" />
            <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">CSS</p>
            <textarea value={css} onChange={(e) => setCss(e.target.value)} rows={10} spellCheck={false}
                      className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-[11px] leading-relaxed focus-visible:border-primary focus-visible:outline-none"
                      aria-label="Section CSS" />

            <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Default texts — {languages.find((l) => l.code === lang)?.label ?? lang}
            </p>
            <div className="space-y-1.5">
              {textKeys.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-[10px] text-muted-foreground" title={k}>{k}</span>
                  <input
                    value={texts[lang]?.[k] ?? ''}
                    placeholder={texts.en?.[k] ? `en: ${texts.en[k].slice(0, 40)}` : '—'}
                    onChange={(e) =>
                      setTexts((t) => ({ ...t, [lang]: { ...(t[lang] ?? {}), [k]: e.target.value } }))
                    }
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
                    aria-label={`Default text ${k}`}
                  />
                </div>
              ))}
            </div>

            {imgKeys.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Attached materials</p>
                <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Upload material"
                       onChange={(e) => {
                         const f = e.target.files?.[0]
                         e.target.value = ''
                         if (!f || !assetKey) return
                         uploadLpAsset(f)
                           .then((up) => setAssets((a) => ({ ...a, [assetKey]: up.url })))
                           .catch((err) => onError(err.message))
                       }} />
                <div className="space-y-1.5">
                  {imgKeys.map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 truncate text-[10px] text-muted-foreground">{k}</span>
                      {assets[k] ? (
                        <img src={assets[k]} alt="" className="h-8 w-12 rounded border border-border object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground/70">placeholder</span>
                      )}
                      <Button variant="outline" size="sm" className="ml-auto h-7 text-xs"
                              onClick={() => { setAssetKey(k); fileRef.current?.click() }}>
                        <Upload className="h-3 w-3" /> Set
                      </Button>
                      {assets[k] && (
                        <button type="button" onClick={() => setAssets((a) => { const n = { ...a }; delete n[k]; return n })}
                                className="rounded p-1 text-muted-foreground hover:text-destructive" title="Clear" aria-label={`Clear ${k}`}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* live preview */}
        <div ref={previewRef} className="min-w-0 flex-1 overflow-auto bg-secondary/40 p-3">
          {previewErr && (
            <p className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">{previewErr}</p>
          )}
          <div style={{ width: DEVICE_WIDTH[device] * scale }} className="mx-auto">
            <div style={{ width: DEVICE_WIDTH[device], height: 900 / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                 className="overflow-hidden rounded-lg border border-border bg-white shadow-xl">
              <iframe title="Section preview" srcDoc={srcdoc} className="h-full w-full border-0" sandbox="allow-same-origin" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Campaign editor — fields on the left, live composed email on the right.
//
// The preview is the REAL composed output from the backend compositor, not a
// frontend approximation. Same rule the LP builder follows: an approximation is
// the version you trust and the composed one is the version that ships, and
// they drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Check, Image as ImageIcon, Loader2, Monitor,
  Smartphone, Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { flagUrl } from '@/lib/flags'
import type { Language } from '@/lpBuilder/api'
import type { Brand } from '@/bannerBuilder/brandsApi'
import {
  SIZE_LIMIT, SIZE_WARN, composeEmail, saveCampaign, uploadEmailAsset,
  type BlockDef, type BlockInstance, type Campaign,
} from './api'

/** Slot label: the block's own name for the key, else the key humanised. */
function labelFor(block: BlockDef, key: string): string {
  const named = block.names?.[key]
  if (named) return named
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function Editor({
  campaign: initial,
  blocks,
  brands,
  languages,
  onBack,
  onError,
}: {
  campaign: Campaign
  blocks: BlockDef[]
  brands: Brand[]
  languages: Language[]
  onBack: () => void
  onError: (m: string) => void
}) {
  const [campaign, setCampaign] = useState<Campaign>(initial)
  const [composed, setComposed] = useState<{ html: string; size: number; warnings: string[] } | null>(null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const blockMap = useMemo(
    () => Object.fromEntries(blocks.map((b) => [b.key, b])) as Record<string, BlockDef>,
    [blocks],
  )

  const mutate = (fn: (c: Campaign) => Campaign) => {
    setCampaign((cur) => fn(structuredClone(cur)))
    setDirty(true)
  }

  // Compose is debounced: it is a network round trip on every keystroke
  // otherwise, and the preview only needs to settle, not track each character.
  const composeTimer = useRef<number | null>(null)
  useEffect(() => {
    if (composeTimer.current) window.clearTimeout(composeTimer.current)
    composeTimer.current = window.setTimeout(() => {
      composeEmail(campaign)
        .then((r) => setComposed({ html: r.html, size: r.size_bytes, warnings: r.warnings }))
        .catch((e) => onError(e.message))
    }, 350)
    return () => {
      if (composeTimer.current) window.clearTimeout(composeTimer.current)
    }
  }, [campaign, onError])

  const save = useCallback(() => {
    setSaving(true)
    saveCampaign(campaign)
      .then((c) => {
        setCampaign(c)
        setDirty(false)
      })
      .catch((e) => onError(e.message))
      .finally(() => setSaving(false))
  }, [campaign, onError])

  // Autosave a couple of seconds after the last edit — the LP builder does the
  // same, and a campaign lost to a closed tab is a bad way to learn about it.
  useEffect(() => {
    if (!dirty) return
    const t = window.setTimeout(save, 1500)
    return () => window.clearTimeout(t)
  }, [dirty, save])

  const setField = (iid: string, bucket: 'texts' | 'images' | 'links', key: string, value: string) =>
    mutate((c) => {
      const inst = c.sections.find((s) => s.iid === iid)
      if (inst) inst[bucket] = { ...inst[bucket], [key]: value }
      return c
    })

  const sizePct = composed ? Math.min(100, (composed.size / SIZE_LIMIT) * 100) : 0
  const sizeState = !composed ? 'ok'
    : composed.size > SIZE_LIMIT ? 'over'
    : composed.size > SIZE_WARN ? 'near' : 'ok'

  return (
    <div className="flex h-full flex-col">
      {/* ---------------------------------------------------------- top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="ghost" size="icon" onClick={onBack} title="Back" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={campaign.name}
          onChange={(e) => mutate((c) => ({ ...c, name: e.target.value }))}
          className="h-8 w-56 text-sm font-medium"
          aria-label="Campaign name"
        />
        <span className="flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1 text-xs">
          {flagUrl(campaign.language) && (
            <img src={flagUrl(campaign.language)!} alt="" className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
          )}
          <select
            value={campaign.language}
            onChange={(e) => mutate((c) => ({ ...c, language: e.target.value }))}
            className="bg-transparent text-xs outline-none"
            aria-label="Language"
          >
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </span>
        <select
          value={campaign.brand_id}
          onChange={(e) => mutate((c) => ({ ...c, brand_id: e.target.value }))}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
          aria-label="Brand"
        >
          <option value="">No brand</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* Live size against Gmail's clip limit — the constraint people
              forget until an email arrives truncated. */}
          {composed && (
            <span
              className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] tabular-nums',
                sizeState === 'over' ? 'bg-destructive/10 text-destructive'
                  : sizeState === 'near' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground')}
              title={`${composed.size.toLocaleString()} bytes of a ~102,000 byte Gmail clip limit`}
            >
              <span className="h-1 w-10 overflow-hidden rounded-full bg-border">
                <span
                  className={cn('block h-full rounded-full',
                    sizeState === 'over' ? 'bg-destructive'
                      : sizeState === 'near' ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${sizePct}%` }}
                />
              </span>
              {Math.round(composed.size / 1024)}KB
            </span>
          )}
          <div className="flex items-center rounded-lg border border-border bg-secondary p-0.5">
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                title={`${d === 'desktop' ? 'Desktop' : 'Mobile'} preview`}
                className={cn('rounded-md px-2 py-1 transition-colors',
                  device === d ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <span className="flex w-16 items-center gap-1 text-xs text-muted-foreground">
            {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving</>
              : dirty ? '—' : <><Check className="h-3 w-3" /> Saved</>}
          </span>
        </div>
      </div>

      {/* --------------------------------------------------------- warnings */}
      {composed && composed.warnings.length > 0 && (
        <div className="shrink-0 border-b border-border bg-amber-500/5 px-4 py-2">
          {composed.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------- fields */}
        <div className="w-[340px] shrink-0 overflow-y-auto border-r border-border p-3">
          <div className="mb-4 space-y-2">
            <div>
              <Label htmlFor="em-subject" className="text-xs">Subject line</Label>
              <Input
                id="em-subject"
                value={campaign.subject}
                onChange={(e) => mutate((c) => ({ ...c, subject: e.target.value }))}
                className="mt-1 h-8 text-sm"
                placeholder="What lands in the inbox"
              />
            </div>
            <div>
              <Label htmlFor="em-pre" className="text-xs">Preheader</Label>
              <Input
                id="em-pre"
                value={campaign.preheader}
                onChange={(e) => mutate((c) => ({ ...c, preheader: e.target.value }))}
                className="mt-1 h-8 text-sm"
                placeholder="The grey line after the subject"
              />
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                Hidden in the email body; most clients show it beside the subject.
              </p>
            </div>
          </div>

          {campaign.sections.map((inst) => {
            const block = blockMap[inst.block_key]
            if (!block) return null
            return (
              <BlockFields
                key={inst.iid}
                block={block}
                inst={inst}
                onText={(k, v) => setField(inst.iid, 'texts', k, v)}
                onLink={(k, v) => setField(inst.iid, 'links', k, v)}
                onImage={(k, v) => setField(inst.iid, 'images', k, v)}
                onError={onError}
              />
            )
          })}
        </div>

        {/* ------------------------------------------------------ preview */}
        <div className="flex min-w-0 flex-1 justify-center overflow-y-auto bg-secondary/40 p-6">
          {composed ? (
            <iframe
              // srcDoc, not a URL: the composed HTML is already complete and
              // self-contained, and this keeps the preview free of our app's
              // stylesheet bleeding in.
              srcDoc={composed.html}
              title="Email preview"
              className="h-full border-0 bg-white shadow-sm"
              style={{ width: device === 'mobile' ? 375 : 680 }}
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex items-center gap-2 self-start pt-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Composing…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BlockFields({
  block, inst, onText, onLink, onImage, onError,
}: {
  block: BlockDef
  inst: BlockInstance
  onText: (k: string, v: string) => void
  onLink: (k: string, v: string) => void
  onImage: (k: string, v: string) => void
  onError: (m: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const defaults = block.texts?.en ?? {}

  // The footer's risk warning is filled by the backend from the entity's
  // regulation, so offering an input here would imply it is editable when the
  // compositor overwrites it.
  const derived = new Set(block.key === 'em-footer' ? ['risk_warning'] : [])

  const pick = (key: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy(key)
      uploadEmailAsset(file)
        .then((a) => onImage(key, a.id))
        .catch((e) => onError(e.message))
        .finally(() => setBusy(null))
    }
    input.click()
  }

  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-2.5">
      <p className="mb-2 font-display text-xs font-semibold">{block.name}</p>
      <div className="space-y-2">
        {block.fields.map((f) => {
          const id = `${inst.iid}-${f.key}`
          const label = labelFor(block, f.key)

          if (derived.has(f.key)) {
            return (
              <div key={f.key}>
                <Label className="text-[11px]">{label}</Label>
                <p className="mt-1 rounded-lg bg-secondary px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  Set automatically from the brand's regulation (EU or International).
                </p>
              </div>
            )
          }

          if (f.kind === 'img') {
            const val = inst.images?.[f.key] ?? ''
            return (
              <div key={f.key}>
                <Label className="text-[11px]">{label}</Label>
                <button
                  type="button"
                  onClick={() => pick(f.key)}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  {busy === f.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : val ? <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
                    : <Upload className="h-3.5 w-3.5" />}
                  <span className="truncate">{val ? 'Replace image' : 'Upload image'}</span>
                </button>
              </div>
            )
          }

          if (f.kind === 'link') {
            return (
              <div key={f.key}>
                <Label htmlFor={id} className="text-[11px]">{label}</Label>
                <Input
                  id={id}
                  value={inst.links?.[f.key] ?? ''}
                  onChange={(e) => onLink(f.key, e.target.value)}
                  className="mt-1 h-8 text-xs"
                  placeholder="https://…"
                />
              </div>
            )
          }

          const value = inst.texts?.[f.key] ?? defaults[f.key] ?? ''
          return (
            <div key={f.key}>
              <Label htmlFor={id} className="text-[11px]">{label}</Label>
              {f.kind === 'rich' ? (
                <Textarea
                  id={id}
                  value={value}
                  onChange={(e) => onText(f.key, e.target.value)}
                  rows={4}
                  className="mt-1 text-xs"
                />
              ) : (
                <Input
                  id={id}
                  value={value}
                  onChange={(e) => onText(f.key, e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

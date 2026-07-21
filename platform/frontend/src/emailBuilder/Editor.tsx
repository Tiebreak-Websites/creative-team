// Campaign editor — structure panel on the left, live composed email right.
//
// The panel follows the shape every major builder (Klaviyo, Stripo, Beefree,
// MailerLite) converged on: a list of the email's blocks in order, one open at
// a time, with move/duplicate/remove on each row and an Add picker. What we
// deliberately DON'T copy is their free-form drag-anything canvas — our blocks
// are locked Outlook-safe tables, and that constraint is the product: you
// cannot build an email here that breaks in Outlook.
//
// The preview is the REAL composed output from the backend compositor, not a
// frontend approximation. Same rule the LP builder follows: an approximation is
// the version you trust and the composed one is the version that ships, and
// they drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, Copy,
  Image as ImageIcon, Loader2, Monitor, Plus, Smartphone, Upload, X,
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

const newIid = () => Math.random().toString(16).slice(2, 10)

/** Display order of the three zones — mirrors how the compositor stacks them. */
const ZONE_ORDER: Record<string, number> = { header: 0, card: 1, footer: 2 }
const ZONE_LABEL: Record<string, string> = { header: 'Header', card: 'Content', footer: 'Footer' }

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
  /** The one expanded block — an accordion, so the panel stays scannable with
   *  eleven blocks instead of eleven stacked forms. */
  const [openIid, setOpenIid] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const blockMap = useMemo(
    () => Object.fromEntries(blocks.map((b) => [b.key, b])) as Record<string, BlockDef>,
    [blocks],
  )
  const zoneOf = useCallback(
    (inst: BlockInstance) => blockMap[inst.block_key]?.zone ?? 'card',
    [blockMap],
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

  // Opening a block scrolls the preview to it — the panel and the email stay
  // one thing. Re-runs when a fresh compose lands so the scroll survives the
  // iframe being re-rendered.
  useEffect(() => {
    if (!openIid) return
    const doc = frameRef.current?.contentDocument
    const el = doc?.querySelector(`[data-em-iid="${openIid}"]`)
    if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [openIid, composed])

  const setField = (iid: string, bucket: 'texts' | 'images' | 'links', key: string, value: string) =>
    mutate((c) => {
      const inst = c.sections.find((s) => s.iid === iid)
      if (inst) inst[bucket] = { ...inst[bucket], [key]: value }
      return c
    })

  /** Swap with the nearest neighbour IN THE SAME ZONE. Crossing a zone would
   *  claim an order the compositor cannot render (zones are separate tables),
   *  so the arrows simply stop at the zone edge. */
  const move = (iid: string, dir: -1 | 1) =>
    mutate((c) => {
      const arr = c.sections
      const i = arr.findIndex((s) => s.iid === iid)
      if (i === -1) return c
      const zone = zoneOf(arr[i])
      let j = i + dir
      while (j >= 0 && j < arr.length && zoneOf(arr[j]) !== zone) j += dir
      if (j < 0 || j >= arr.length) return c
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return c
    })

  const duplicate = (iid: string) => {
    const copyIid = newIid()
    mutate((c) => {
      const i = c.sections.findIndex((s) => s.iid === iid)
      if (i === -1) return c
      const copy = structuredClone(c.sections[i])
      copy.iid = copyIid
      c.sections.splice(i + 1, 0, copy)
      return c
    })
    setOpenIid(copyIid)
  }

  const remove = (iid: string) => {
    const inst = campaign.sections.find((s) => s.iid === iid)
    const name = blockMap[inst?.block_key ?? '']?.name ?? 'this block'
    if (!window.confirm(`Remove ${name}? Its text is lost.`)) return
    mutate((c) => ({ ...c, sections: c.sections.filter((s) => s.iid !== iid) }))
    if (openIid === iid) setOpenIid(null)
  }

  /** Insert at the end of the block's own zone segment, so a new card block
   *  lands above the footer no matter what. */
  const addBlock = (key: string) => {
    const iid = newIid()
    mutate((c) => {
      const zone = blockMap[key]?.zone ?? 'card'
      const inst: BlockInstance = { iid, block_key: key, texts: {}, images: {}, links: {} }
      let at = -1
      c.sections.forEach((s, i) => {
        if (ZONE_ORDER[zoneOf(s)] <= ZONE_ORDER[zone]) at = i
      })
      c.sections.splice(at + 1, 0, inst)
      return c
    })
    setAdding(false)
    setOpenIid(iid)
  }

  // Zone bounds per row, so the arrows can disable at the edges.
  const zoneMates = (iid: string) => {
    const inst = campaign.sections.find((s) => s.iid === iid)
    if (!inst) return { first: true, last: true }
    const mates = campaign.sections.filter((s) => zoneOf(s) === zoneOf(inst))
    const i = mates.findIndex((s) => s.iid === iid)
    return { first: i === 0, last: i === mates.length - 1 }
  }

  const sizePct = composed ? Math.min(100, (composed.size / SIZE_LIMIT) * 100) : 0
  const sizeState = !composed ? 'ok'
    : composed.size > SIZE_LIMIT ? 'over'
    : composed.size > SIZE_WARN ? 'near' : 'ok'

  // The panel renders in zone order regardless of array quirks, with one
  // heading per zone — the same three regions the composed email has.
  const grouped = useMemo(() => {
    const out: { zone: string; items: BlockInstance[] }[] = []
    for (const zone of ['header', 'card', 'footer']) {
      const items = campaign.sections.filter((s) => zoneOf(s) === zone)
      if (items.length) out.push({ zone, items })
    }
    return out
  }, [campaign.sections, zoneOf])

  // Only card-zone blocks are offered by Add: the logo and the compliance
  // footer are furniture, and a second footer is a compliance bug waiting.
  const addable = blocks.filter((b) => b.enabled && b.zone === 'card')

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
        {/* Brand and language are facts of the campaign, not knobs: both are
            chosen at creation and a variant IS its language, so a mid-edit
            switcher only invites accidents. Shown, not selectable. */}
        <span className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground">
          {flagUrl(campaign.language) && (
            <img src={flagUrl(campaign.language)!} alt="" className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
          )}
          {languages.find((l) => l.code === campaign.language)?.label ?? campaign.language.toUpperCase()}
        </span>
        {campaign.brand_id && (
          <span className="rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground">
            {brands.find((b) => b.id === campaign.brand_id)?.name ?? campaign.brand_id}
          </span>
        )}

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
        {/* ---------------------------------------------- structure panel */}
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

          {grouped.map(({ zone, items }) => (
            <div key={zone} className="mb-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {ZONE_LABEL[zone]}
                </p>
                {zone === 'card' && (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                  >
                    <Plus className="h-3 w-3" /> Add block
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {items.map((inst) => {
                  const block = blockMap[inst.block_key]
                  if (!block) return null
                  const open = openIid === inst.iid
                  const { first, last } = zoneMates(inst.iid)
                  const canReorder = items.length > 1
                  return (
                    <div
                      key={inst.iid}
                      className={cn(
                        'rounded-xl border bg-card transition-colors',
                        open ? 'border-primary/50 shadow-sm' : 'border-border',
                      )}
                    >
                      {/* row header: name + actions, click to open */}
                      <div className="group flex items-center gap-0.5 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenIid(open ? null : inst.iid)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          aria-expanded={open}
                        >
                          <ChevronDown
                            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                              !open && '-rotate-90')}
                          />
                          <span className="truncate font-display text-xs font-semibold">{block.name}</span>
                        </button>
                        <span className={cn('flex shrink-0 items-center transition-opacity',
                          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                          {canReorder && (
                            <>
                              <RowAction title="Move up" disabled={first} onClick={() => move(inst.iid, -1)}>
                                <ChevronUp className="h-3.5 w-3.5" />
                              </RowAction>
                              <RowAction title="Move down" disabled={last} onClick={() => move(inst.iid, 1)}>
                                <ChevronDown className="h-3.5 w-3.5" />
                              </RowAction>
                            </>
                          )}
                          {/* The compliance footer can be neither removed nor
                              duplicated: no unsubscribe link is a spam
                              complaint, and two of them is a mess — neither is
                              a design choice. */}
                          {block.key !== 'em-footer' && (
                            <RowAction title={`Duplicate ${block.name}`} onClick={() => duplicate(inst.iid)}>
                              <Copy className="h-3 w-3" />
                            </RowAction>
                          )}
                          {block.key !== 'em-footer' && (
                            <RowAction title={`Remove ${block.name}`} onClick={() => remove(inst.iid)}>
                              <X className="h-3.5 w-3.5" />
                            </RowAction>
                          )}
                        </span>
                      </div>

                      {open && (
                        <div className="border-t border-border px-2.5 pb-2.5 pt-2">
                          <BlockFields
                            block={block}
                            inst={inst}
                            onText={(k, v) => setField(inst.iid, 'texts', k, v)}
                            onLink={(k, v) => setField(inst.iid, 'links', k, v)}
                            onImage={(k, v) => setField(inst.iid, 'images', k, v)}
                            onError={onError}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ------------------------------------------------------ preview */}
        <div className="flex min-w-0 flex-1 justify-center overflow-y-auto bg-secondary/40 p-6">
          {composed ? (
            <iframe
              ref={frameRef}
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

      {/* ------------------------------------------------- add-block picker */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdding(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-base font-bold">Add a block</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Added at the end of the content — move it with the arrows.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {addable.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => addBlock(b.key)}
                  className="rounded-lg border border-border px-2.5 py-2 text-left text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RowAction({
  title, disabled, onClick, children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md p-1 text-muted-foreground transition-colors',
        disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
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
  )
}

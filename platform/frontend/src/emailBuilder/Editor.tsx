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
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, Copy, GripVertical,
  Image as ImageIcon, Link2, Loader2, Monitor, Moon, PenLine, Plus, Smartphone,
  Sparkles, Sun, Upload, X,
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
  SIZE_LIMIT, SIZE_WARN, composeEmail, generateCopy, generateHeroImage, getCopyJob,
  getHeroJob, imageBriefFromContent, listCopyJobs, listHeroJobs, saveCampaign,
  uploadEmailAsset,
  type BlockDef, type BlockInstance, type Campaign, type CopyResult,
} from './api'

/** Slot label: the block's own name for the key, else the key humanised. */
function labelFor(block: BlockDef, key: string): string {
  const named = block.names?.[key]
  if (named) return named
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

const newIid = () => Math.random().toString(16).slice(2, 10)

/** Wrap the composed email in a dark-mode viewing lens.

 * What it simulates is FORCED inversion — the Gmail app's behaviour, which
 * recolours emails whether or not they define dark styles. (Apple Mail merely
 * honours `prefers-color-scheme`, and since our emails define no dark styles
 * it would show no change at all — a useless preview.) invert+hue-rotate is
 * the standard simulator trick: colours flip to a dark scheme while hues stay
 * recognisable, and images get the same filter again to cancel it, since
 * clients never invert photos.
 *
 * Injected ONLY at display time. The composed artifact never contains it. */
function darkLens(html: string): string {
  const lens =
    '<style id="em-dark-sim">' +
    'html{filter:invert(1) hue-rotate(180deg);background:#111}' +
    'img{filter:invert(1) hue-rotate(180deg)}' +
    // The same swap the email's own prefers-color-scheme rule performs in
    // dark clients — the moon shows the dark wordmark when Settings has one.
    '.em-logo-light{display:none!important}' +
    '.em-logo-dark{display:block!important}' +
    '</style>'
  return html.includes('</head>') ? html.replace('</head>', lens + '</head>') : lens + html
}

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
  const [scheme, setScheme] = useState<'light' | 'dark'>('light')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** The one expanded block — an accordion, so the panel stays scannable with
   *  eleven blocks instead of eleven stacked forms. */
  const [openIid, setOpenIid] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // HTML5 drag state: what is being dragged, and which row it hovers.
  const [dragIid, setDragIid] = useState<string | null>(null)
  const [overIid, setOverIid] = useState<string | null>(null)
  // AI copy: the brief is lifted here so the hero generator can inherit it
  // (the "approved content -> image" chain), and the subject A/B variants the
  // last generation produced, offered as one-click swaps under the subject.
  const [copyBrief, setCopyBrief] = useState('')
  const [subjectVariants, setSubjectVariants] = useState<string[]>([])
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

  /** Apply generated copy locally. The server already wrote it into the
   *  campaign; mirroring it here keeps this page (and its next autosave)
   *  convergent with the server, exactly as the hero job does. */
  const applyCopy = (r: CopyResult) => {
    mutate((c) => {
      if (r.subjects[0]) c.subject = r.subjects[0]
      if (r.preheader) c.preheader = r.preheader
      // The hero-image brief the copywriter derived from what it just wrote —
      // the image generator seeds from this.
      if (r.image_brief) c.image_brief = r.image_brief
      const byIid = new Map<string, Record<string, string>>()
      for (const it of r.items) {
        const m = byIid.get(it.iid) ?? {}
        m[it.key] = it.value
        byIid.set(it.iid, m)
      }
      for (const s of c.sections) {
        const fields = byIid.get(s.iid)
        if (fields) s.texts = { ...s.texts, ...fields }
      }
      return c
    })
    setSubjectVariants(r.subjects)
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

  const setProp = (iid: string, key: 'pad_top' | 'pad_bottom', value: string) =>
    mutate((c) => {
      const inst = c.sections.find((s) => s.iid === iid)
      if (!inst) return c
      const props = { ...(inst.props ?? {}) }
      if (!value.trim()) delete props[key]
      else props[key] = value.trim()
      inst.props = props
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

  /** Drop `dragIid` at `targetIid`'s position — same-zone only, like the
   *  arrows: zones are separate tables and cannot interleave. */
  const dropOn = (targetIid: string, srcIid: string) => {
    const src = srcIid || dragIid
    setDragIid(null)
    setOverIid(null)
    if (!src || src === targetIid) return
    mutate((c) => {
      const arr = c.sections
      const from = arr.findIndex((s) => s.iid === src)
      const to = arr.findIndex((s) => s.iid === targetIid)
      if (from === -1 || to === -1 || zoneOf(arr[from]) !== zoneOf(arr[to])) return c
      const [moved] = arr.splice(from, 1)
      const at = arr.findIndex((s) => s.iid === targetIid)
      arr.splice(from < to ? at + 1 : at, 0, moved)
      return c
    })
  }

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
      const inst: BlockInstance = { iid, block_key: key, texts: {}, images: {}, links: {}, props: {} }
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
        {campaign.monday_id && (
          <a
            href={campaign.monday?.url || `https://tiebreak.monday.com/pulses/${campaign.monday_id}`}
            target="_blank" rel="noreferrer"
            title={campaign.monday?.name
              ? `Monday: ${campaign.monday.name}${campaign.monday.status ? ` — ${campaign.monday.status}` : ''}`
              : 'Open the linked Monday task'}
            className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />
            <span className="tabular-nums">M#{campaign.monday_id}</span>
          </a>
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
            {([['light', Sun], ['dark', Moon]] as const).map(([m, Icon]) => (
              <button
                key={m}
                type="button"
                onClick={() => setScheme(m)}
                aria-pressed={scheme === m}
                title={m === 'light' ? 'Light preview'
                  : 'Dark preview — simulates the Gmail app forcing its own dark scheme'}
                className={cn('rounded-md px-2 py-1 transition-colors',
                  scheme === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
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
          {/* Brief -> house copywriter -> the whole email's copy. Sits at the
              top because it is where a campaign starts; the hero generator
              chains off the copy it produces. */}
          <CopyGenerator
            campaignId={campaign.id}
            brand={brands.find((b) => b.id === campaign.brand_id)}
            brief={copyBrief}
            initialGreeting={campaign.greeting ?? true}
            onBrief={setCopyBrief}
            onDone={applyCopy}
            onError={onError}
          />

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
              {/* A/B subject variants the last generation produced — click to
                  swap the live subject. Dismisses once none differ. */}
              {subjectVariants.filter((s) => s !== campaign.subject).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {subjectVariants
                    .filter((s) => s !== campaign.subject)
                    .map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        title={`Use: ${s}`}
                        onClick={() => mutate((c) => ({ ...c, subject: s }))}
                        className="max-w-full truncate rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
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
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes('application/x-em-block')) return
                        e.preventDefault()
                        setOverIid(inst.iid)
                      }}
                      onDragLeave={() => setOverIid((cur) => (cur === inst.iid ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault()
                        dropOn(inst.iid, e.dataTransfer.getData('application/x-em-block'))
                      }}
                      className={cn(
                        'rounded-xl border bg-card transition-colors',
                        open ? 'border-primary/50 shadow-sm' : 'border-border',
                        dragIid === inst.iid && 'opacity-40',
                        overIid === inst.iid && dragIid !== inst.iid && 'border-primary ring-1 ring-primary/40',
                      )}
                    >
                      {/* row header: name + actions, click to open */}
                      <div className="group flex items-center gap-0.5 px-2 py-1.5">
                        {canReorder && (
                          <span
                            draggable
                            onDragStart={(e) => {
                              setDragIid(inst.iid)
                              e.dataTransfer.effectAllowed = 'move'
                              e.dataTransfer.setData('application/x-em-block', inst.iid)
                              // Firefox refuses to start a drag with no text data.
                              e.dataTransfer.setData('text/plain', inst.iid)
                            }}
                            onDragEnd={() => { setDragIid(null); setOverIid(null) }}
                            title="Drag to reorder"
                            className="cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        )}
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
                            ai={{
                              brandId: campaign.brand_id,
                              campaignId: campaign.id,
                              headline: (() => {
                                const h = campaign.sections.find((x) => x.block_key === 'em-headline')
                                return h?.texts?.headline
                                  ?? blockMap['em-headline']?.texts?.en?.headline ?? ''
                              })(),
                              // The hero brief chains off the approved copy:
                              // the image_brief the copywriter derived from the
                              // content, else the copy brief, else the Monday
                              // brief. Either way the image starts from what the
                              // email is actually about.
                              brief: campaign.image_brief || copyBrief
                                || campaign.monday?.brief || '',
                            }}
                            onText={(k, v) => setField(inst.iid, 'texts', k, v)}
                            onLink={(k, v) => setField(inst.iid, 'links', k, v)}
                            onImage={(k, v) => setField(inst.iid, 'images', k, v)}
                            onError={onError}
                          />
                          {/* Every block exposes its outer spacing — the one
                              layout property reordering actually needs. */}
                          <div className={cn('border-border', block.fields.length > 0 && 'mt-2.5 border-t pt-2')}>
                            <Label className="text-[11px]">Spacing (px)</Label>
                            <div className="mt-1 flex items-center gap-2">
                              <Input
                                type="number" min={0} max={120} placeholder="top"
                                aria-label={`${block.name} top spacing`}
                                value={inst.props?.pad_top ?? ''}
                                onChange={(e) => setProp(inst.iid, 'pad_top', e.target.value)}
                                className="h-8 w-20 text-xs"
                              />
                              <Input
                                type="number" min={0} max={120} placeholder="bottom"
                                aria-label={`${block.name} bottom spacing`}
                                value={inst.props?.pad_bottom ?? ''}
                                onChange={(e) => setProp(inst.iid, 'pad_bottom', e.target.value)}
                                className="h-8 w-20 text-xs"
                              />
                            </div>
                            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                              Empty = the block's own spacing.
                            </p>
                          </div>
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
              srcDoc={scheme === 'dark' ? darkLens(composed.html) : composed.html}
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
  block, inst, ai, onText, onLink, onImage, onError,
}: {
  block: BlockDef
  inst: BlockInstance
  /** Context the AI hero generator needs: which brand styles it, the campaign
   *  and block identity for the background job, and the campaign's current
   *  headline as the with-text default. */
  ai: { brandId: string; campaignId: string; headline: string; brief?: string }
  onText: (k: string, v: string) => void
  onLink: (k: string, v: string) => void
  onImage: (k: string, v: string) => void
  onError: (m: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const defaults = block.texts?.en ?? {}

  // The logo is not editable per campaign — it comes from Settings > Brands,
  // so every email a brand sends carries the same, current mark. Offering an
  // upload here would quietly fork a campaign off the brand.
  if (block.key === 'em-logo-header') {
    return (
      <p className="rounded-lg bg-secondary px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        The logo comes from Settings › Brands and updates here automatically when
        it changes there.
      </p>
    )
  }

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
              {f.key === 'hero' && (
                <HeroGenerator ai={ai} iid={inst.iid} onDone={(v) => onImage(f.key, v)} onError={onError} />
              )}
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


/** AI copy generation — brief in, the whole email's copy out, written by the
 *  house CRM copywriter (crm_copywriter.md) into the campaign's actual blocks.
 *  The compliance segment is pre-set from the brand's regulation so a bonus can
 *  never be written for an EU audience. Runs as a background job that survives
 *  refresh, same as the hero generator. */
type Segment = 'REG' | 'NONREG' | 'NONE'

const SEGMENT_OPTS: { value: Segment; label: string }[] = [
  { value: 'REG', label: 'EU / regulated — discounts only' },
  { value: 'NONREG', label: 'Non-EU — bonuses allowed' },
  { value: 'NONE', label: 'No specific offer' },
]

function defaultSegment(brand?: Brand): Segment {
  const reg = (brand as { regulation?: string } | undefined)?.regulation
  return reg === 'eu' ? 'REG' : reg === 'international' ? 'NONREG' : 'NONE'
}

function CopyGenerator({
  campaignId, brand, brief, initialGreeting = true, onBrief, onDone, onError,
}: {
  campaignId: string
  brand?: Brand
  brief: string
  initialGreeting?: boolean
  onBrief: (v: string) => void
  onDone: (r: CopyResult) => void
  onError: (m: string) => void
}) {
  const [segment, setSegment] = useState<Segment>(() => defaultSegment(brand))
  const [tier, setTier] = useState<'Retail' | 'Pro'>('Retail')
  const [greeting, setGreeting] = useState(initialGreeting)
  const [open, setOpen] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const busy = jobId !== null

  // The brand loads/changes after mount — keep the segment default in sync
  // until the user has opened the panel to choose for themselves.
  useEffect(() => {
    if (!open) setSegment(defaultSegment(brand))
  }, [brand, open])

  // Adopt a copy generation a previous page left running.
  useEffect(() => {
    let gone = false
    listCopyJobs(campaignId)
      .then((js) => {
        const running = js.find((jb) => jb.status === 'running')
        if (running && !gone) { setJobId(running.id); setOpen(true) }
      })
      .catch(() => { /* nothing to adopt */ })
    return () => { gone = true }
  }, [campaignId])

  // Poll while a job runs; apply its result exactly once.
  useEffect(() => {
    if (!jobId) return
    let gone = false
    const tick = () =>
      getCopyJob(jobId)
        .then((jb) => {
          if (gone) return
          if (jb.status === 'running') return
          setJobId(null)
          if (jb.status === 'done' && jb.result) onDone(jb.result)
          else if (jb.status === 'failed') onError(jb.error || 'Copy generation failed.')
        })
        .catch(() => { /* transient poll miss — next tick retries */ })
    tick()
    const t = window.setInterval(tick, 2000)
    return () => { gone = true; window.clearInterval(t) }
  }, [jobId])

  const run = () => {
    generateCopy({ campaign_id: campaignId, brief: brief.trim(), segment, tier, greeting })
      .then((jb) => setJobId(jb.id))
      .catch((e) => onError(e.message))
  }

  return (
    <div className="mb-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        <PenLine className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Write copy with AI</span>
        {busy
          ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-primary" />
          : (open ? <ChevronUp className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />)}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={brief}
            onChange={(e) => onBrief(e.target.value)}
            rows={3}
            className="text-xs"
            placeholder="The brief: what's the campaign? e.g. Nonfarm Payrolls this Friday — educate on why the jobs report moves markets, invite them to trade the volatility."
            aria-label="Copy brief"
          />

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Offer type (compliance)
            </label>
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
              className="mt-0.5 h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              aria-label="Compliance segment"
            >
              {SEGMENT_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              {brand
                ? `Preset from ${brand.name}'s regulation. `
                : 'No brand set. '}
              EU audiences may only be offered discounts, never bonuses.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Tier
            </span>
            <span className="flex items-center rounded-md border border-border bg-card p-0.5">
              {(['Retail', 'Pro'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  aria-pressed={tier === t}
                  className={cn('rounded px-2 py-0.5 text-[10px] transition-colors',
                    tier === t ? 'bg-secondary font-medium text-foreground'
                               : 'text-muted-foreground hover:text-foreground')}
                >
                  {t}
                </button>
              ))}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Greeting
            </span>
            <span className="flex items-center rounded-md border border-border bg-card p-0.5">
              {([['Include', true], ['Skip', false]] as const).map(([lbl, on]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => setGreeting(on)}
                  aria-pressed={greeting === on}
                  className={cn('rounded px-2 py-0.5 text-[10px] transition-colors',
                    greeting === on ? 'bg-secondary font-medium text-foreground'
                                    : 'text-muted-foreground hover:text-foreground')}
                >
                  {lbl}
                </button>
              ))}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {greeting
                ? <>opens with <span className="font-mono">{'Hi {{firstName}},'}</span></>
                : 'starts straight on the hook'}
            </span>
          </div>

          <Button size="sm" className="w-full" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
            {busy ? 'Writing…' : 'Generate copy'}
          </Button>

          {busy && (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Writing on the server — you can navigate away or refresh; the copy
              lands in the blocks when ready.
            </p>
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            Fills the subject, preheader and every text block for this layout.
            Review and edit inline, then generate the hero image from it.
          </p>
        </div>
      )}
    </div>
  )
}


/** The AI hero generator — the banner engine's shape scaled to one image:
 *  a brief, a with/without-text switch, an art-director pass server-side,
 *  brand styling from Settings. */
function HeroGenerator({
  ai, iid, onDone, onError,
}: {
  ai: { brandId: string; campaignId: string; headline: string; brief?: string }
  iid: string
  onDone: (assetValue: string) => void
  onError: (m: string) => void
}) {
  // Seeded from the Monday task's creative brief when one was pulled —
  // the generator opens already knowing what the task asked for.
  const [brief, setBrief] = useState(ai.brief ?? '')
  const [withText, setWithText] = useState(false)
  const [headline, setHeadline] = useState(ai.headline)
  const [subtitle, setSubtitle] = useState('')
  const [more, setMore] = useState(false)
  const [visualStyle, setVisualStyle] = useState<'auto' | 'photo' | 'illustration' | 'render3d'>('auto')
  const [people, setPeople] = useState<'any' | 'none'>('any')
  const [avoid, setAvoid] = useState('')
  /** The running job id. Generation is a SERVER job — polling only shows
   *  progress; refresh/navigation cannot stop it, and on mount we look for a
   *  job an earlier page started and adopt it. */
  const [jobId, setJobId] = useState<string | null>(null)
  const busy = jobId !== null
  const [direction, setDirection] = useState<string | null>(null)
  // Rebuild the brief from the email's CURRENT content — "pull the approved
  // content as context for the image".
  const [briefing, setBriefing] = useState(false)
  const fromContent = () => {
    setBriefing(true)
    imageBriefFromContent(ai.campaignId)
      .then((b) => { if (b) setBrief(b) })
      .catch((e) => onError(e.message))
      .finally(() => setBriefing(false))
  }

  // Adopt a generation a previous page left running.
  useEffect(() => {
    let gone = false
    listHeroJobs(ai.campaignId)
      .then((js) => {
        const running = js.find((j) => j.iid === iid && j.status === 'running')
        if (running && !gone) setJobId(running.id)
      })
      .catch(() => { /* nothing to adopt */ })
    return () => { gone = true }
  }, [ai.campaignId, iid])

  // Poll while a job runs; apply its result exactly once.
  useEffect(() => {
    if (!jobId) return
    let gone = false
    const tick = () =>
      getHeroJob(jobId)
        .then((j) => {
          if (gone) return
          if (j.status === 'running') return
          setJobId(null)
          if (j.status === 'done' && j.result) {
            // The server already wrote this into the campaign; applying it
            // locally too keeps this page's state (and its next autosave)
            // convergent with what the server did.
            onDone(j.result.value)
            setDirection(j.result.direction)
          } else if (j.status === 'failed') {
            onError(j.error || 'Generation failed.')
          }
        })
        .catch(() => { /* transient poll miss — next tick retries */ })
    tick()
    const t = window.setInterval(tick, 2000)
    return () => { gone = true; window.clearInterval(t) }
  }, [jobId])

  const run = (directionOverride?: string) => {
    generateHeroImage({
      brand_id: ai.brandId,
      campaign_id: ai.campaignId,
      iid,
      brief: brief.trim(),
      with_text: withText,
      headline: headline.trim(),
      subtitle: subtitle.trim(),
      visual_style: visualStyle,
      people,
      avoid: avoid.trim(),
      direction_override: directionOverride,
    })
      .then((j) => setJobId(j.id))
      .catch((e) => onError(e.message))
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-secondary/40 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-semibold">
          <Sparkles className="h-3 w-3 text-primary" /> Generate with AI
        </span>
        <span className="flex items-center rounded-md border border-border bg-card p-0.5">
          {([['without', 'No text'], ['with', 'With text']] as const).map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => setWithText(m === 'with')}
              aria-pressed={withText === (m === 'with')}
              className={cn('rounded px-1.5 py-0.5 text-[10px] transition-colors',
                withText === (m === 'with')
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground')}
            >
              {l}
            </button>
          ))}
        </span>
      </div>

      {withText && (
        <div className="mt-1.5 space-y-1.5">
          <Input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="h-8 text-xs"
            placeholder="Headline painted into the image"
            aria-label="Image headline"
          />
          <Input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="h-8 text-xs"
            placeholder="Subtitle (optional)"
            aria-label="Image subtitle"
          />
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Image brief
        </span>
        <button
          type="button"
          onClick={fromContent}
          disabled={briefing || busy}
          title="Write the brief from the email's approved copy"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {briefing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          From email content
        </button>
      </div>
      <Textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        className="mt-1 text-xs"
        placeholder="What should the image show? Click “From email content”, or describe it — e.g. a confident beginner at a laptop, upbeat, daylight"
        aria-label="Image brief"
      />

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', !more && '-rotate-90')} />
        Art director settings
      </button>
      {more && (
        <div className="mt-1.5 space-y-1.5 rounded-md bg-card p-2">
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-[10px]">Style</Label>
            <select
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value as typeof visualStyle)}
              className="h-7 flex-1 rounded-md border border-border bg-card px-1.5 text-[11px]"
              aria-label="Visual style"
            >
              <option value="auto">Auto — let the director choose</option>
              <option value="photo">Photography</option>
              <option value="illustration">Illustration</option>
              <option value="render3d">3D render</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-[10px]">People</Label>
            <select
              value={people}
              onChange={(e) => setPeople(e.target.value as typeof people)}
              className="h-7 flex-1 rounded-md border border-border bg-card px-1.5 text-[11px]"
              aria-label="People"
            >
              <option value="any">Allowed</option>
              <option value="none">No people</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="w-14 shrink-0 text-[10px]">Avoid</Label>
            <Input
              value={avoid}
              onChange={(e) => setAvoid(e.target.value)}
              className="h-7 flex-1 text-[11px]"
              placeholder="e.g. charts, candlesticks, city skylines"
              aria-label="Things to avoid"
            />
          </div>
        </div>
      )}

      <Button
        size="sm"
        className="mt-1.5 w-full"
        disabled={busy || (withText && !headline.trim())}
        onClick={() => { setDirection(null); run() }}
      >
        {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
          : <><Sparkles className="h-3.5 w-3.5" /> Generate hero</>}
      </Button>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {busy
          ? 'Generating on the server — you can navigate away or refresh; the image lands in the campaign when ready.'
          : "Styled from the brand's colours and fonts in Settings."}
      </p>

      {direction !== null && (
        <div className="mt-1.5 rounded-md bg-card p-2">
          <Label className="text-[10px]">Art direction used — edit and regenerate</Label>
          <Textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            rows={4}
            className="mt-1 text-[11px]"
            aria-label="Art direction"
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5 w-full"
            disabled={busy || !direction.trim()}
            onClick={() => run(direction.trim())}
          >
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Regenerating…</>
              : 'Regenerate with this direction'}
          </Button>
        </div>
      )}
    </div>
  )
}

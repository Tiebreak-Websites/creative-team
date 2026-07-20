import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Smartphone,
  Tablet,
  LayoutGrid,
  List,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Toggle } from '@/components/Toggle'
import { countryFlagUrl, flagUrl } from '@/lib/flags'
import { marketByCode } from '@/lib/markets'
import { listBrands, normaliseName, type Brand } from '@/bannerBuilder/brandsApi'
import { SectionThumb } from './Builder'
import {
  composePage,
  createSection,
  deleteSection,
  DEVICE_WIDTH,
  updateSection,
  uploadLpAsset,
  type Device,
  type Language,
  type Project,
  type SectionDef,
} from './api'

/** Read-only flag pills — the same shape the Brand settings pickers use, so a
 * brand's reach reads identically wherever you meet it. */
interface PillItem {
  code: string
  label: string
  flag: string | null
}

function FlagPills({ items, empty }: { items: PillItem[]; empty: string }) {
  if (!items.length) return <span className="text-[11px] italic text-muted-foreground">{empty}</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((it) => (
        <span
          key={it.code}
          title={it.label}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {it.flag && (
            <img src={it.flag} alt="" className="h-2.5 w-[15px] rounded-[1px] object-cover ring-1 ring-inset ring-black/10" />
          )}
          {it.label}
        </span>
      ))}
    </span>
  )
}

/** A category heading: the brand and how many blocks it owns. The brand's
 * languages/markets live in the side panel — inline they wrapped over three
 * rows and pushed the blocks themselves below the fold. */
function GroupHeading({ cat, count, note }: { cat: string; count: number; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-1.5">
      <h2 className="font-display text-sm font-semibold text-foreground">{CATEGORY_LABEL[cat] ?? cat}</h2>
      <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
        {count}
      </span>
      {/* Stated once for the group rather than stamped on all nine rows: every
          shared block is offered to every brand, so per-row it would be nine
          copies of one sentence. */}
      {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
    </div>
  )
}

/** Where a brand's blocks are allowed to go. Read-only: the single place these
 * are edited is Settings > Brands, and duplicating that control here would just
 * create two answers to the same question. */
function BrandReachPanel({ brands }: { brands: { cat: string; langs: PillItem[]; markets: PillItem[] }[] }) {
  if (!brands.length) return null
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h3 className="font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">Brand reach</h3>
      <div className="mt-3 space-y-4">
        {brands.map((b) => (
          <div key={b.cat}>
            <p className="mb-2 font-display text-sm font-semibold text-foreground">
              {CATEGORY_LABEL[b.cat] ?? b.cat}
            </p>
            <Reach label="Languages" items={b.langs} />
            {/* A rule, not just spacing: languages and markets are different
                lists that often overlap (Italian / Italy), and a gap alone let
                them read as one run of flags. */}
            <div className="my-2.5 border-t border-border" />
            <Reach label="Target markets" items={b.markets} />
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-2 text-[10px] leading-snug text-muted-foreground">
        Set in Settings › Brands.
      </p>
    </div>
  )
}

function Reach({ label, items }: { label: string; items: PillItem[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label} <span className="tabular-nums">{items.length}</span>
      </p>
      <FlagPills items={items} empty="none set" />
    </div>
  )
}

/** Category headings. A block's category IS its owning brand (plus the shared
 * generic buckets), so grouping is what "each brand has its own library" looks
 * like — and it stops the same chip repeating on all 17 rows. */
const CATEGORY_LABEL: Record<string, string> = {
  braintrade: 'BrainTrade',
  elements: 'Shared blocks',
  hero: 'Hero',
  content: 'Content',
  'social-proof': 'Social proof',
  conversion: 'Conversion',
  legal: 'Legal & footer',
}
/** Brand libraries first, shared buckets after. */
const CATEGORY_RANK = (c: string) => (c === 'elements' ? 2 : 1)

/** Translation coverage, not a flag strip.
 *
 * A row used to carry up to 13 flag images; seventeen rows of them was ~200
 * pictures competing for attention, and at 18px Italy and Mexico are the same
 * picture anyway. What you actually want to know is whether a block is ready in
 * every language its brand sells in — so that is what it says, and it only
 * raises its voice when the answer is no.
 *
 * `expected` is the brand's declared languages. Shared blocks belong to no one
 * brand, so they get a plain count instead of a fraction. */
function LangCoverage({
  codes,
  expected,
  languages,
}: {
  codes: string[]
  expected: string[] | null
  languages: Language[]
}) {
  const nameOf = (c: string) => languages.find((l) => l.code === c)?.label ?? c.toUpperCase()

  if (!expected || !expected.length) {
    return (
      <span
        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
        title={codes.length ? codes.map(nameOf).join(' · ') : undefined}
      >
        {codes.length} {codes.length === 1 ? 'language' : 'languages'}
      </span>
    )
  }

  const have = new Set(codes)
  const missing = expected.filter((c) => !have.has(c))
  const complete = missing.length === 0

  return (
    <span
      title={
        complete
          ? `Translated in all ${expected.length} of the brand's languages`
          : `Missing: ${missing.map(nameOf).join(', ')}`
      }
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
        complete ? 'text-muted-foreground' : 'bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400',
      )}
    >
      {expected.length - missing.length} / {expected.length}
    </span>
  )
}

/** Admin — manage the section template library + the global language list. */
export function AdminTemplates({
  sections,
  languages,
  initialEditKey,
  onBack,
  onChanged,
  onError,
}: {
  sections: SectionDef[]
  languages: Language[]
  /** Open this block's editor on mount — set when arriving from the builder's
   * Add tab, so the pencil lands on the block rather than the library index. */
  initialEditKey?: string
  onBack: () => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [editing, setEditing] = useState<SectionDef | null>(null)

  // Arriving from the builder's Add tab with a block in mind: open its editor
  // directly. Runs once per key so closing the editor doesn't reopen it.
  const openedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialEditKey || openedRef.current === initialEditKey) return
    const target = sections.find((s) => s.key === initialEditKey)
    if (target) {
      openedRef.current = initialEditKey
      setEditing(target)
    }
  }, [initialEditKey, sections])

  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showDeactivated, setShowDeactivated] = useState(false)
  // The thumb scales by --thumb-scale, so it has to know the real card width
  // — which changes with the breakpoint (1/2/3 columns). Measure a card
  // rather than hardcoding a ratio that's only right at one size.
  // The registry is the source of truth for a brand's languages and target
  // markets — this page only displays them; they are edited in Settings > Brands.
  const [brands, setBrands] = useState<Brand[]>([])
  useEffect(() => {
    listBrands()
      .then(setBrands)
      .catch(() => {
        /* headings simply omit the reach pills */
      })
  }, [])

  const gridRef = useRef<HTMLDivElement>(null)
  const [cardW, setCardW] = useState(320)
  useEffect(() => {
    const el = gridRef.current
    if (!el || view !== 'grid') return
    const measure = () => {
      // Must be a real card, not firstElementChild — the group headings are
      // col-span-full, so measuring those returns the whole grid width and the
      // thumbnails render at ~1.5x inside a 720px-tall empty box.
      const first = el.querySelector<HTMLElement>('[data-block-card]')
      if (first?.clientWidth) setCardW(first.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view, sections.length])
  const ordered = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections])
  // Deactivated blocks drop out of the main list into their own group rather
  // than sitting inline struck-through — same shape as a retired brand.
  const active = useMemo(() => ordered.filter((s) => s.enabled), [ordered])
  const deactivated = useMemo(() => ordered.filter((s) => !s.enabled), [ordered])
  // A flat stream with heading markers, so list and grid share one grouping.
  const grouped = useMemo(() => {
    const sorted = [...active].sort(
      (a, b) =>
        CATEGORY_RANK(a.category) - CATEGORY_RANK(b.category) ||
        a.category.localeCompare(b.category) ||
        a.position - b.position,
    )
    const out: { heading?: string; count?: number; s?: SectionDef }[] = []
    let last: string | null = null
    for (const sec of sorted) {
      if (sec.category !== last) {
        out.push({ heading: sec.category, count: sorted.filter((x) => x.category === sec.category).length })
        last = sec.category
      }
      out.push({ s: sec })
    }
    return out
  }, [active])

  // A block's category is its owning brand's name, normalised.
  const brandFor = (cat: string) =>
    brands.find((b) => normaliseName(b.name) === normaliseName(cat)) || null

  const reachOf = (cat: string) => {
    const b = brandFor(cat)
    if (!b) return null
    return {
      langs: (b.languages ?? []).map((c) => ({
        code: c,
        label: languages.find((l) => l.code === c)?.label ?? c.toUpperCase(),
        flag: flagUrl(c),
      })),
      markets: (b.markets ?? []).map((c) => ({
        code: c,
        label: marketByCode(c)?.name ?? c.toUpperCase(),
        flag: countryFlagUrl(c),
      })),
    }
  }

  // One entry per brand group on screen; 'Elements' and friends have no brand
  // in the registry and simply don't appear.
  const panelBrands = useMemo(() => {
    const cats = [...new Set(grouped.filter((g) => g.heading !== undefined).map((g) => g.heading!))]
    const out: { cat: string; langs: PillItem[]; markets: PillItem[] }[] = []
    for (const cat of cats) {
      const r = reachOf(cat)
      if (r) out.push({ cat, langs: r.langs, markets: r.markets })
    }
    return out
  }, [grouped, brands, languages])

  // Null for shared categories: they belong to no brand, so there is no set of
  // languages they are expected to cover.
  const expectedFor = (cat: string) => reachOf(cat)?.langs.map((l) => l.code) ?? null

  const setActive = (s: SectionDef, on: boolean) =>
    updateSection(s.key, { enabled: on }).then(onChanged).catch((err) => onError(err.message))

  // The thumbnail renderer composes against a project (for tokens + language).
  // There's no real project here, so a neutral stub gives every block the same
  // unbranded baseline — the library shows the block, not one brand's take.
  const stubProject = useMemo(
    () =>
      ({
        id: 'lib', name: 'lib', brand_id: '', language: 'en', campaign_id: '',
        sections: [], tokens: {}, form: { action_url: '', success_url: '' },
        fonts: 'system', meta_title: '', meta_description: '',
        created_by: '', created_at: '', updated_at: '',
      }) as unknown as Project,
    [],
  )

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
          {/* "Blocks", not "Templates": these are the section components a page
              is assembled from, distinct from a brand's page templates. */}
          <h1 className="font-display text-2xl font-bold tracking-tight">Blocks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The section blocks every landing page is built from. Shipped blocks can be edited or
            disabled but never deleted — clone one to make a custom block you own.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center rounded-lg border border-border bg-secondary p-0.5">
          {([['list', List], ['grid', LayoutGrid]] as const).map(([v, Icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              title={`${v === 'list' ? 'List' : 'Grid'} view`}
              aria-label={`${v === 'list' ? 'List' : 'Grid'} view`}
              className={cn(
                'rounded-md px-2 py-1 transition-colors',
                view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Blocks left, brand context right. The reach lists are reference data
          you glance at, not something you read top-to-bottom, so they sit
          beside the library instead of pushing it below the fold. */}
      <div className="items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_236px]">
        <div className="min-w-0">
      {view === 'grid' ? (
        <div
          ref={gridRef}
          className="grid gap-3 animate-fade-up sm:grid-cols-2 lg:grid-cols-3"
          // SectionThumb scales by --thumb-scale; without it the transform is
          // invalid and you get the top-left corner of an 800px page. Scaling to
          // the measured card width makes the block fill it at any breakpoint.
          style={{ animationDelay: '80ms', ['--thumb-scale' as string]: `${cardW / 800}` }}
        >
          {grouped.map((g) => {
            const s = g.s!
            return g.heading !== undefined ? (
              <div key={`h-${g.heading}`} className="col-span-full mb-1 mt-4 first:mt-0">
                <GroupHeading
                  cat={g.heading}
                  count={g.count!}
                  note={reachOf(g.heading) ? undefined : 'Offered to every brand'}
                />
              </div>
            ) : (
            <div
              key={s.key}
              data-block-card=""
              className={cn(
                'group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
                !s.enabled && 'opacity-55',
              )}
            >
              <div
                className="relative overflow-hidden border-b border-border"
                style={{ height: Math.round(cardW * 0.6) }}
              >
                <SectionThumb
                  def={s}
                  project={stubProject}
                  // Fill the sized box: the thumb's own overflow-hidden does the
                  // clipping, matching how the Add tab's fixed-height strip works.
                  className="h-full"
                />
                {!s.built_in && (
                  <span className="absolute right-1.5 top-1.5 rounded border border-emerald-500/40 bg-background/90 px-1.5 text-[9px] font-semibold text-emerald-600">
                    CUSTOM
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn('min-w-0 flex-1 truncate text-[13px] font-semibold', !s.enabled && 'line-through')}>
                    {s.name}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)} title={`Edit ${s.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Toggle on={s.enabled} onChange={(v) => setActive(s, v)} label={`${s.name} active`} />
                  <span className="ml-auto min-w-0">
                    <LangCoverage codes={s.languages} expected={expectedFor(s.category)} languages={languages} />
                  </span>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      ) : (
      <div className="space-y-2 animate-fade-up" style={{ animationDelay: '80ms' }}>
        {grouped.map((g) => {
          const s = g.s!
          return g.heading !== undefined ? (
              <div key={`h-${g.heading}`} className="mb-1 mt-4 first:mt-0">
                <GroupHeading
                  cat={g.heading}
                  count={g.count!}
                  note={reachOf(g.heading) ? undefined : 'Offered to every brand'}
                />
              </div>
            ) : (
          <div key={s.key} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
            <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', !s.enabled && 'text-muted-foreground line-through')}>
              {s.name}
            </span>
            {/* Every shipped block is built-in, so badging THAT says nothing.
                A cloned block is the exception worth marking — and it's also the
                only kind that can be deleted (the backend 409s on a built-in). */}
            {!s.built_in && (
              <span className="shrink-0 rounded border border-emerald-500/40 px-1.5 text-[9px] font-semibold text-emerald-600">CUSTOM</span>
            )}
            <LangCoverage codes={s.languages} expected={expectedFor(s.category)} languages={languages} />
            <Toggle on={s.enabled} onChange={(v) => setActive(s, v)} label={`${s.name} active`} />
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
          )
        })}
      </div>
      )}

      {deactivated.length > 0 && (
        <section className="mt-8 animate-fade-up" style={{ animationDelay: '120ms' }}>
          {/* Collapsed by default: these are parked blocks, not working set. */}
          <button
            type="button"
            onClick={() => setShowDeactivated((v) => !v)}
            aria-expanded={showDeactivated}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <ChevronRight
              className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', showDeactivated && 'rotate-90')}
            />
            <h2 className="font-display text-sm font-semibold text-muted-foreground">Deactivated</h2>
            <span className="rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {deactivated.length}
            </span>
            <span className="hidden text-xs text-muted-foreground/80 sm:inline">
              Hidden from the builder's Add tab. Pages already using one keep rendering it.
            </span>
          </button>
          <div className={cn('mt-2 space-y-2 opacity-70', !showDeactivated && 'hidden')}>
            {deactivated.map((s) => (
              <div
                key={s.key}
                className="flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-card px-3 py-2"
              >
                <span className="w-20 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                  {s.category}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{s.name}</span>
                {!s.built_in && (
                  <span className="shrink-0 rounded border border-emerald-500/40 px-1.5 text-[9px] font-semibold text-emerald-600">
                    CUSTOM
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={() => setActive(s, true)} title={`Reactivate ${s.name}`}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(s)} title={`Edit ${s.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
        </div>

        <aside className="mt-6 animate-fade-up lg:sticky lg:top-8 lg:mt-0" style={{ animationDelay: '120ms' }}>
          <BrandReachPanel brands={panelBrands} />
        </aside>
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
  /** Real rendered height of the section, measured from the iframe. The box
   * used to be pinned to 900/scale, which LAID OUT ~2250px tall while only
   * PAINTING 900px — leaving a screen of dead space under every preview. */
  const [docHeight, setDocHeight] = useState(600)
  const frameRef = useRef<HTMLIFrameElement>(null)
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
          <div
            style={{ width: DEVICE_WIDTH[device] * scale, height: docHeight * scale }}
            className="mx-auto"
          >
            <div
              style={{
                width: DEVICE_WIDTH[device],
                height: docHeight,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              className="overflow-hidden rounded-lg border border-border bg-white shadow-xl"
            >
              <iframe
                ref={frameRef}
                title="Section preview"
                srcDoc={srcdoc}
                className="h-full w-full border-0"
                sandbox="allow-same-origin"
                onLoad={() => {
                  // srcdoc + allow-same-origin lets us read the real height, so
                  // the frame hugs the section instead of guessing.
                  const d = frameRef.current?.contentDocument
                  const h = d?.body?.scrollHeight ?? 0
                  if (h > 0) setDocHeight(Math.min(4000, Math.max(120, h)))
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

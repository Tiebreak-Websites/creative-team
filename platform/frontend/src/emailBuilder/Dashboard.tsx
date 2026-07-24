// CRM Emails dashboard — the same shelf the LP Builder opens onto.
//
// Folders per brand first, then the campaigns inside one. Deliberately the
// SAME components (FolderGrid, the card shape, CopyId, LangChip) rather than
// lookalikes: someone who has used Landing Pages should not have to relearn
// this screen, and two copies of a folder drift apart.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, Copy, FilePlus2,
  Languages, Loader2, Mail, RefreshCw, Search, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { flagUrl } from '@/lib/flags'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { FolderGrid, type FolderItem } from '@/components/FolderGrid'
import { Toggle } from '@/components/Toggle'
import type { Language } from '@/lpBuilder/api'
import {
  KIND_HINT, KIND_LABEL, kindOf, type Brand, type EntityKind,
} from '@/bannerBuilder/brandsApi'
import {
  campaignThumb, createVariants, deleteCampaign, mondayItem, setCampaignActive,
  type CampaignSummary,
} from './api'

/** CRM shelf order — deliberately different from the global ENTITY_KINDS.
 *  The team works brokers, academies and prop firms actively; white labels
 *  are parked, so they sit last and start collapsed. */
const CRM_KIND_ORDER: EntityKind[] = ['broker', 'academy', 'prop', 'whitelabel']

/** Kinds that render collapsed by default — not in active use, kept out of
 *  the way but one click from view. */
const COLLAPSED_KINDS = new Set<EntityKind>(['whitelabel'])

/** Tiny inline metadata chip — shared by the Monday strips here and the
 *  create dialog's task rows. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}

/** Last composed HTML per campaign, with the edit stamp it was composed at.
 *  Keeping the html separately from its stamp lets a card keep showing the
 *  previous render while a newer one loads — flipping Active bumps updated_at
 *  without changing a pixel of the email, and blanking every thumbnail for
 *  that is pure churn. */
const thumbCache = new Map<string, { stamp: string; html: string }>()

/** Most recent updated_at, or ''. Written out rather than using .at(-1):
 *  the project's TS target predates it. */
function latestOf(items: { updated_at: string }[]): string {
  const sorted = items.map((i) => i.updated_at).sort()
  return sorted.length ? sorted[sorted.length - 1] : ''
}

export function Dashboard({
  campaigns,
  brands,
  languages,
  initialFolder = null,
  initialParentId = null,
  onOpen,
  onCreate,
  onChanged,
  onError,
}: {
  campaigns: CampaignSummary[] | null
  brands: Brand[]
  languages: Language[]
  /** Where to open the shelf — remembered across an editor round trip so "back"
   *  from a campaign returns to its folder / language-variant list, not the root. */
  initialFolder?: string | null
  initialParentId?: string | null
  onOpen: (id: string) => void
  onCreate: (brandId: string) => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const dark = useIsDark()
  /** null = the folder shelf; a brand id = inside that folder; '' = "Other". */
  const [folder, setFolder] = useState<string | null>(initialFolder)
  /** A parent id when looking at its language variants. */
  const [parentId, setParentId] = useState<string | null>(initialParentId)
  const [query, setQuery] = useState('')
  const [addingTo, setAddingTo] = useState<CampaignSummary | null>(null)
  /** Which kind sections the user has expanded past their default state.
   *  White label starts collapsed (parked); a click toggles it. */
  const [openKinds, setOpenKinds] = useState<Set<EntityKind>>(new Set())

  const brandById = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b])) as Record<string, Brand>,
    [brands],
  )

  // Every kind gets folders, white labels included — a white label sends its
  // own mail, so it owns its own shelf space.
  const buckets = useMemo(() => {
    const list = campaigns ?? []
    return CRM_KIND_ORDER.map((kind) => {
      const items: FolderItem[] = brands
        .filter((b) => kindOf(b) === kind)
        .map((b) => {
          const mine = list.filter((c) => c.brand_id === b.id && !c.parent_id)
          return {
            id: b.id,
            name: b.name,
            brand: b,
            count: mine.length,
            latest: latestOf(mine),
          }
        })
      return { kind, items }
    }).filter((g) => g.items.length)
  }, [brands, campaigns])

  const orphans = useMemo(
    () => (campaigns ?? []).filter((c) => !brandById[c.brand_id] && !c.parent_id),
    [campaigns, brandById],
  )

  if (campaigns === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  // ------------------------------------------------------------ language variants
  if (parentId) {
    const parent = campaigns.find((c) => c.id === parentId)
    const children = campaigns
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.language.localeCompare(b.language))
    if (!parent) {
      // Deleted from under us — fall back rather than render a blank screen.
      setParentId(null)
      return null
    }
    const brand = brandById[parent.brand_id]
    const covered = new Set([parent.language, ...children.map((c) => c.language)])

    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5 flex items-center gap-3 animate-fade-up">
          <Button variant="ghost" size="icon" onClick={() => setParentId(null)}
                  title="Back to campaigns" aria-label="Back to campaigns">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-bold">{parent.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {brand ? `${brand.name} · ` : ''}
              {children.length === 0
                ? 'No language variants yet.'
                : `${children.length} language variant${children.length === 1 ? '' : 's'}.`}
            </p>
          </div>
          <Button className="ml-auto shrink-0" onClick={() => setAddingTo(parent)}
                  disabled={!parent.active}
                  title={parent.active
                    ? 'Localize the approved English master into more languages'
                    : 'Approve the English master first — localization regenerates from the signed-off copy'}>
            <Languages className="h-4 w-4" /> Localize
          </Button>
        </div>

        {/* The parent first and labelled. It is the source the variants were
            copied from, so which one it is has to be unambiguous. */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <CampaignCard
            c={parent} languages={languages} index={0} badge="Source"
            onOpen={() => onOpen(parent.id)} onChanged={onChanged} onError={onError}
          />
          {children.map((c, i) => (
            <CampaignCard
              key={c.id} c={c} languages={languages} index={i + 1}
              onOpen={() => onOpen(c.id)} onChanged={onChanged} onError={onError}
            />
          ))}
        </div>

        {children.length === 0 && !parent.active && (
          <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-foreground">
            This is the English master. Approve it first, then localize — each language is
            regenerated natively from the master’s brief and lands as a Draft to proof.
          </p>
        )}

        {addingTo && (
          <AddLanguagesModal
            parent={addingTo}
            covered={covered}
            languages={languages}
            brand={brand}
            onClose={() => setAddingTo(null)}
            onDone={() => { setAddingTo(null); onChanged() }}
            onError={onError}
          />
        )}
      </div>
    )
  }

  // ------------------------------------------------------------- inside a folder
  if (folder !== null) {
    const brand = brandById[folder]
    // Parents only. A variant belongs under its parent, not loose in the
    // folder — otherwise one campaign in ten languages reads as ten campaigns.
    const inFolder = campaigns.filter((c) =>
      !c.parent_id && (folder === '' ? !brandById[c.brand_id] : c.brand_id === folder))
    const visible = query
      ? inFolder.filter((c) =>
          (c.name + ' ' + c.subject).toLowerCase().includes(query.toLowerCase()))
      : inFolder

    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5 flex items-center gap-3 animate-fade-up">
          <Button variant="ghost" size="icon" onClick={() => { setFolder(null); setQuery('') }}
                  title="Back to folders" aria-label="Back to folders">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            {brand ? (
              <img src={brandLogoSrc(brand, dark)} alt={brand.name}
                   className="h-7 max-w-[200px] object-contain object-left" />
            ) : (
              <h1 className="font-display text-xl font-bold">Other</h1>
            )}
            <p className="mt-0.5 text-sm text-muted-foreground">
              Campaign emails in the {brand?.name ?? 'Other'} folder.
            </p>
          </div>
          <Button className="ml-auto shrink-0" onClick={() => onCreate(folder)}>
            <FilePlus2 className="h-4 w-4" /> New campaign
          </Button>
        </div>

        {inFolder.length > 3 && (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)}
                   className="h-10 pl-9" placeholder="Search campaigns…" />
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Mail className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">
              {query ? 'Nothing matches your search.' : 'This folder is empty'}
            </p>
            {!query && (
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                A new campaign starts with the standard layout — logo, hero, headline,
                body, CTA and a compliance footer.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {visible.map((c, i) => (
              <CampaignCard
                key={c.id} c={c} languages={languages} index={i}
                onOpen={() => (c.variants > 0 ? setParentId(c.id) : onOpen(c.id))}
                onLocalize={() => { setParentId(c.id); setAddingTo(c) }}
                onChanged={onChanged} onError={onError}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // --------------------------------------------------------------- folder shelf
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start gap-3 animate-fade-up">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">CRM Emails</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One folder per brand — pick one to see its campaigns.
          </p>
        </div>
        <Button className="ml-auto shrink-0" onClick={() => onCreate('')}>
          <FilePlus2 className="h-4 w-4" /> New campaign
        </Button>
      </div>

      <div className="space-y-6">
        {buckets.map(({ kind, items }) => {
          // White label defaults collapsed; toggling flips it. Any other kind
          // is always open (COLLAPSED_KINDS is empty of them).
          const startsCollapsed = COLLAPSED_KINDS.has(kind)
          const open = startsCollapsed ? openKinds.has(kind) : true
          const toggle = () =>
            setOpenKinds((cur) => {
              const next = new Set(cur)
              next.has(kind) ? next.delete(kind) : next.add(kind)
              return next
            })
          return (
            <section key={kind}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                {startsCollapsed ? (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className="group -ml-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-secondary/60"
                  >
                    {open
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    <h2 className="font-display text-sm font-semibold">{KIND_LABEL[kind]}</h2>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                  </button>
                ) : (
                  <>
                    <h2 className="font-display text-sm font-semibold">{KIND_LABEL[kind]}</h2>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                  </>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {startsCollapsed && !open ? 'Not in active use — click to show.' : KIND_HINT[kind]}
                </span>
              </div>
              {open && (
                <FolderGrid folders={items} dark={dark} noun="email"
                            onOpen={(id) => setFolder(id)} />
              )}
            </section>
          )
        })}

        {orphans.length > 0 && (
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="font-display text-sm font-semibold">Other</h2>
              <span className="text-[11px] tabular-nums text-muted-foreground">{orphans.length}</span>
              <span className="text-[11px] text-muted-foreground">Campaigns with no brand set.</span>
            </div>
            <FolderGrid
              folders={[{ id: '', name: 'Other', brand: null, count: orphans.length,
                          latest: latestOf(orphans) }]}
              dark={dark} noun="email" onOpen={() => setFolder('')}
            />
          </section>
        )}
      </div>
    </div>
  )
}

/** The composed email, scaled into the card. Same approach as the LP block
 *  thumbnails: render the real output small rather than store a picture of it,
 *  so a thumbnail can never be stale. */
function EmailThumb({ c }: { c: CampaignSummary }) {
  const [doc, setDoc] = useState<string | null>(() => thumbCache.get(c.id)?.html ?? null)
  // The tile's real width, so the 640px email viewport scales to EXACTLY fit.
  // A fixed scale cropped the email's right edge on narrow grid tiles and
  // left dead space on wide ones — the tile width is the only correct scale.
  const boxRef = useRef<HTMLSpanElement>(null)
  const [tileW, setTileW] = useState(0)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setTileW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cached = thumbCache.get(c.id)
    // Show whatever we last had immediately, then refresh only if the campaign
    // has actually been edited since.
    if (cached) setDoc(cached.html)
    if (cached?.stamp === c.updated_at) return

    let gone = false
    campaignThumb(c.id)
      .then((html) => {
        thumbCache.set(c.id, { stamp: c.updated_at, html })
        if (!gone) setDoc(html)
      })
      .catch(() => {
        thumbCache.set(c.id, { stamp: c.updated_at, html: '' })
        if (!gone) setDoc((prev) => prev ?? '')
      })
    return () => { gone = true }
  }, [c.id, c.updated_at])

  return (
    <span ref={boxRef} className="pointer-events-none block aspect-square overflow-hidden bg-white">
      {doc && tileW > 0 ? (
        <iframe
          title=""
          srcDoc={doc}
          tabIndex={-1}
          aria-hidden
          scrolling="no"
          sandbox=""
          // A 640x640 window on the email scaled to the measured tile: the
          // square tile shows a square crop from the top — the part a
          // recipient sees first — at exactly the tile's width, never cropped
          // sideways.
          className="h-[640px] w-[640px] origin-top-left border-0"
          style={{ transform: `scale(${tileW / 640})` }}
        />
      ) : (
        <span className="flex h-full items-center justify-center">
          <Mail className="h-6 w-6 text-muted-foreground/40" />
        </span>
      )}
    </span>
  )
}

function CampaignCard({
  c, languages, index, badge, onOpen, onLocalize, onChanged, onError,
}: {
  c: CampaignSummary
  languages: Language[]
  index: number
  /** Marks the parent inside the variants view. */
  badge?: string
  onOpen: () => void
  /** Top-level master cards only — opens the localize picker for an approved
   *  English master. Absent on variants and inside the variants view. */
  onLocalize?: () => void
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="group animate-fade-up overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <span className="relative block">
          <EmailThumb c={c} />
          {badge && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-foreground/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-background">
              {badge}
            </span>
          )}
        </span>
        <span className="block space-y-1 p-3">
          <span className="block truncate font-display text-sm font-semibold" title={c.name}>
            {c.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <LangChip code={c.language} languages={languages} />
            {c.variants > 0 && (
              <>
                <span>·</span>
                <span className="text-foreground">
                  +{c.variants} language{c.variants === 1 ? '' : 's'}
                </span>
              </>
            )}
          </span>
        </span>
      </button>

      <div className="px-3 pb-2">
        {/* Only ever the REAL Monday task id — never a fabricated one. A campaign
            with no linked task says so rather than borrowing its own internal id
            and passing it off as a Monday ID. */}
        {c.monday_id ? (
          <CopyId value={c.monday_id} label="Monday ID" />
        ) : (
          <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            No Monday task
          </span>
        )}
      </div>

      {/* Approved/Draft instead of delete. A campaign that has been sent is a
          record of what went out; un-approving retires it without destroying
          that. Always visible, not hover-revealed — it is status, not an
          action tucked away. */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Toggle
          on={c.active}
          label={c.active ? `Un-approve ${c.name}` : `Approve ${c.name}`}
          onChange={(next) => {
            setBusy(true)
            setCampaignActive(c.id, next)
              .then(onChanged)
              .catch((e) => onError(e.message))
              .finally(() => setBusy(false))
          }}
        />
        <span className={cn('text-[11px]', c.active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {c.active ? 'Approved' : 'Draft'}
        </span>
        {busy ? (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />
        ) : !c.active ? (
          /* Drafts can be deleted; approved campaigns must be un-approved
             first (the backend refuses otherwise) — destroying a signed-off
             email should take two deliberate steps, not one click. */
          <button
            type="button"
            title={c.variants > 0 ? `Delete draft and its ${c.variants} variant(s)` : 'Delete draft'}
            aria-label={`Delete draft ${c.name}`}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              const extra = c.variants > 0 ? ` and its ${c.variants} language variant(s)` : ''
              if (!window.confirm(`Delete the draft "${c.name}"${extra}? This cannot be undone.`)) return
              setBusy(true)
              deleteCampaign(c.id)
                .then(onChanged)
                .catch((e) => onError(e.message))
                .finally(() => setBusy(false))
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Localize on its OWN full-width row — an approved master's next action.
          A dedicated row (not squeezed beside the Approved toggle) so the label
          never clips on a narrow card. The card body still opens the editor. */}
      {onLocalize && c.active && (
        <button
          type="button"
          title="Localize this approved master into more languages"
          aria-label={`Localize ${c.name}`}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          onClick={onLocalize}
        >
          <Languages className="h-3.5 w-3.5" /> Localize
        </button>
      )}
    </div>
  )
}

function CopyId({ value, label = 'Campaign ID' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1200)
        }).catch(() => { /* clipboard blocked — nothing useful to say */ })
      }}
      className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="font-mono">#{value}</span>
      {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function LangChip({ code, languages }: { code: string; languages: Language[] }) {
  const label = languages.find((l) => l.code === code)?.label ?? code.toUpperCase()
  const url = flagUrl(code)
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      {url && (
        <img src={url} alt="" className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
      )}
      {label}
    </span>
  )
}

/** Pick the languages to fan a finished source email out into. */
function AddLanguagesModal({
  parent, covered, languages, brand, onClose, onDone, onError,
}: {
  parent: CampaignSummary
  /** Languages already covered by the source or an existing variant. */
  covered: Set<string>
  languages: Language[]
  brand?: Brand
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Languages the linked Monday task asks for (builder codes) — the source of
  // truth for what to localize into. Pulled LIVE, so adding one on the task in
  // Monday and hitting Sync brings it straight in.
  const [taskLangs, setTaskLangs] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)

  const labelFor = (code: string) =>
    languages.find((l) => l.code === code)?.label ?? code.toUpperCase()

  // Pull the task's Language column from Monday and pre-tick it — minus English
  // (the master), and anything a variant already covers. The backend already
  // resolves the column to builder codes on match.languages, so this is just a
  // filter. The picker stays editable; Monday is where you change the SET.
  const pullFromMonday = () => {
    if (!parent.monday_id) return
    setSyncing(true)
    mondayItem(parent.monday_id).then((res) => {
      const fresh = (res.match?.languages ?? []).filter(
        (c) => c && c !== 'en' && c !== parent.language && !covered.has(c))
      setTaskLangs(Array.from(new Set(fresh)))
      setPicked((p) => Array.from(new Set([...p, ...fresh])))
    }).catch(() => { /* Monday offline — pick manually below */ })
      .finally(() => setSyncing(false))
  }

  useEffect(() => { pullFromMonday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The brand's declared languages first — those are the markets it actually
  // sells in. The rest stay reachable but out of the way.
  const declared = brand?.languages ?? []
  const groups = useMemo(() => {
    const inBrand = languages.filter((l) => declared.includes(l.code))
    const rest = languages.filter((l) => !declared.includes(l.code))
    return [
      { label: brand ? `${brand.name} languages` : 'Languages', items: inBrand },
      { label: 'Other languages', items: rest },
    ].filter((g) => g.items.length)
  }, [languages, declared, brand])

  const toggle = (code: string) =>
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-lg"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold">Localize “{parent.name}”</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Each language is regenerated natively from the approved English master’s
          brief — not a translated copy — and lands as a Draft to proof before it ships.
        </p>

        {parent.monday_id ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
              {taskLangs.length > 0 ? (
                <>
                  <span className="font-medium text-foreground">{taskLangs.map(labelFor).join(', ')}</span>
                  {' '}pulled from the Monday task and pre-selected. Need another? Add it to the
                  task’s Language column in Monday, then Sync.
                </>
              ) : (
                <>No extra languages on the Monday task yet. Add them to the task’s Language
                  column in Monday, then Sync.</>
              )}
            </p>
            <button
              type="button"
              onClick={pullFromMonday}
              disabled={syncing}
              title="Re-pull the task's languages from Monday"
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Not linked to a Monday task — pick languages manually below.
          </p>
        )}

        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {g.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((l) => {
                  const already = covered.has(l.code)
                  const on = picked.includes(l.code)
                  const url = flagUrl(l.code)
                  return (
                    <button
                      key={l.code}
                      type="button"
                      disabled={already}
                      onClick={() => toggle(l.code)}
                      title={already ? `${l.label} already exists` : l.label}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors',
                        already
                          ? 'cursor-not-allowed border-border bg-secondary text-muted-foreground/50'
                          : on
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border hover:border-primary/40',
                      )}
                    >
                      {url && (
                        <img src={url} alt="" className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
                      )}
                      {l.label}
                      {already && <Check className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {picked.length ? `${picked.length} selected` : 'Nothing selected'}
          </span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || picked.length === 0}
            onClick={() => {
              setBusy(true)
              createVariants(parent.id, picked)
                .then(onDone)
                .catch((e) => onError(e.message))
                .finally(() => setBusy(false))
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Localize to {picked.length || ''} language{picked.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  )
}

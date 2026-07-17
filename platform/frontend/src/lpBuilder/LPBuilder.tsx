import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Globe,
  Languages,
  Layout,
  Loader2,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatUserName } from '@/lib/utils'
import { useAuth } from '../auth/AuthContext'
import {
  entityAccent,
  ENTITY_KINDS,
  KIND_HINT,
  KIND_LABEL,
  kindOf,
  listBrands,
  NEUTRAL_ACCENT,
  type Brand,
} from '../bannerBuilder/brandsApi'
import { listCampaigns, type CampaignInfo } from '../lpMaterials/api'
import { AdminTemplates } from './AdminTemplates'
import { Builder } from './Builder'
import {
  brandTokens,
  createProject,
  deleteProject,
  downloadExportZip,
  duplicateProject,
  getProject,
  listProjects,
  listSections,
  type Language,
  type ProjectSummary,
  type SectionDef,
} from './api'

type View = { kind: 'home' } | { kind: 'builder'; id: string } | { kind: 'admin' }

export function LPBuilder() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [view, setView] = useState<View>({ kind: 'home' })
  const [sections, setSections] = useState<SectionDef[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [libVersion, setLibVersion] = useState(0)

  useEffect(() => {
    listSections()
      .then((d) => {
        setSections(d.sections)
        setLanguages(d.languages)
      })
      .catch((e) => setError(e.message))
  }, [libVersion])

  useEffect(() => {
    if (view.kind !== 'home') return
    setProjects(null)
    listProjects().then(setProjects).catch((e) => setError(e.message))
  }, [view])

  return (
    <div className="relative h-full min-h-0">
      {error && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-[70] flex w-full max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-lg backdrop-blur"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {view.kind === 'builder' ? (
        <Builder
          projectId={view.id}
          sections={sections.filter((s) => s.enabled)}
          languages={languages}
          onBack={() => setView({ kind: 'home' })}
          onError={setError}
        />
      ) : view.kind === 'admin' ? (
        <AdminTemplates
          sections={sections}
          languages={languages}
          onBack={() => setView({ kind: 'home' })}
          onChanged={() => setLibVersion((v) => v + 1)}
          onError={setError}
        />
      ) : (
        <Dashboard
          projects={projects}
          languages={languages}
          isAdmin={isAdmin}
          myEmail={(user?.email || '').toLowerCase()}
          isAdminRole={isAdmin}
          onOpen={(id) => setView({ kind: 'builder', id })}
          onAdmin={() => setView({ kind: 'admin' })}
          onError={setError}
          onRefresh={() => listProjects().then(setProjects).catch(() => {})}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({
  projects,
  languages,
  isAdmin,
  myEmail,
  isAdminRole,
  onOpen,
  onAdmin,
  onError,
  onRefresh,
}: {
  projects: ProjectSummary[] | null
  languages: Language[]
  isAdmin: boolean
  myEmail: string
  isAdminRole: boolean
  onOpen: (id: string) => void
  onAdmin: () => void
  onError: (m: string) => void
  onRefresh: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [langPickFor, setLangPickFor] = useState<ProjectSummary | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  /** null = folders home; brand id = inside that brand's folder; '' = "Other". */
  const [folder, setFolder] = useState<string | null>(null)
  const dark = useIsDark()

  useEffect(() => {
    // Every active entity gets a folder, white labels included: a WL is itself
    // a marketing surface, so it owns landing pages exactly like a broker does.
    // (This is the folder axis — which entity a page belongs to. It is NOT the
    // brand picker, where a WL would never be offered.)
    listBrands().then((all) => setBrands(all.filter((b) => b.active !== false))).catch(() => {})
    listCampaigns().then(setCampaigns).catch(() => {})
  }, [])

  /** Card cover: the page's own hero image, else the attached campaign's hero. */
  const coverFor = (p: ProjectSummary): string | null =>
    p.cover_url ||
    (p.campaign_id
      ? campaigns.find((c) => c.campaign_id === p.campaign_id)?.hero_url ?? null
      : null)

  const brandIds = useMemo(() => new Set(brands.map((b) => b.id)), [brands])

  // One folder per registry entity (new ones appear automatically), plus
  // "Other" for pages whose entity is empty or no longer registered.
  const folders = useMemo(() => {
    const ps = projects ?? []
    const out = brands.map((b) => {
      const inFolder = ps.filter((p) => p.brand_id === b.id)
      return {
        id: b.id, name: b.name, brand: b, count: inFolder.length,
        latest: inFolder.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), ''),
      }
    })
    const other = ps.filter((p) => !p.brand_id || !brandIds.has(p.brand_id))
    if (other.length) {
      out.push({
        id: '', name: 'Other', brand: null as unknown as Brand, count: other.length,
        latest: other.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), ''),
      })
    }
    return out
  }, [brands, projects, brandIds])

  /** Folders grouped by registry category. A retired entity keeps its folder
   * only while it still holds pages, so history stays reachable without
   * cluttering the home view. "Other" is kind-less and trails the groups. */
  const folderGroups = useMemo(() => {
    const withBrand = folders.filter((f) => f.brand)
    const groups = ENTITY_KINDS.map((kind) => ({
      kind,
      label: kind === 'academy' ? 'Academies' : `${KIND_LABEL[kind]}s`,
      hint: KIND_HINT[kind],
      items: withBrand.filter(
        (f) => kindOf(f.brand) === kind && (f.brand.active !== false || f.count > 0),
      ),
    })).filter((g) => g.items.length > 0)
    const other = folders.filter((f) => !f.brand)
    return { groups, other }
  }, [folders])

  const folderBrand = folder ? brands.find((b) => b.id === folder) ?? null : null

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!projects || folder === null) return []
    let list = folder === ''
      ? projects.filter((p) => !p.brand_id || !brandIds.has(p.brand_id))
      : projects.filter((p) => p.brand_id === folder)
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.language.includes(q))
    }
    return list
  }, [projects, query, folder, brandIds])

  const langsInUse = useMemo(() => new Set((projects ?? []).map((p) => p.language)).size, [projects])

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div className="flex min-w-0 items-center gap-3">
          {folder !== null && (
            <Button variant="ghost" size="icon" onClick={() => { setFolder(null); setQuery('') }}
                    title="Back to brand folders" aria-label="Back to brand folders">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            {folder !== null ? (
              /* The logo IS the folder title — the name text only appears for
                 folders without a logo (Other / logo-less brands). */
              folderBrand?.logo_svg ? (
                <img
                  src={brandLogoSrc(folderBrand, dark)}
                  alt={folderBrand.name}
                  title={folderBrand.name}
                  className="h-9 max-w-48 object-contain object-left"
                />
              ) : (
                <h1 className="truncate font-display text-2xl font-bold tracking-tight">
                  {folderBrand?.name ?? 'Other'}
                </h1>
              )
            ) : (
              <h1 className="font-display text-2xl font-bold tracking-tight">Landing pages</h1>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {folder !== null
                ? `Landing pages in the ${folderBrand?.name ?? 'Other'} folder.`
                : 'One folder per broker, white label and academy — pick one to see its landing pages.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={onAdmin} title="Manage the section templates and languages">
              <Settings2 className="h-4 w-4" /> Templates
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>
            <FilePlus2 className="h-4 w-4" /> New landing page
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: 'Landing pages', value: projects?.length ?? '—', icon: Layout },
          { label: 'Folders', value: folders.length || '—', icon: FolderOpen },
          { label: 'Languages in use', value: projects ? langsInUse : '—', icon: Languages },
        ].map((s, i) => (
          <div
            key={s.label}
            className="animate-fade-up rounded-2xl border border-border bg-card p-4"
            style={{ animationDelay: `${60 + i * 70}ms` }}
          >
            <s.icon className="mb-2 h-4 w-4 text-primary" />
            <p className="font-display text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {folder === null ? (
        /* ------------------------- brand FOLDERS home ------------------------- */
        projects === null ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-7">
            {folderGroups.groups.map((g) => (
              <section key={g.kind}>
                <div className="mb-2.5 flex items-baseline gap-2">
                  <h2 className="font-display text-sm font-semibold">{g.label}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">{g.items.length}</span>
                  <span className="hidden text-xs text-muted-foreground/80 sm:inline">{g.hint}</span>
                </div>
                <FolderGrid folders={g.items} dark={dark} onOpen={setFolder} />
              </section>
            ))}
            {folderGroups.other.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-baseline gap-2">
                  <h2 className="font-display text-sm font-semibold text-muted-foreground">Other</h2>
                  <span className="hidden text-xs text-muted-foreground/80 sm:inline">
                    Pages whose entity is unset or no longer registered.
                  </span>
                </div>
                <FolderGrid folders={folderGroups.other} dark={dark} onOpen={setFolder} />
              </section>
            )}
          </div>
        )
      ) : (
      <>
      <div className="relative mb-4 animate-fade-up" style={{ animationDelay: '240ms' }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search landing pages…" className="pl-9" />
      </div>

      {projects === null ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">
          {query ? 'Nothing matches your search.' : 'This folder is empty — create its first landing page.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p, i) => {
            const mine = p.created_by.toLowerCase() === myEmail
            const canManage = mine || isAdminRole
            return (
              <div
                key={p.id}
                className="group animate-fade-up overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
                style={{ animationDelay: `${Math.min(i * 45, 450)}ms` }}
              >
                <button type="button" onClick={() => onOpen(p.id)} className="block w-full text-left" title="Open in the builder">
                  {coverFor(p) ? (
                    <img
                      src={coverFor(p)!}
                      alt=""
                      loading="lazy"
                      className="h-28 w-full bg-secondary object-cover"
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-gradient-to-br from-primary/15 via-secondary to-secondary">
                      <Layout className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <div className="p-3.5">
                    <p className="truncate font-display text-sm font-semibold">{p.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span className="uppercase">{p.language}</span>
                      {p.brand_id && <span>· {p.brand_id}</span>}
                      <span>· {p.sections} section{p.sections === 1 ? '' : 's'}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      by {formatUserName(p.created_by)} ·{' '}
                      {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <CardAction title="Duplicate" onClick={() => duplicateProject(p.id).then(onRefresh).catch((e) => onError(e.message))}>
                    <Copy className="h-3.5 w-3.5" />
                  </CardAction>
                  <CardAction title="Duplicate to another language" onClick={() => setLangPickFor(p)}>
                    <Globe className="h-3.5 w-3.5" />
                  </CardAction>
                  <CardAction
                    title="Export ZIP"
                    onClick={() => getProject(p.id).then(downloadExportZip).catch((e) => onError(e.message))}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </CardAction>
                  {canManage && (
                    <CardAction
                      title="Delete"
                      destructive
                      onClick={() => {
                        if (window.confirm(`Delete "${p.name}"?`)) {
                          deleteProject(p.id).then(onRefresh).catch((e) => onError(e.message))
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </CardAction>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </>
      )}

      {creating && (
        <NewLpModal
          languages={languages}
          presetBrandId={folder || undefined}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onOpen(id)
          }}
          onError={onError}
        />
      )}
      {langPickFor && (
        <LangDuplicateModal
          project={langPickFor}
          languages={languages}
          onClose={() => setLangPickFor(null)}
          onDone={() => {
            setLangPickFor(null)
            onRefresh()
          }}
          onError={onError}
        />
      )}
    </div>
  )
}

/** One category's folder cards, 5 across on a wide screen.
 *
 * The tile shows the entity's registry ICON — the same square mark as Settings >
 * Brands, so a folder is recognisable at a glance and every card reads the same.
 * It falls back to a wordmark (for an entity with only a logo) and then to a
 * generic folder. `dark` only matters for that wordmark path; icons carry their
 * own plate and are shown as-authored. */
function FolderGrid({
  folders,
  dark,
  onOpen,
}: {
  folders: { id: string; name: string; brand: Brand | null; count: number; latest: string }[]
  dark: boolean
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {folders.map((f, i) => {
        const accent = f.brand ? entityAccent(f.brand) ?? NEUTRAL_ACCENT : NEUTRAL_ACCENT
        const icon = f.brand?.icon_svg ? brandLogoUri(f.brand.icon_svg, false) : ''
        return (
          <button
            key={f.id || 'other'}
            type="button"
            onClick={() => onOpen(f.id)}
            className="group animate-fade-up overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
            style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            title={`Open the ${f.name} folder`}
          >
            <div
              className="flex h-16 items-center justify-center"
              // The entity's own colour, kept faint so the mark stays readable.
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
            >
              {icon ? (
                <img src={icon} alt="" className="h-10 w-10 rounded-md bg-white object-contain" />
              ) : f.brand?.logo_svg ? (
                <img src={brandLogoSrc(f.brand, dark)} alt="" className="h-7 max-w-28 object-contain" />
              ) : (
                <FolderOpen className="h-6 w-6 text-primary/50" />
              )}
            </div>
            <div className="p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                <span className="truncate font-display text-[13px] font-semibold">{f.name}</span>
              </div>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {f.count} page{f.count === 1 ? '' : 's'}
                {f.latest &&
                  ` · ${new Date(f.latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function CardAction({
  children,
  title,
  onClick,
  destructive,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent',
        destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function ModalShell({ label, children, onClose }: { label: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose}
              className="absolute inset-0 cursor-default bg-blue-950/70 backdrop-blur-md animate-fade-in" />
      <div role="dialog" aria-modal="true" aria-label={label}
           className="relative z-10 w-full max-w-xl animate-scale-in rounded-3xl border border-border bg-card p-7 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]">
        {children}
      </div>
    </div>,
    document.body,
  )
}

function NewLpModal({
  languages,
  presetBrandId,
  onClose,
  onCreated,
  onError,
}: {
  languages: Language[]
  /** Pre-selected brand when creating from inside a brand folder. */
  presetBrandId?: string
  onClose: () => void
  onCreated: (id: string) => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState(presetBrandId ?? '')
  const [language, setLanguage] = useState('en')
  const [campaignId, setCampaignId] = useState('')
  const [brands, setBrands] = useState<Brand[]>([])
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Same set as the folder home: a page can belong to any active entity,
    // white labels included. If this used brandOptions() a WL folder could
    // exist that no page could ever be created in.
    listBrands().then((all) => setBrands(all.filter((b) => b.active !== false))).catch(() => {})
    listCampaigns().then(setCampaigns).catch(() => {})
  }, [])

  // Attaching a campaign pre-selects the language from its market when we can
  // guess it (Malaysia -> ms, Thailand -> th, Japan -> ja, Sweden -> sv).
  function onCampaign(id: string) {
    setCampaignId(id)
    const market = (campaigns.find((c) => c.campaign_id === id)?.market || '').toLowerCase()
    const guess = market.includes('malay') ? 'ms' : market.includes('thai') ? 'th'
      : market.includes('japan') ? 'ja' : market.includes('swed') ? 'sv' : ''
    if (guess && languages.some((l) => l.code === guess)) setLanguage(guess)
  }

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const brand = brands.find((b) => b.id === brandId)
      const p = await createProject({
        name: name.trim(),
        brand_id: brandId || undefined,
        language,
        campaign_id: campaignId || undefined,
        tokens: brand ? brandTokens(brand) : undefined,
      })
      onCreated(p.id)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell label="New landing page" onClose={onClose}>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight">New landing page</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Pick the brand and the language — everything is editable later.</p>
        </div>
        <button type="button" onClick={onClose} title="Close" aria-label="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
               placeholder="Name — e.g. BrainTrade MY · July" aria-label="Landing page name" className="h-11 text-base" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Belongs to</span>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    aria-label="Belongs to">
              <option value="">Unassigned</option>
              {/* Grouped by registry category — 16 flat options reads as a wall. */}
              {ENTITY_KINDS.map((kind) => {
                const items = brands.filter((b) => kindOf(b) === kind)
                if (!items.length) return null
                return (
                  <optgroup key={kind} label={kind === 'academy' ? 'Academies' : `${KIND_LABEL[kind]}s`}>
                    {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                )
              })}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Language">
              {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">LP Materials campaign (optional — its assets appear in the builder)</span>
          <select value={campaignId} onChange={(e) => onCampaign(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Campaign">
            <option value="">No campaign</option>
            {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.name}</option>)}
          </select>
        </label>
        <Button size="lg" className="w-full" disabled={!name.trim() || saving} onClick={() => void create()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
          Create & open the builder
        </Button>
      </div>
    </ModalShell>
  )
}

function LangDuplicateModal({
  project,
  languages,
  onClose,
  onDone,
  onError,
}: {
  project: ProjectSummary
  languages: Language[]
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [lang, setLang] = useState(languages.find((l) => l.code !== project.language)?.code ?? 'en')
  const [saving, setSaving] = useState(false)
  return (
    <ModalShell label="Duplicate to language" onClose={onClose}>
      <h3 className="font-display text-lg font-bold tracking-tight">Duplicate “{project.name}”</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">
        Same layout, images and styling — the texts switch to the target language’s template defaults.
      </p>
      <div className="flex items-center gap-2">
        <select value={lang} onChange={(e) => setLang(e.target.value)}
                className="h-10 flex-1 rounded-md border border-input bg-transparent px-2 text-sm" aria-label="Target language">
          {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <Button
          disabled={saving}
          onClick={() => {
            setSaving(true)
            duplicateProject(project.id, { language: lang })
              .then(onDone)
              .catch((e) => onError(e.message))
              .finally(() => setSaving(false))
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
          Duplicate
        </Button>
      </div>
    </ModalShell>
  )
}

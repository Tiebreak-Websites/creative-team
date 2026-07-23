import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Globe,
  Languages,
  Layout,
  Loader2,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { FolderGrid } from '@/components/FolderGrid'
import { flagUrl } from '@/lib/flags'
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
  type EntityKind,
} from '../bannerBuilder/brandsApi'
import { searchCreatives } from '../bannerBuilder/campaignApi'
import { AdminTemplates } from './AdminTemplates'
import { Builder } from './Builder'
import {
  brandTokens,
  createProject,
  deleteProject,
  downloadExportZip,
  duplicateProject,
  getProject,
  getWriters,
  listProjects,
  listSections,
  saveProject,
  type Language,
  type ProjectSummary,
  type SectionDef,
  type Writer,
} from './api'

type View =
  | { kind: 'home' }
  | { kind: 'builder'; id: string }
  /** `editKey` opens that block's editor straight away, so the Add tab's pencil
   * lands on the block instead of the library index. */
  | { kind: 'admin'; editKey?: string }

export function LPBuilder() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Copywriters: text-only writer mode is forced and the home view is their
  // assigned-pages list (the server already filters /projects for them).
  const isCopywriter = user?.role === 'copywriter'
  const [view, setView] = useState<View>({ kind: 'home' })
  const [sections, setSections] = useState<SectionDef[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [libVersion, setLibVersion] = useState(0)

  useEffect(() => {
    // all=1: the Blocks admin needs to SEE deactivated blocks to offer
    // "Reactivate". The builder gets `sections.filter(s => s.enabled)` below,
    // so a disabled block still never reaches the Add tab.
    listSections(true)
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
          isAdmin={isAdmin}
          writerMode={isCopywriter}
          onManageBlocks={(blockKey) => setView({ kind: 'admin', editKey: blockKey })}
          onBack={() => setView({ kind: 'home' })}
          onError={setError}
        />
      ) : view.kind === 'admin' ? (
        <AdminTemplates
          sections={sections}
          languages={languages}
          initialEditKey={view.editKey}
          onBack={() => setView({ kind: 'home' })}
          onChanged={() => setLibVersion((v) => v + 1)}
          onError={setError}
        />
      ) : isCopywriter ? (
        <CopywriterHome
          projects={projects}
          languages={languages}
          onOpen={(id) => setView({ kind: 'builder', id })}
        />
      ) : (
        <Dashboard
          projects={projects}
          languages={languages}
          isAdmin={isAdmin}
          myEmail={(user?.email || '').toLowerCase()}
          isAdminRole={isAdmin}
          onOpen={(id) => setView({ kind: 'builder', id })}
          onError={setError}
          onRefresh={() => listProjects().then(setProjects).catch(() => {})}
        />
      )}
    </div>
  )
}

/** The page's Monday ID with one-click copy. It's the tracking key people
 * paste into Monday, so retyping it from a card was the common annoyance. */
function CopyId({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDone(true)
            window.setTimeout(() => setDone(false), 1200)
          })
          .catch(() => {})
      }}
      title={done ? 'Copied' : `Copy Monday ID ${value}`}
      aria-label={`Copy Monday ID ${value}`}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="truncate">#{value}</span>
      {done ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 shrink-0" />
      )}
    </button>
  )
}

/** A language as flag + name. The label is what makes a flag readable — a flag
 * alone is a guess, especially for the ones that share a palette. */
function LangChip({ code, languages }: { code: string; languages: Language[] }) {
  const label = languages.find((l) => l.code === code)?.label ?? code.toUpperCase()
  const url = flagUrl(code)
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      {url ? (
        <img src={url} alt="" className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
      ) : (
        <span className="text-[9px] font-semibold uppercase">{code}</span>
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}

/** Copy status as a chip — 'Copy ready' stands out, 'Draft' stays quiet. */
function StatusChip({ status }: { status?: 'draft' | 'copy_ready' }) {
  const ready = status === 'copy_ready'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        ready
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {ready && <Check className="h-3 w-3" />}
      {ready ? 'Copy ready' : 'Draft'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Copywriter home — the pages assigned to you, nothing else. The server
// already filters /projects to assignments; no create/duplicate/delete/export.
// ---------------------------------------------------------------------------
function CopywriterHome({
  projects,
  languages,
  onOpen,
}: {
  projects: ProjectSummary[] | null
  languages: Language[]
  onOpen: (id: string) => void
}) {
  const [brands, setBrands] = useState<Brand[]>([])
  useEffect(() => {
    listBrands().then(setBrands).catch(() => {})
  }, [])
  const list = useMemo(
    () => [...(projects ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [projects],
  )
  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-6 py-8">
      <div className="mb-6 animate-fade-up">
        <h1 className="font-display text-2xl font-bold tracking-tight">Your pages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Landing pages assigned to you — open one to write its copy.
        </p>
      </div>
      {projects === null ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Layout className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nothing assigned to you yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p.id)}
              title="Open in the writer"
              className="group animate-fade-up rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
              style={{ animationDelay: `${Math.min(i * 45, 450)}ms` }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-display text-sm font-semibold" title={p.name}>
                  {p.name}
                </p>
                <StatusChip status={p.status} />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {p.brand_id && (
                  <span className="truncate font-medium">
                    {brands.find((b) => b.id === p.brand_id)?.name ?? p.brand_id}
                  </span>
                )}
                <LangChip code={p.language} languages={languages} />
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                Updated{' '}
                {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </p>
            </button>
          ))}
        </div>
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
  onError,
  onRefresh,
}: {
  projects: ProjectSummary[] | null
  languages: Language[]
  isAdmin: boolean
  myEmail: string
  isAdminRole: boolean
  onOpen: (id: string) => void
  onError: (m: string) => void
  onRefresh: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [langPickFor, setLangPickFor] = useState<ProjectSummary | null>(null)
  const [assignFor, setAssignFor] = useState<ProjectSummary | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  /** null = folders home; brand id = inside that brand's folder; '' = "Other". */
  const [folder, setFolder] = useState<string | null>(null)
  const dark = useIsDark()

  useEffect(() => {
    listBrands().then(setBrands).catch(() => {})
  }, [])

  /** Card cover: the page's own hero image (first placed image). */
  const coverFor = (p: ProjectSummary): string | null => p.cover_url || null

  const brandIds = useMemo(() => new Set(brands.map((b) => b.id)), [brands])

  // One folder per registry entity (new ones appear automatically), plus
  // "Other" for pages whose entity is empty or no longer exists.
  //
  // Every kind gets folders, white labels included: a white label is itself a
  // marketing surface, so it owns landing pages exactly like a broker does.
  // That's why this reads the whole registry rather than brandOptions().
  //
  // A RETIRED entity keeps its folder only while it still holds pages — the
  // model hides retired entities from pickers but never stops historical work
  // rendering, and hiding the folder would strand those pages.
  const folders = useMemo(() => {
    const ps = projects ?? []
    const out = brands
      .map((b) => {
        const inFolder = ps.filter((p) => p.brand_id === b.id)
        return {
          id: b.id, name: b.name, brand: b, count: inFolder.length,
          latest: inFolder.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), ''),
        }
      })
      .filter((f) => f.brand.active !== false || f.count > 0)
    const other = ps.filter((p) => !p.brand_id || !brandIds.has(p.brand_id))
    if (other.length) {
      out.push({
        id: '', name: 'Other', brand: null as unknown as Brand, count: other.length,
        latest: other.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), ''),
      })
    }
    return out
  }, [brands, projects, brandIds])

  // The same folders, bucketed by registry category and rendered in
  // ENTITY_KINDS order. An empty category is dropped rather than shown empty.
  // "Other" has no entity, so it trails the categories in its own group.
  const folderGroups = useMemo(() => {
    const groups = ENTITY_KINDS.map((kind) => ({
      kind,
      items: folders.filter((f) => f.brand && kindOf(f.brand) === kind),
    })).filter((g) => g.items.length > 0)
    return { groups, other: folders.filter((f) => !f.brand) }
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
                    title="Back to all folders" aria-label="Back to all folders">
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
                : 'One folder per brand and white label — pick one to see its landing pages.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <div className="space-y-6">
            {folderGroups.groups.map(({ kind, items }) => (
              <section key={kind}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    {kind === 'academy' ? 'Academies' : `${KIND_LABEL[kind]}s`}
                  </h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
                  <span className="hidden text-xs text-muted-foreground/80 sm:inline">
                    {KIND_HINT[kind]}
                  </span>
                </div>
                <FolderGrid folders={items} dark={dark} onOpen={setFolder} />
              </section>
            ))}
            {folderGroups.other.length > 0 && (
              <section>
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="font-display text-sm font-semibold text-muted-foreground">Other</h3>
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
        <div
          /* Small tiles: the cover is square, so a wide card becomes a very tall
             one. Six across keeps a page scannable at a glance. */
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
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
                  {/* Square cover: the backend prefers the MOBILE hero, which is
                      already cropped narrow, so it fills the tile rather than
                      being letterboxed. */}
                  {coverFor(p) ? (
                    <img
                      src={coverFor(p)!}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full bg-secondary object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-primary/15 via-secondary to-secondary">
                      <Layout className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <div className="space-y-1 p-3">
                    <p className="truncate font-display text-sm font-semibold" title={p.name}>
                      {p.name}
                    </p>
                    {p.status === 'copy_ready' && (
                      <p>
                        <StatusChip status={p.status} />
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <LangChip code={p.language} languages={languages} />
                      <span className="truncate">
                        {p.sections} section{p.sections === 1 ? '' : 's'}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground/80">
                      by {formatUserName(p.created_by)} ·{' '}
                      {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </button>
                {p.monday_id && (
                  <div className="flex min-w-0 items-center gap-1.5 px-3 pb-2">
                    <CopyId value={p.monday_id} />
                    {p.monday_name && (
                      <span className="truncate text-[10px] text-muted-foreground" title={p.monday_name}>
                        {p.monday_name}
                      </span>
                    )}
                  </div>
                )}
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
                  <CardAction title="Assign to a copywriter" onClick={() => setAssignFor(p)}>
                    <UserPlus className="h-3.5 w-3.5" />
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
      {assignFor && (
        <AssignModal
          project={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={() => {
            setAssignFor(null)
            onRefresh()
          }}
          onError={onError}
        />
      )}
    </div>
  )
}

/** One category's folder tiles, 5 across on a wide screen.
 *
 * Drawn as an actual FOLDER — a tab sticking up behind the body — rather than a
 * card, so the shape itself says "this opens into something" before any label is
 * read. The tab is painted behind the opaque body, which hides the join and
 * makes the two read as one piece.
 *
 * The face carries the entity's registry favicon (the same square mark as
 * Settings > Brands), falling back to a wordmark for entities that have a logo
 * but no icon, then to a folder glyph. `dark` only matters on the wordmark path;
 * favicons carry their own plate and render as authored. */
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
function ModalShell({ label, children, onClose, maxWidth = 'max-w-xl' }: { label: string; children: React.ReactNode; onClose: () => void; maxWidth?: string }) {
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
           className={cn('relative z-10 max-h-[92vh] w-full animate-scale-in overflow-y-auto rounded-3xl border border-border bg-card p-7 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]', maxWidth)}>
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
  const [mondayId, setMondayId] = useState('')
  /** The Monday item's name (creative name), resolved from the id — attached
   *  to the project so every asset carries the id + name pair. */
  const [mondayName, setMondayName] = useState('')
  const [brandId, setBrandId] = useState(presetBrandId ?? '')
  const [language, setLanguage] = useState('en')
  const [brands, setBrands] = useState<Brand[]>([])
  const [writers, setWriters] = useState<Writer[]>([])
  const [assignTo, setAssignTo] = useState('')
  const [saving, setSaving] = useState(false)
  const dark = useIsDark()

  useEffect(() => {
    // Only active entities are offered — retired ones stay on old pages but
    // can't back a new one.
    listBrands().then((all) => setBrands(all.filter((b) => b.active !== false))).catch(() => {})
    getWriters().then(setWriters).catch(() => {})
  }, [])

  // Monday ID must be EXACTLY the placeholder's length — not fewer, not more.
  const mondayValid = mondayId.length === MONDAY_LEN
  const canCreate = name.trim() && mondayValid && !saving

  // Resolve the creative name from the Monday board as soon as the id is
  // complete — best-effort (a failed lookup never blocks creation).
  useEffect(() => {
    setMondayName('')
    if (!mondayValid) return
    let alive = true
    searchCreatives(mondayId)
      .then((items) => {
        const hit = items.find((c) => c.id === mondayId) ?? items[0]
        if (alive && hit) setMondayName(hit.name)
      })
      .catch(() => { /* Monday dormant or item unseen — id alone is fine */ })
    return () => { alive = false }
  }, [mondayId, mondayValid])
  // Active brands grouped by registry kind (broker / white label / academy),
  // all visible. Records without a kind default to broker.
  const kindOf = (b: Brand): EntityKind =>
    b.kind && (ENTITY_KINDS as string[]).includes(b.kind) ? b.kind : 'broker'

  async function create() {
    if (!canCreate) return
    setSaving(true)
    try {
      const brand = brands.find((b) => b.id === brandId)
      const p = await createProject({
        name: name.trim(),
        brand_id: brandId || undefined,
        language,
        monday_id: mondayId.trim() || undefined,
        monday_name: mondayName || undefined,
        tokens: brand ? brandTokens(brand) : undefined,
        assigned_to: assignTo || undefined,
      })
      onCreated(p.id)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell label="New landing page" onClose={onClose} maxWidth="max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight">New landing page</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Name it, add the Monday ID, pick the brand and language — all editable later.</p>
        </div>
        <button type="button" onClick={onClose} title="Close" aria-label="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Project name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                   placeholder="e.g. BrainTrade MY · July" aria-label="Landing page name" className="h-11 text-base" />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Monday ID <span className="text-destructive">*</span></span>
              <span className={cn('tabular-nums', mondayId.length > 0 && !mondayValid && 'font-semibold text-destructive')}>
                {mondayId.length}/{MONDAY_LEN}
              </span>
            </span>
            <Input
              value={mondayId}
              onChange={(e) => setMondayId(e.target.value.replace(/\D/g, '').slice(0, MONDAY_LEN))}
              inputMode="numeric"
              placeholder={MONDAY_PLACEHOLDER}
              aria-label="Monday ID"
              aria-invalid={mondayId.length > 0 && !mondayValid}
              className={cn('h-11 w-full text-base tabular-nums sm:w-44',
                            mondayId.length > 0 && !mondayValid && 'border-destructive focus-visible:border-destructive')}
            />
            {mondayId.length > 0 && !mondayValid && (
              <span className="mt-1 block text-[11px] text-destructive">Must be exactly {MONDAY_LEN} digits.</span>
            )}
            {mondayName && (
              <span className="mt-1 block max-w-56 truncate text-[11px] text-muted-foreground"
                    title={mondayName}>
                ↳ {mondayName}
              </span>
            )}
          </label>
        </div>

        {/* Brand — thumbnails grouped by registry kind (broker / white label /
            academy); every active entity is visible. */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Brand</span>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <BrandChoice active={brandId === ''} onClick={() => setBrandId('')} label="No brand" />
            </div>
            {ENTITY_KINDS.map((kind) => {
              const items = brands.filter((b) => kindOf(b) === kind)
              if (!items.length) return null
              return (
                <div key={kind}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {kind === 'academy' ? 'Academies' : `${KIND_LABEL[kind]}s`}
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {items.map((b) => (
                      <BrandChoice
                        key={b.id}
                        active={brandId === b.id}
                        onClick={() => setBrandId(b.id)}
                        label={b.name}
                        thumb={brandLogoUri(b.icon_svg, false) || brandLogoSrc(b, dark) || undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Language — every language visible, pick by country flag + name */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Language</span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {languages.map((l) => {
              const active = language === l.code
              const flag = flagUrl(l.code)
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setLanguage(l.code)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors',
                    active ? 'border-primary bg-primary/10 font-semibold text-foreground'
                           : 'border-border hover:border-foreground/30 hover:bg-accent',
                  )}
                >
                  {flag ? (
                    <img src={flag} alt="" className="h-4 w-6 shrink-0 rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />
                  ) : (
                    <span className="grid h-4 w-6 shrink-0 place-items-center rounded-[2px] bg-secondary text-[8px] font-bold uppercase">
                      {l.code}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Optional hand-off: the page lands in that copywriter's writer view. */}
        {writers.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Assign to copywriter <span className="text-muted-foreground/60">(optional)</span>
            </span>
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              aria-label="Assign to copywriter"
            >
              <option value="">No copywriter</option>
              {writers.map((w) => (
                <option key={w.email} value={w.email}>
                  {w.name ? `${w.name} — ${w.email}` : w.email}
                </option>
              ))}
            </select>
          </label>
        )}

        <Button size="lg" className="w-full" disabled={!canCreate} onClick={() => void create()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
          Create &amp; open the builder
        </Button>
      </div>
    </ModalShell>
  )
}

/** Monday ID is a fixed-length numeric id (the placeholder is the source of
 * truth for how many digits are required). */
const MONDAY_PLACEHOLDER = '3079506872'
const MONDAY_LEN = MONDAY_PLACEHOLDER.length

/** A brand choice tile in the New-LP modal — its square thumbnail (icon) with a
 * small name caption, or just the name when there's no thumbnail. */
function BrandChoice({
  active,
  onClick,
  label,
  thumb,
}: {
  active: boolean
  onClick: () => void
  label: string
  thumb?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-all',
        active ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
               : 'border-border hover:border-foreground/30 hover:bg-accent',
      )}
    >
      {thumb ? (
        <>
          <span className="grid h-11 w-full place-items-center">
            <img src={thumb} alt={label} className="max-h-11 max-w-full object-contain" />
          </span>
          <span className="w-full truncate text-center text-[10px] leading-tight text-muted-foreground">{label}</span>
        </>
      ) : (
        <span className="grid h-11 place-items-center truncate text-xs font-medium">{label}</span>
      )}
    </button>
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

/** Hand a page to a copywriter — pick from the writers list, or type any email
 * (the fallback for someone whose role isn't set yet). Saves via the normal
 * project save path. */
function AssignModal({
  project,
  onClose,
  onDone,
  onError,
}: {
  project: ProjectSummary
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [writers, setWriters] = useState<Writer[]>([])
  const [pick, setPick] = useState(project.assigned_to ?? '')
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    getWriters().then(setWriters).catch(() => {})
  }, [])
  const value = custom.trim() || pick
  return (
    <ModalShell label="Assign to a copywriter" onClose={onClose}>
      <h3 className="font-display text-lg font-bold tracking-tight">Assign “{project.name}”</h3>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">
        The copywriter sees this page in their writer view and fills in the copy.
      </p>
      <div className="space-y-2">
        <select
          value={pick}
          onChange={(e) => {
            setPick(e.target.value)
            setCustom('')
          }}
          className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          aria-label="Copywriter"
        >
          <option value="">Unassigned</option>
          {/* The current assignee stays visible even if their role changed. */}
          {project.assigned_to && !writers.some((w) => w.email === project.assigned_to) && (
            <option value={project.assigned_to}>{project.assigned_to}</option>
          )}
          {writers.map((w) => (
            <option key={w.email} value={w.email}>
              {w.name ? `${w.name} — ${w.email}` : w.email}
            </option>
          ))}
        </select>
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…or type an email"
          aria-label="Copywriter email"
        />
        <Button
          className="w-full"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            getProject(project.id)
              .then((p) => saveProject({ ...p, assigned_to: value || null }))
              .then(onDone)
              .catch((e) => onError(e.message))
              .finally(() => setSaving(false))
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {value ? 'Assign' : 'Clear assignment'}
        </Button>
      </div>
    </ModalShell>
  )
}

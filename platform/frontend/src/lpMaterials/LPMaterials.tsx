import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Download,
  DownloadCloud,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Minus,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  UserRound,
  LayoutGrid,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatUserName } from '@/lib/utils'
import { useAuth } from '../auth/AuthContext'
import {
  AVATAR_AGES,
  createAdvertorial,
  createAvatars,
  createCampaign,
  createCards,
  deleteCampaign,
  deleteJob,
  detectNames,
  getJob,
  itemUrl,
  listCampaigns,
  listJobs,
  regenerateItem,
  uploadReference,
  zipUrl,
  type AvatarRow,
  type AvatarStyle,
  type CampaignInfo,
  type MaterialItem,
  type MaterialJob,
} from './api'

type Section = 'customers' | 'cards' | 'advertorial'

const SECTIONS: { id: Section; label: string; desc: string; icon: ReactNode }[] = [
  { id: 'customers', label: 'Customers', desc: 'Profile photos', icon: <UserRound className="h-4 w-4" /> },
  { id: 'cards', label: 'Section cards', desc: 'Matching image set', icon: <LayoutGrid className="h-4 w-4" /> },
  { id: 'advertorial', label: 'Advertorial', desc: 'One story image', icon: <Newspaper className="h-4 w-4" /> },
]

const KIND_LABEL: Record<string, string> = {
  avatars: 'Customers',
  cards: 'Section cards',
  advertorial: 'Advertorial',
}

const STYLE_OPTIONS: { key: keyof AvatarStyle; label: string; hint?: string }[] = [
  { key: 'group_crop', label: 'Cropped from a group photo' },
  { key: 'low_quality', label: 'Phone-camera quality' },
  { key: 'candid', label: 'Unstaged / candid' },
  { key: 'degrade', label: 'Degrade for realism', hint: 'Downscale + JPEG artifacts after generation' },
  { key: 'flash', label: 'Direct flash' },
  { key: 'outdoor', label: 'Outdoor background' },
  { key: 'indoor', label: 'Home indoor background' },
  { key: 'dated', label: 'Slightly dated photo' },
]

const NO_STYLE: AvatarStyle = {
  group_crop: false,
  low_quality: false,
  candid: false,
  degrade: false,
  flash: false,
  outdoor: false,
  indoor: false,
  dated: false,
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * LP Materials — campaign-first. The home screen is a dashboard of CAMPAIGNS
 * (stats + search/filter/sort + the group grid). Opening one gives a two-column
 * workspace: the generator console on the left, this campaign's assets grouped
 * by category on the right.
 */
export function LPMaterials() {
  const [campaigns, setCampaigns] = useState<CampaignInfo[] | null>(null)
  const [active, setActive] = useState<CampaignInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const cs = await listCampaigns()
      setCampaigns(cs)
      setActive((a) => (a ? cs.find((c) => c.campaign_id === a.campaign_id) ?? a : a))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCampaigns((c) => c ?? [])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-background">
      {error && (
        <div
          role="alert"
          className="mx-auto mt-4 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {active ? (
        <CampaignWorkspace
          campaign={active}
          onBack={() => {
            setActive(null)
            void refresh()
          }}
          onDeleted={() => {
            setActive(null)
            void refresh()
          }}
          onError={setError}
        />
      ) : (
        <CampaignHome
          campaigns={campaigns}
          onOpen={setActive}
          onCreated={(c) => {
            setActive(c)
            void refresh()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Home — professional dashboard of campaign groups
// ---------------------------------------------------------------------------
type SortKey = 'newest' | 'name' | 'images'

function CampaignHome({
  campaigns,
  onOpen,
  onCreated,
  onError,
}: {
  campaigns: CampaignInfo[] | null
  onOpen: (c: CampaignInfo) => void
  onCreated: (c: CampaignInfo) => void
  onError: (e: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const stats = useMemo(() => {
    const cs = campaigns ?? []
    return {
      campaigns: cs.length,
      images: cs.reduce((a, c) => a + c.items, 0),
      generating: cs.filter((c) => c.generating).length,
    }
  }, [campaigns])

  const tags = useMemo(
    () => Array.from(new Set((campaigns ?? []).map((c) => c.tag).filter(Boolean))),
    [campaigns],
  )

  const visible = useMemo(() => {
    let cs = [...(campaigns ?? [])]
    const q = query.trim().toLowerCase()
    if (q) {
      cs = cs.filter((c) =>
        [c.name, c.tag, c.market].some((v) => (v || '').toLowerCase().includes(q)),
      )
    }
    if (tagFilter) cs = cs.filter((c) => c.tag === tagFilter)
    if (sort === 'name') cs.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'images') cs.sort((a, b) => b.items - a.items)
    else cs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return cs
  }, [campaigns, query, tagFilter, sort])

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      {/* ---- dashboard header ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight">LP Materials</h2>
          <p className="text-sm text-muted-foreground">
            Campaign folders for every landing page's creative assets.
          </p>
        </div>
        <div className="ml-auto">
          <Button size="lg" onClick={() => setCreating(true)}>
            <FolderPlus className="h-4 w-4" /> New campaign
          </Button>
        </div>
      </div>

      {/* ---- stats strip ---- */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatTile label="Campaigns" value={stats.campaigns} icon={<FolderPlus className="h-4 w-4" />} />
        <StatTile label="Images generated" value={stats.images} icon={<ImageIcon className="h-4 w-4" />} />
        <StatTile
          label="Generating now"
          value={stats.generating}
          icon={
            stats.generating > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )
          }
        />
      </div>

      {/* ---- toolbar ---- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search campaigns"
            placeholder="Search by name, tag or market…"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
          />
        </div>
        {tags.length > 0 && (
          <span className="flex items-center gap-1.5 overflow-x-auto">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTagFilter((cur) => (cur === t ? '' : t))}
                aria-pressed={tagFilter === t}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  tagFilter === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
                )}
              >
                <Tag className="h-3 w-3" /> {t}
              </button>
            ))}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort campaigns"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm transition-colors focus-visible:border-primary focus-visible:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="name">By name</option>
            <option value="images">Most images</option>
          </select>
        </span>
      </div>

      {creating && (
        <div className="mt-5">
          <NewCampaignCard onCancel={() => setCreating(false)} onCreated={onCreated} onError={onError} />
        </div>
      )}

      {/* ---- groups grid ---- */}
      <div className="mt-6">
        {campaigns === null ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
          </div>
        ) : visible.length === 0 && !creating ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {campaigns.length === 0
              ? 'No campaigns yet — create the first one from a landing page’s hero image.'
              : 'No campaigns match the current search/filter.'}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
            {visible.map((c) => (
              <button
                key={c.campaign_id}
                type="button"
                onClick={() => onOpen(c)}
                className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <span className="relative block aspect-[16/9] bg-muted/40">
                  {c.hero_url ? (
                    <img src={c.hero_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-muted-foreground">
                      <ImagePlus className="h-6 w-6" />
                    </span>
                  )}
                  {c.tag && (
                    <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow">
                      {c.tag}
                    </span>
                  )}
                  {c.generating && (
                    <span className="absolute right-2 top-2 rounded-full bg-background/90 p-1 shadow">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    </span>
                  )}
                </span>
                <span className="block space-y-1 px-3 py-2.5">
                  <span className="block truncate font-display text-sm font-semibold">{c.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.market ? `${c.market} · ` : ''}
                    {c.items} image{c.items === 1 ? '' : 's'}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground/80">
                    {c.created_by ? `by ${formatUserName(c.created_by)}` : ''}
                    {c.created_at ? ` · ${fmtWhen(c.created_at)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold leading-tight tabular-nums">{value}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  )
}

function NewCampaignCard({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void
  onCreated: (c: CampaignInfo) => void
  onError: (e: string) => void
}) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [market, setMarket] = useState('')
  const [hero, setHero] = useState<{ id: string; url: string } | null>(null)
  const [heroBusy, setHeroBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onUpload(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setHeroBusy(true)
    try {
      setHero(await uploadReference(f))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setHeroBusy(false)
    }
  }

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      onCreated(
        await createCampaign({
          name: name.trim(),
          tag: tag.trim() || undefined,
          market: market.trim() || undefined,
          reference: hero?.id,
        }),
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-sm animate-fade-up">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold">New campaign</h3>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel new campaign"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={heroBusy}
          title="Upload the landing page's hero image — it becomes the campaign's cover and style anchor"
          className={cn(
            'relative flex aspect-[16/9] w-full shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border transition-colors sm:w-56',
            hero
              ? 'border-primary/50'
              : 'border-dashed border-border bg-secondary/40 text-muted-foreground hover:border-primary/50 hover:text-foreground',
          )}
        >
          {hero ? (
            <img src={hero.url} alt="Hero" className="h-full w-full object-cover" />
          ) : heroBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <ImagePlus className="h-5 w-5" />
              <span className="text-[11px] font-medium">Hero image (cover)</span>
            </>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Upload the hero image"
          onChange={(e) => {
            void onUpload(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name — e.g. BrainTrade Q3 LP"
            aria-label="Campaign name"
          />
          <div className="relative">
            <Tag className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label="Campaign tag"
              placeholder="Tag — e.g. Malay"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
          </div>
          <div className="relative">
            <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              aria-label="Target market"
              placeholder="Target market — e.g. Malaysia"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
            />
          </div>
          <Button className="w-full" disabled={!name.trim() || saving} onClick={() => void create()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
            Create campaign
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campaign workspace — console LEFT, categorized assets RIGHT
// ---------------------------------------------------------------------------
function CampaignWorkspace({
  campaign,
  onBack,
  onDeleted,
  onError,
}: {
  campaign: CampaignInfo
  onBack: () => void
  onDeleted: () => void
  onError: (e: string) => void
}) {
  const { user } = useAuth()
  const myEmail = (user?.email || '').toLowerCase()
  const isAdmin = user?.role === 'admin'
  const [section, setSection] = useState<Section>('customers')
  const [jobs, setJobs] = useState<MaterialJob[] | null>(null)
  const [view, setView] = useState<{ job: MaterialJob; item: MaterialItem } | null>(null)
  const jobsRef = useRef<MaterialJob[] | null>(jobs)
  jobsRef.current = jobs

  const canModifyCampaign =
    (campaign.created_by || '').toLowerCase() === myEmail || isAdmin

  useEffect(() => {
    listJobs(campaign.campaign_id)
      .then(setJobs)
      .catch((e) => {
        onError(e instanceof Error ? e.message : String(e))
        setJobs([])
      })
  }, [campaign.campaign_id, onError])

  useEffect(() => {
    const iv = window.setInterval(async () => {
      const running = (jobsRef.current ?? []).filter((j) => j.status === 'running')
      if (!running.length) return
      const fresh = await Promise.all(running.map((j) => getJob(j.job_id).catch(() => null)))
      setJobs((prev) => (prev ?? []).map((j) => fresh.find((f) => f?.job_id === j.job_id) ?? j))
    }, 2500)
    return () => window.clearInterval(iv)
  }, [])

  function upsertJob(job: MaterialJob) {
    setJobs((prev) => [job, ...(prev ?? []).filter((j) => j.job_id !== job.job_id)])
  }

  const canModifyJob = (j: MaterialJob) =>
    j.created_by ? j.created_by.toLowerCase() === myEmail : isAdmin

  async function onDeleteJob(job: MaterialJob) {
    if (!window.confirm('Delete this generation and its images for everyone?')) return
    try {
      await deleteJob(job.job_id)
      setJobs((prev) => (prev ?? []).filter((j) => j.job_id !== job.job_id))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onRegenerate(job: MaterialJob, index: number) {
    try {
      upsertJob(await regenerateItem(job.job_id, index))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onDeleteCampaign() {
    if (!window.confirm(`Delete the campaign “${campaign.name}” and ALL its generations?`)) return
    try {
      await deleteCampaign(campaign.campaign_id)
      onDeleted()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      {/* top row: back + campaign identity */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Campaigns
        </Button>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="h-10 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40">
            {campaign.hero_url ? (
              <img src={campaign.hero_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-muted-foreground">
                <ImagePlus className="h-4 w-4" />
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-bold tracking-tight">
              {campaign.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {campaign.created_by ? `by ${formatUserName(campaign.created_by)}` : ''}
              {campaign.created_at ? ` · ${fmtWhen(campaign.created_at)}` : ''}
            </span>
          </span>
        </span>
        {campaign.tag && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            {campaign.tag}
          </span>
        )}
        {campaign.market && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium">
            <Globe className="h-3 w-3" /> {campaign.market}
          </span>
        )}
        {canModifyCampaign && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onDeleteCampaign()}
            title="Delete this campaign and all its generations"
            className="ml-auto text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* two columns: console left (with breathing room), assets right */}
      <div className="grid gap-6 lg:grid-cols-[minmax(360px,430px)_1fr]">
        <div className="min-w-0">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 grid grid-cols-3 gap-1.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-pressed={section === s.id}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors',
                    section === s.id
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                  )}
                >
                  {s.icon}
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="hidden text-[10px] leading-tight text-muted-foreground xl:block">
                    {s.desc}
                  </span>
                </button>
              ))}
            </div>

            {section === 'customers' && (
              <CustomersForm campaign={campaign} onStarted={upsertJob} onError={onError} />
            )}
            {section === 'cards' && (
              <CardsForm campaign={campaign} onStarted={upsertJob} onError={onError} />
            )}
            {section === 'advertorial' && (
              <AdvertorialForm campaign={campaign} onStarted={upsertJob} onError={onError} />
            )}
          </div>
        </div>

        <AssetsPanel
          jobs={jobs}
          canModifyJob={canModifyJob}
          onDeleteJob={(j) => void onDeleteJob(j)}
          onRegenerate={(j, i) => void onRegenerate(j, i)}
          onView={(job, item) => setView({ job, item })}
        />
      </div>

      {view && <ItemLightbox job={view.job} item={view.item} onClose={() => setView(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assets panel — this campaign's generations, grouped by category
// ---------------------------------------------------------------------------
const CATEGORIES: { kind: string; label: string; icon: ReactNode; comingSoon?: boolean }[] = [
  { kind: 'hero', label: 'Hero', icon: <ImageIcon className="h-4 w-4" />, comingSoon: true },
  { kind: 'avatars', label: 'Customers', icon: <UserRound className="h-4 w-4" /> },
  { kind: 'cards', label: 'Section cards', icon: <LayoutGrid className="h-4 w-4" /> },
  { kind: 'advertorial', label: 'Advertorial', icon: <Newspaper className="h-4 w-4" /> },
]

function AssetsPanel({
  jobs,
  canModifyJob,
  onDeleteJob,
  onRegenerate,
  onView,
}: {
  jobs: MaterialJob[] | null
  canModifyJob: (j: MaterialJob) => boolean
  onDeleteJob: (j: MaterialJob) => void
  onRegenerate: (j: MaterialJob, index: number) => void
  onView: (job: MaterialJob, item: MaterialItem) => void
}) {
  if (jobs === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading assets…
      </div>
    )
  }
  const empty = jobs.length === 0
  return (
    <div className="min-w-0 space-y-5">
      {CATEGORIES.map((cat) => {
        const catJobs = jobs.filter((j) => j.kind === cat.kind)
        const okCount = catJobs.reduce(
          (a, j) => a + j.items.filter((i) => i.status === 'ok').length,
          0,
        )
        return (
          <section key={cat.kind} className="rounded-2xl border border-border bg-card/40">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="text-primary">{cat.icon}</span>
              <span className="font-display text-sm font-bold tracking-tight">{cat.label}</span>
              {cat.comingSoon ? (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  coming soon
                </span>
              ) : (
                okCount > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
                    {okCount}
                  </span>
                )
              )}
            </div>
            <div className="border-t border-border px-4 py-3">
              {cat.comingSoon ? (
                <GhostRow icon={cat.icon} label="Hero variations will land here" />
              ) : catJobs.length === 0 ? (
                empty ? (
                  <GhostRow icon={cat.icon} label={`${cat.label} you generate will appear here`} />
                ) : (
                  <p className="py-1 text-xs text-muted-foreground">Nothing generated here yet.</p>
                )
              ) : (
                <div className="space-y-4">
                  {catJobs.map((job) => (
                    <JobBlock
                      key={job.job_id}
                      job={job}
                      canModify={canModifyJob(job)}
                      onDelete={() => onDeleteJob(job)}
                      onRegenerate={(i) => onRegenerate(job, i)}
                      onView={(item) => onView(job, item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Ghost placeholders shown while a category (or the whole campaign) is empty. */
function GhostRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/70 bg-secondary/20 text-muted-foreground/40"
          style={{ opacity: 0.9 - i * 0.25 }}
        >
          {icon}
        </span>
      ))}
      <span className="text-xs text-muted-foreground/70">{label}</span>
    </div>
  )
}

/** One generation inside a category: meta row + item tiles. */
function JobBlock({
  job,
  canModify,
  onDelete,
  onRegenerate,
  onView,
}: {
  job: MaterialJob
  canModify: boolean
  onDelete: () => void
  onRegenerate: (index: number) => void
  onView: (item: MaterialItem) => void
}) {
  const ok = job.items.filter((i) => i.status === 'ok').length
  const running = job.status === 'running'
  const square = job.kind === 'avatars'
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{fmtWhen(job.created_at)}</span>
        {job.created_by && <span>· {formatUserName(job.created_by)}</span>}
        <span>
          · {ok}/{job.items.length} ready
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {ok > 0 && (
            <a
              href={zipUrl(job.job_id)}
              title="Download this generation as a zip"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <DownloadCloud className="h-3.5 w-3.5" /> Zip
            </a>
          )}
          {canModify && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete this generation"
              aria-label="Delete this generation"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
        {job.items.map((it) => (
          <div key={it.index} className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className={cn('relative bg-muted/40', square ? 'aspect-square' : 'aspect-[4/3]')}>
              {it.status === 'ok' && it.url ? (
                <button
                  type="button"
                  onClick={() => onView(it)}
                  title="View full size"
                  aria-label={`View ${it.label} full size`}
                  className="block h-full w-full"
                >
                  <img
                    src={`${it.url}?t=${encodeURIComponent(job.updated_at)}`}
                    alt={it.label}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </button>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 p-2 text-center">
                  {it.status === 'failed' ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-[10px] text-destructive">{it.error || 'failed'}</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">
                        {it.status === 'running' ? 'Generating…' : 'Queued'}
                      </span>
                    </>
                  )}
                </div>
              )}
              {it.qa && (
                <span
                  title={it.qa}
                  className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-600 backdrop-blur dark:text-amber-400"
                >
                  <AlertTriangle className="h-2.5 w-2.5" /> text
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
              <span className="min-w-0 truncate text-[11px] font-medium" title={it.label}>
                {it.label}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {it.status === 'ok' && (
                  <a
                    href={itemUrl(job.job_id, it.index, true)}
                    title="Download PNG"
                    aria-label={`Download ${it.label}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Download className="h-3 w-3" />
                  </a>
                )}
                {canModify && it.status !== 'running' && it.status !== 'pending' && (
                  <button
                    type="button"
                    onClick={() => onRegenerate(it.index)}
                    title="Regenerate this image"
                    aria-label={`Regenerate ${it.label}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Full-size viewer for one generated image. */
function ItemLightbox({
  job,
  item,
  onClose,
}: {
  job: MaterialJob
  item: MaterialItem
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Image preview" className="fixed inset-0 z-[100] flex flex-col animate-fade-in">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/85 backdrop-blur-md"
      />
      <div className="relative z-10 flex items-center gap-3 px-5 py-3">
        <span className="font-display text-sm font-semibold text-white">{item.label}</span>
        <span className="text-xs text-white/60">{item.size} · {KIND_LABEL[job.kind] ?? job.kind}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={itemUrl(job.job_id, item.index, true)} download title="Download PNG">
              <Download className="h-4 w-4" /> Download
            </a>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="Close"
            aria-label="Close preview"
            className="h-8 w-8 text-white/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      </div>
      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <img
          src={`${itemUrl(job.job_id, item.index)}?t=${encodeURIComponent(job.updated_at)}`}
          alt={item.label}
          className="max-h-full max-w-full rounded-xl border border-white/10 object-contain shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {hint && <span className="text-[10px] text-muted-foreground/80">{hint}</span>}
    </div>
  )
}

function Toggle({
  on,
  onToggle,
  label,
  hint,
  disabled,
}: {
  on: boolean
  onToggle: () => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={hint}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        on ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          on ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            on ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  )
}

const SELECT_CLS =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20'

/** A customer row: the name field + its auto-detected, editable profile. */
interface CustomerDraft extends AvatarRow {
  _id: string
  /** the name value the current detection corresponds to */
  _detectedFor: string
  _detecting: boolean
}

let customerUid = 0
function blankCustomer(): CustomerDraft {
  customerUid += 1
  return {
    _id: `cu${customerUid}`,
    _detectedFor: '',
    _detecting: false,
    name: '',
    language: '',
    country: '',
    gender: 'female',
    age: '30s',
    look: '',
  }
}

function CustomersForm({
  campaign,
  onStarted,
  onError,
}: {
  campaign: CampaignInfo
  onStarted: (j: MaterialJob) => void
  onError: (e: string) => void
}) {
  const [rows, setRows] = useState<CustomerDraft[]>([blankCustomer()])
  const [style, setStyle] = useState<AvatarStyle>({ ...NO_STYLE })
  const [starting, setStarting] = useState(false)
  const market = campaign.market.trim()

  function patchRow(id: string, patch: Partial<CustomerDraft>) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  }

  /** Auto-detect fires when a name is committed (blur/Enter) and changed. */
  async function commitName(id: string) {
    const row = rows.find((r) => r._id === id)
    if (!row) return
    const name = row.name.trim()
    if (!name || name === row._detectedFor || row._detecting) return
    patchRow(id, { _detecting: true })
    try {
      const [d] = await detectNames([name], market || undefined)
      setRows((prev) =>
        prev.map((r) =>
          r._id === id
            ? {
                ...r,
                _detecting: false,
                _detectedFor: name,
                language: d?.language ?? r.language,
                country: d?.country || r.country || market,
                gender: d?.gender ?? r.gender,
                age: d?.age ?? r.age,
              }
            : r,
        ),
      )
    } catch (e) {
      // Fall back silently to market defaults; the fields stay editable.
      setRows((prev) =>
        prev.map((r) =>
          r._id === id
            ? { ...r, _detecting: false, _detectedFor: name, country: r.country || market }
            : r,
        ),
      )
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const ready = rows.filter((r) => r.name.trim())
  async function start() {
    if (!ready.length || starting) return
    setStarting(true)
    try {
      onStarted(
        await createAvatars(
          ready.map(({ _id, _detectedFor, _detecting, ...row }) => row),
          style,
          campaign.campaign_id,
        ),
      )
      setRows([blankCustomer()])
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  function stepAge(id: string, dir: -1 | 1) {
    setRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r
        const i = Math.max(0, Math.min(AVATAR_AGES.length - 1, AVATAR_AGES.indexOf(r.age) + dir))
        return { ...r, age: AVATAR_AGES[i] }
      }),
    )
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {market ? (
          <>
            Type a name — the profile fills in by itself. Customers look like the{' '}
            <b className="font-semibold text-primary">{market}</b> audience.
          </>
        ) : (
          'Type a name — the profile fills in by itself. Tip: set a target market on the campaign.'
        )}
      </p>

      <div className="space-y-2">
        <FieldLabel hint="any language">Customers</FieldLabel>
        {rows.map((r, i) => (
          <div key={r._id} className="space-y-2 rounded-xl border border-border bg-secondary/30 p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={r.name}
                onChange={(e) => patchRow(r._id, { name: e.target.value })}
                onBlur={() => void commitName(r._id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void commitName(r._id)
                  }
                }}
                placeholder="Trevor Hawkins"
                aria-label={`Customer ${i + 1} name`}
                className="h-8 w-44 rounded-md border border-input bg-background px-2.5 text-sm font-medium transition-colors placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
              />
              {r._detecting && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {r.language && !r._detecting && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {r.language}
                </span>
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((x) => x._id !== r._id))}
                  title="Remove"
                  aria-label={`Remove customer ${i + 1}`}
                  className="ml-auto text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {r._detectedFor && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {/* gender: two buttons, auto-selected by detection */}
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary p-0.5">
                    {(['female', 'male'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => patchRow(r._id, { gender: g })}
                        aria-pressed={r.gender === g}
                        className={cn(
                          'rounded-md px-2 py-1 text-[11px] font-semibold capitalize transition-colors',
                          r.gender === g
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                  {/* age: − band + stepper */}
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => stepAge(r._id, -1)}
                      disabled={r.age === AVATAR_AGES[0]}
                      title="Younger"
                      aria-label={`Younger age for ${r.name || 'customer'}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-display text-xs font-bold tabular-nums">{r.age}</span>
                    <button
                      type="button"
                      onClick={() => stepAge(r._id, 1)}
                      disabled={r.age === AVATAR_AGES[AVATAR_AGES.length - 1]}
                      title="Older"
                      aria-label={`Older age for ${r.name || 'customer'}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={r.country}
                    onChange={(e) => patchRow(r._id, { country: e.target.value })}
                    placeholder="Country"
                    aria-label={`Country for ${r.name || 'customer'}`}
                    className={SELECT_CLS}
                  />
                  <input
                    value={r.look ?? ''}
                    onChange={(e) => patchRow(r._id, { look: e.target.value })}
                    placeholder="Look — glasses, hijab…"
                    aria-label={`Look details for ${r.name || 'customer'}`}
                    className={SELECT_CLS}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {rows.length < 20 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed"
            onClick={() => setRows((prev) => [...prev, blankCustomer()])}
          >
            <Plus className="h-4 w-4" /> Add name
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <FieldLabel hint="nothing selected = clean, still realistic">Authenticity</FieldLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {STYLE_OPTIONS.map((o) => (
            <Toggle
              key={o.key}
              on={style[o.key]}
              onToggle={() => setStyle((s) => ({ ...s, [o.key]: !s[o.key] }))}
              label={o.label}
              hint={o.hint}
            />
          ))}
        </div>
      </div>

      <Button
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        size="lg"
        disabled={!ready.length || starting}
        onClick={() => void start()}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate {ready.length || ''} customer photo{ready.length === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

function CardsForm({
  campaign,
  onStarted,
  onError,
}: {
  campaign: CampaignInfo
  onStarted: (j: MaterialJob) => void
  onError: (e: string) => void
}) {
  const [cards, setCards] = useState([
    { title: '', text: '' },
    { title: '', text: '' },
    { title: '', text: '' },
    { title: '', text: '' },
  ])
  const [people, setPeople] = useState(true)
  const [samePerson, setSamePerson] = useState(false)
  const [aspect, setAspect] = useState('4:3')
  const [styleNote, setStyleNote] = useState('')
  const [starting, setStarting] = useState(false)

  const ready = cards.filter((c) => c.title.trim())
  async function start() {
    if (ready.length < 3 || starting) return
    setStarting(true)
    try {
      onStarted(
        await createCards({
          cards: ready.map((c) => ({ title: c.title.trim(), text: c.text.trim() })),
          same_person: people && samePerson,
          people,
          aspect,
          style_note: styleNote.trim() || undefined,
          campaign_id: campaign.campaign_id,
        }),
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {campaign.reference
          ? 'The set anchors to your hero image.'
          : 'Tip: add a hero image to the campaign so the set matches your LP.'}
        {campaign.market ? ` Localized to ${campaign.market}.` : ''}
      </p>
      <FieldLabel hint="images visualize the text — no text IN the image">Cards</FieldLabel>
      {/* horizontal card row */}
      <div className="flex gap-2 overflow-x-auto pb-1.5">
        {cards.map((c, i) => (
          <div key={i} className="w-52 shrink-0 space-y-1.5 rounded-xl border border-border bg-secondary/30 p-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary font-display text-[11px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              {cards.length > 3 && (
                <button
                  type="button"
                  onClick={() => setCards((prev) => prev.filter((_, j) => j !== i))}
                  title="Remove card"
                  aria-label={`Remove card ${i + 1}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Input
              value={c.title}
              onChange={(e) => setCards((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              placeholder="Title"
              aria-label={`Card ${i + 1} title`}
              className="h-8 text-xs"
            />
            <Textarea
              value={c.text}
              onChange={(e) => setCards((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              rows={2}
              placeholder="Sub text (optional)"
              aria-label={`Card ${i + 1} text`}
              className="resize-none overflow-hidden text-xs"
            />
          </div>
        ))}
        {cards.length < 6 && (
          <button
            type="button"
            onClick={() => setCards((prev) => [...prev, { title: '', text: '' }])}
            title="Add a card"
            aria-label="Add a card"
            className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="text-[10px]">Add</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Toggle
          on={people}
          onToggle={() => setPeople((v) => !v)}
          label="People in the photos"
          hint="Off = objects and environments only, no humans"
        />
        <Toggle
          on={people && samePerson}
          onToggle={() => setSamePerson((v) => !v)}
          disabled={!people}
          label="Same person across all images"
          hint="One persona appears in every scene"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Aspect</span>
        <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
          {['4:3', '1:1', '16:9'].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              aria-pressed={aspect === a}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                aspect === a ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <Input
        value={styleNote}
        onChange={(e) => setStyleNote(e.target.value)}
        placeholder="Style note (optional)"
        aria-label="Style note"
        className="h-8 text-xs"
      />
      <Button
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        size="lg"
        disabled={ready.length < 3 || starting}
        onClick={() => void start()}
        title={ready.length < 3 ? 'Fill in at least 3 card titles' : 'Generate the image set'}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate {ready.length} image{ready.length === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

function AdvertorialForm({
  campaign,
  onStarted,
  onError,
}: {
  campaign: CampaignInfo
  onStarted: (j: MaterialJob) => void
  onError: (e: string) => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [aspect, setAspect] = useState('4:3')
  const [people, setPeople] = useState(true)
  const [starting, setStarting] = useState(false)

  async function start() {
    if ((!title.trim() && !text.trim()) || starting) return
    setStarting(true)
    try {
      onStarted(
        await createAdvertorial({
          title: title.trim(),
          text: text.trim(),
          aspect,
          people,
          campaign_id: campaign.campaign_id,
        }),
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {campaign.reference
          ? 'The image anchors to your hero — same campaign world.'
          : 'Tip: add a hero image to the campaign so the image matches your LP.'}
        {campaign.market ? ` Localized to ${campaign.market}.` : ''}
      </p>
      <FieldLabel hint="the image tells the story — without any text in it">Advertorial block</FieldLabel>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Advertorial title"
        aria-label="Advertorial title"
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder="Paste the advertorial copy — the AI condenses it into its single strongest visual moment."
        aria-label="Advertorial text"
        className="text-sm"
      />
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Toggle
          on={people}
          onToggle={() => setPeople((v) => !v)}
          label="People in the photo"
          hint="Off = the story is told with objects and places only"
        />
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Aspect</span>
          <span className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            {['4:3', '1:1', '16:9'].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                aria-pressed={aspect === a}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  aspect === a ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {a}
              </button>
            ))}
          </span>
        </span>
      </div>
      <Button
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        size="lg"
        disabled={(!title.trim() && !text.trim()) || starting}
        onClick={() => void start()}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate image
      </Button>
    </div>
  )
}

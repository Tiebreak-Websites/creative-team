import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  DownloadCloud,
  FolderPlus,
  Globe,
  ImagePlus,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  ScanText,
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
  type CampaignInfo,
  type MaterialItem,
  type MaterialJob,
} from './api'

type Section = 'customers' | 'cards' | 'advertorial'

const SECTIONS: { id: Section; label: string; desc: string; icon: ReactNode; usesHero: boolean }[] = [
  {
    id: 'customers',
    label: 'Customers',
    desc: 'Profile photos — the market drives the look',
    icon: <UserRound className="h-4 w-4" />,
    usesHero: false,
  },
  {
    id: 'cards',
    label: 'Section cards',
    desc: 'An image set matching your hero',
    icon: <LayoutGrid className="h-4 w-4" />,
    usesHero: true,
  },
  {
    id: 'advertorial',
    label: 'Advertorial',
    desc: 'One story image beside long copy',
    icon: <Newspaper className="h-4 w-4" />,
    usesHero: true,
  },
]

const KIND_LABEL: Record<string, string> = {
  avatars: 'Customers',
  cards: 'Section cards',
  advertorial: 'Advertorial',
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * LP Materials — campaign-first. The home screen is the list of CAMPAIGNS
 * (cover = the hero image, plus name, tag, market, creator). Opening one gives
 * a centered console with the three generators and, below it, only that
 * campaign's generations. Click any image for a full-size view.
 */
export function LPMaterials() {
  const [campaigns, setCampaigns] = useState<CampaignInfo[] | null>(null)
  const [active, setActive] = useState<CampaignInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const cs = await listCampaigns()
      setCampaigns(cs)
      // Keep the open campaign's counters fresh.
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
// Campaign home — the groups
// ---------------------------------------------------------------------------
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
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="mb-6 text-center">
        <h2 className="font-display text-xl font-bold tracking-tight">LP Materials</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Every landing page is a <b className="font-semibold text-foreground">campaign</b> — its
          hero image is the cover, its market drives who appears in the visuals.
        </p>
      </div>

      {creating ? (
        <NewCampaignCard
          onCancel={() => setCreating(false)}
          onCreated={onCreated}
          onError={onError}
        />
      ) : (
        <div className="mb-6 flex justify-center">
          <Button size="lg" onClick={() => setCreating(true)}>
            <FolderPlus className="h-4 w-4" /> New campaign
          </Button>
        </div>
      )}

      {campaigns === null ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 && !creating ? (
        <p className="p-10 text-center text-sm text-muted-foreground">
          No campaigns yet — create the first one from a landing page's hero image.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {campaigns.map((c) => (
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
    <div className="mx-auto mb-8 w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-sm animate-fade-up">
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
// Campaign workspace — centered console + this campaign's results
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

  // Poll running jobs so items fill in live.
  useEffect(() => {
    const iv = window.setInterval(async () => {
      const running = (jobsRef.current ?? []).filter((j) => j.status === 'running')
      if (!running.length) return
      const fresh = await Promise.all(running.map((j) => getJob(j.job_id).catch(() => null)))
      setJobs((prev) =>
        (prev ?? []).map((j) => fresh.find((f) => f?.job_id === j.job_id) ?? j),
      )
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
    <div className="mx-auto w-full max-w-4xl px-5 py-6">
      {/* ---- campaign header ---- */}
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

      {/* ---- the big centered console ---- */}
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
              <span className="hidden text-[10px] leading-tight text-muted-foreground sm:block">
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

      {/* ---- this campaign's generations ---- */}
      <div className="mt-6 space-y-5">
        {jobs === null ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading generations…
          </div>
        ) : jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing generated in this campaign yet.
          </p>
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.job_id}
              job={job}
              canModify={canModifyJob(job)}
              onDelete={() => void onDeleteJob(job)}
              onRegenerate={(i) => void onRegenerate(job, i)}
              onView={(item) => setView({ job, item })}
            />
          ))
        )}
      </div>

      {view && (
        <ItemLightbox
          job={view.job}
          item={view.item}
          onClose={() => setView(null)}
        />
      )}
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
}: {
  on: boolean
  onToggle: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={hint}
      className={cn(
        'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
        on ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
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

function CustomersForm({
  campaign,
  onStarted,
  onError,
}: {
  campaign: CampaignInfo
  onStarted: (j: MaterialJob) => void
  onError: (e: string) => void
}) {
  const [namesText, setNamesText] = useState('')
  const [rows, setRows] = useState<AvatarRow[]>([])
  const [detecting, setDetecting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [style, setStyle] = useState({
    group_crop: true,
    low_quality: true,
    candid: true,
    degrade: true,
  })

  const names = namesText.split('\n').map((n) => n.trim()).filter(Boolean)
  const market = campaign.market.trim()

  function patchRow(i: number, patch: Partial<AvatarRow>) {
    setRows((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }

  async function detect() {
    if (!names.length || detecting) return
    setDetecting(true)
    try {
      setRows(await detectNames(names.slice(0, 20), market || undefined))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetecting(false)
    }
  }

  async function start() {
    if (!rows.length || starting) return
    setStarting(true)
    try {
      onStarted(await createAvatars(rows, style, campaign.campaign_id))
      setRows([])
      setNamesText('')
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
        {market ? (
          <>
            Customers will look like the{' '}
            <b className="font-semibold text-primary">{market}</b> audience — facing the
            camera with a natural slight smile, still authentically imperfect.
          </>
        ) : (
          'Tip: set a target market on the campaign — it decides the customers’ nationality.'
        )}{' '}
        The hero image is not used here.
      </p>
      <div className="space-y-1.5">
        <FieldLabel hint="one per line, any language">Customer names</FieldLabel>
        <Textarea
          value={namesText}
          onChange={(e) => setNamesText(e.target.value)}
          rows={3}
          placeholder={'สมชาย ใจดี\nMaria Silva\nAhmed Al-Farsi'}
          aria-label="Customer names, one per line"
          className="text-sm"
        />
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => void detect()}
        disabled={!names.length || detecting}
        title="Detect language, country, gender and age from each name"
      >
        {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
        {detecting ? 'Detecting…' : `Detect ${names.length || ''} name${names.length === 1 ? '' : 's'}`}
      </Button>

      {rows.length > 0 && (
        <div className="space-y-2">
          <FieldLabel hint="adjust anything before generating">Customer profiles</FieldLabel>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold" title={r.name}>
                  {r.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {r.language && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {r.language}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    title="Remove"
                    aria-label={`Remove ${r.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Country
                  </span>
                  <input
                    value={r.country}
                    onChange={(e) => patchRow(i, { country: e.target.value })}
                    aria-label={`Country for ${r.name}`}
                    className={SELECT_CLS}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Gender
                  </span>
                  <select
                    value={r.gender}
                    onChange={(e) => patchRow(i, { gender: e.target.value as AvatarRow['gender'] })}
                    aria-label={`Gender for ${r.name}`}
                    className={SELECT_CLS}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Age
                  </span>
                  <select
                    value={r.age}
                    onChange={(e) => patchRow(i, { age: e.target.value as AvatarRow['age'] })}
                    aria-label={`Age for ${r.name}`}
                    className={SELECT_CLS}
                  >
                    {AVATAR_AGES.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Look (optional)
                </span>
                <input
                  value={r.look ?? ''}
                  onChange={(e) => patchRow(i, { look: e.target.value })}
                  placeholder="e.g. glasses, hijab, short gray beard, office shirt…"
                  aria-label={`Look details for ${r.name}`}
                  className={SELECT_CLS}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel>Authenticity</FieldLabel>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Toggle on={style.group_crop} onToggle={() => setStyle((s) => ({ ...s, group_crop: !s.group_crop }))} label="Cropped from a group photo" />
          <Toggle on={style.low_quality} onToggle={() => setStyle((s) => ({ ...s, low_quality: !s.low_quality }))} label="Phone-camera quality" />
          <Toggle on={style.candid} onToggle={() => setStyle((s) => ({ ...s, candid: !s.candid }))} label="Candid, unstaged" />
          <Toggle on={style.degrade} onToggle={() => setStyle((s) => ({ ...s, degrade: !s.degrade }))} label="Degrade for realism" hint="Downscale + JPEG artifacts after generation" />
        </div>
      </div>

      <Button
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        size="lg"
        disabled={!rows.length || starting}
        onClick={() => void start()}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate {rows.length || ''} customer photo{rows.length === 1 ? '' : 's'}
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
          same_person: samePerson,
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
          ? 'The set anchors to your hero image — same palette, mood and style.'
          : 'Tip: add a hero image to the campaign so the set matches your LP.'}
        {campaign.market ? ` Cast and setting localize to ${campaign.market}.` : ''}
      </p>
      <FieldLabel hint="the image visualizes each card's text — no text IN the image">
        Section cards (one image each)
      </FieldLabel>
      {cards.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-xl border border-border bg-secondary/30 p-2.5">
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
            placeholder="Small text under the image (optional)"
            aria-label={`Card ${i + 1} text`}
            className="text-xs"
          />
        </div>
      ))}
      {cards.length < 6 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={() => setCards((prev) => [...prev, { title: '', text: '' }])}
        >
          <Plus className="h-4 w-4" /> Add card
        </Button>
      )}

      <Toggle
        on={samePerson}
        onToggle={() => setSamePerson((v) => !v)}
        label="Same person across all images"
        hint="One invented persona appears in every scene doing different things"
      />
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
        placeholder="Style note (optional) — e.g. warm, premium fintech look"
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
  const [candidates, setCandidates] = useState(2)
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
          candidates,
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
      <FieldLabel hint="the image tells the story — without any text in it">
        Advertorial block
      </FieldLabel>
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
      <div className="flex flex-wrap items-center gap-3">
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
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Candidates</span>
          <span className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCandidates(n)}
                aria-pressed={candidates === n}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  candidates === n ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {n}
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

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function JobCard({
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
  const when = useMemo(() => fmtWhen(job.created_at), [job.created_at])
  const square = job.kind === 'avatars'
  return (
    <section className="rounded-2xl border border-border bg-card/40">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3">
        <span className="font-display text-[15px] font-bold tracking-tight">
          {KIND_LABEL[job.kind] ?? job.kind}
        </span>
        {when && <span className="text-xs text-muted-foreground/80">· {when}</span>}
        {job.created_by && (
          <span className="text-xs text-muted-foreground/80" title={job.created_by}>
            · by {formatUserName(job.created_by)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>
            {ok}/{job.items.length} ready
          </span>
          {ok > 0 && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2.5">
              <a href={zipUrl(job.job_id)} title="Download every image as a zip">
                <DownloadCloud className="h-3.5 w-3.5" /> Zip
              </a>
            </Button>
          )}
          {canModify && (
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              title="Delete this generation and its images"
              className="h-7 gap-1 border-destructive/40 px-2.5 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      </div>
      <div className="border-t border-border px-4 py-4">
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
          {job.items.map((it) => (
            <div
              key={it.index}
              className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
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
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 p-3 text-center">
                    {it.status === 'failed' ? (
                      <>
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="text-[11px] text-destructive">{it.error || 'failed'}</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">
                          {it.status === 'running' ? 'Generating…' : 'Queued'}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {it.qa && (
                  <span
                    title={it.qa}
                    className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 backdrop-blur dark:text-amber-400"
                  >
                    <AlertTriangle className="h-3 w-3" /> text spotted
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1.5 border-t border-border px-2.5 py-2">
                <span className="min-w-0 truncate text-xs font-medium" title={it.label}>
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
                      <Download className="h-3.5 w-3.5" />
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
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

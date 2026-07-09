import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Download,
  DownloadCloud,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  ScanText,
  Sparkles,
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
  createAdvertorial,
  createAvatars,
  createCards,
  deleteJob,
  detectNames,
  getJob,
  itemUrl,
  listJobs,
  regenerateItem,
  zipUrl,
  type AvatarRow,
  type MaterialJob,
} from './api'

type Section = 'avatars' | 'cards' | 'advertorial'

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'avatars', label: 'Review avatars', icon: <UserRound className="h-4 w-4" /> },
  { id: 'cards', label: 'Section cards', icon: <LayoutGrid className="h-4 w-4" /> },
  { id: 'advertorial', label: 'Advertorial', icon: <Newspaper className="h-4 w-4" /> },
]

const KIND_LABEL: Record<string, string> = {
  avatars: 'Review avatars',
  cards: 'Section cards',
  advertorial: 'Advertorial',
}

/**
 * LP Materials — the small creative assets landing pages need: review avatars
 * (deliberately imperfect 1:1 profile photos), section-card image sets, and
 * advertorial images. Left rail = the three generators; center = the shared
 * results feed (jobs poll live while generating). No generated image contains
 * text — flagged by QA when the model slips.
 */
export function LPMaterials() {
  const { user } = useAuth()
  const myEmail = (user?.email || '').toLowerCase()
  const isAdmin = user?.role === 'admin'
  const [section, setSection] = useState<Section>('avatars')
  const [jobs, setJobs] = useState<MaterialJob[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const jobsRef = useRef<MaterialJob[]>(jobs)
  jobsRef.current = jobs

  useEffect(() => {
    listJobs()
      .then((j) => {
        setJobs(j)
        setLoaded(true)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoaded(true)
      })
  }, [])

  // Poll running jobs (2.5s) so items fill in live; refresh the shared list slowly.
  useEffect(() => {
    const iv = window.setInterval(async () => {
      const running = jobsRef.current.filter((j) => j.status === 'running')
      if (!running.length) return
      const fresh = await Promise.all(
        running.map((j) => getJob(j.job_id).catch(() => null)),
      )
      setJobs((prev) =>
        prev.map((j) => fresh.find((f) => f?.job_id === j.job_id) ?? j),
      )
    }, 2500)
    return () => window.clearInterval(iv)
  }, [])

  function upsertJob(job: MaterialJob) {
    setJobs((prev) => [job, ...prev.filter((j) => j.job_id !== job.job_id)])
  }

  const canModify = (j: MaterialJob) =>
    j.created_by ? j.created_by.toLowerCase() === myEmail : isAdmin

  async function onDelete(job: MaterialJob) {
    if (!window.confirm('Delete this job and its images for everyone?')) return
    try {
      await deleteJob(job.job_id)
      setJobs((prev) => prev.filter((j) => j.job_id !== job.job_id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onRegenerate(job: MaterialJob, index: number) {
    try {
      upsertJob(await regenerateItem(job.job_id, index))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* ---------------- Left rail: the three generators ---------------- */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border bg-card lg:w-[400px] lg:border-b-0 lg:border-r">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <h2 className="font-display text-sm font-bold tracking-tight">LP Materials</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Images for landing-page sections. Generated images never contain text —
              titles and copy live on the page.
            </p>
          </div>

          <div className="inline-flex w-full rounded-lg border border-border bg-secondary p-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-pressed={section === s.id}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  section === s.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.icon}
                <span className="hidden xl:inline">{s.label}</span>
              </button>
            ))}
          </div>

          {section === 'avatars' && <AvatarsForm onStarted={upsertJob} onError={setError} />}
          {section === 'cards' && <CardsForm onStarted={upsertJob} onError={setError} />}
          {section === 'advertorial' && <AdvertorialForm onStarted={upsertJob} onError={setError} />}
        </div>
      </aside>

      {/* ---------------- Center: results feed ---------------- */}
      <section className="min-h-[55vh] min-w-0 flex-1 overflow-y-auto bg-background lg:min-h-0">
        {error && (
          <div
            role="alert"
            className="m-4 mb-0 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="space-y-5 p-5">
          {!loaded ? (
            <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading materials…
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-[50vh] items-center justify-center">
              <div className="max-w-sm text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="font-display text-lg font-bold tracking-tight">
                  Your materials will appear here
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a generator on the left — review avatars, a section-card image set,
                  or an advertorial visual.
                </p>
              </div>
            </div>
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.job_id}
                job={job}
                canModify={canModify(job)}
                onDelete={() => void onDelete(job)}
                onRegenerate={(i) => void onRegenerate(job, i)}
              />
            ))
          )}
        </div>
      </section>
    </div>
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

function AvatarsForm({
  onStarted,
  onError,
}: {
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

  async function detect() {
    if (!names.length || detecting) return
    setDetecting(true)
    try {
      setRows(await detectNames(names.slice(0, 20)))
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
      onStarted(await createAvatars(rows, style))
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
      <div className="space-y-1.5">
        <FieldLabel hint="one per line, any language">Reviewer names</FieldLabel>
        <Textarea
          value={namesText}
          onChange={(e) => setNamesText(e.target.value)}
          rows={4}
          placeholder={'สมชาย ใจดี\nMaria Silva\nAhmed Al-Farsi'}
          aria-label="Reviewer names, one per line"
          className="text-sm"
        />
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => void detect()}
        disabled={!names.length || detecting}
        title="Detect the language, country and gender from each name"
      >
        {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
        {detecting ? 'Detecting…' : `Detect ${names.length || ''} name${names.length === 1 ? '' : 's'}`}
      </Button>

      {rows.length > 0 && (
        <div className="space-y-2">
          <FieldLabel hint="click to adjust">Detected — the look follows the name</FieldLabel>
          {rows.map((r, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold" title={r.name}>
                  {r.name}
                </span>
                {r.language && (
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {r.language}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={r.country}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)))
                  }
                  aria-label={`Country for ${r.name}`}
                  className="h-6 w-24 rounded border border-input bg-background px-1.5 text-[11px]"
                />
                <select
                  value={r.gender}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, gender: e.target.value as AvatarRow['gender'] } : x)),
                    )
                  }
                  aria-label={`Gender for ${r.name}`}
                  className="h-6 rounded border border-input bg-background px-1 text-[11px]"
                >
                  <option value="female">female</option>
                  <option value="male">male</option>
                </select>
                <select
                  value={r.age}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, age: e.target.value as AvatarRow['age'] } : x)),
                    )
                  }
                  aria-label={`Age for ${r.name}`}
                  className="h-6 rounded border border-input bg-background px-1 text-[11px]"
                >
                  {(['20s', '30s', '40s', '50s', '60s'] as const).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  title="Remove"
                  aria-label={`Remove ${r.name}`}
                  className="ml-auto text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel>Authenticity</FieldLabel>
        <Toggle on={style.group_crop} onToggle={() => setStyle((s) => ({ ...s, group_crop: !s.group_crop }))} label="Cropped from a group photo" />
        <Toggle on={style.low_quality} onToggle={() => setStyle((s) => ({ ...s, low_quality: !s.low_quality }))} label="Low quality / phone camera" />
        <Toggle on={style.candid} onToggle={() => setStyle((s) => ({ ...s, candid: !s.candid }))} label="Candid, not posing" />
        <Toggle on={style.degrade} onToggle={() => setStyle((s) => ({ ...s, degrade: !s.degrade }))} label="Degrade for realism (post-process)" hint="Downscale + JPEG artifacts + noise after generation" />
      </div>

      <Button
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        size="lg"
        disabled={!rows.length || starting}
        onClick={() => void start()}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate {rows.length || ''} avatar{rows.length === 1 ? '' : 's'}
      </Button>
    </div>
  )
}

function CardsForm({
  onStarted,
  onError,
}: {
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
      <FieldLabel hint="the image visualizes each card's text — no text IN the image">
        Section cards (one image each)
      </FieldLabel>
      {cards.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-xl border border-border bg-card p-2.5 shadow-sm">
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
  onStarted,
  onError,
}: {
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
      onStarted(await createAdvertorial({ title: title.trim(), text: text.trim(), aspect, candidates }))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3">
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
        rows={8}
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
}: {
  job: MaterialJob
  canModify: boolean
  onDelete: () => void
  onRegenerate: (index: number) => void
}) {
  const ok = job.items.filter((i) => i.status === 'ok').length
  const running = job.status === 'running'
  const when = useMemo(() => {
    const d = new Date(job.created_at)
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [job.created_at])
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
              title="Delete this job and its images"
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
                  <img
                    src={`${it.url}?t=${encodeURIComponent(job.updated_at)}`}
                    alt={it.label}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
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

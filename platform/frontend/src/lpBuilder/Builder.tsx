import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  Minus,
  Monitor,
  Plus,
  Redo2,
  Rows3,
  Smartphone,
  Tablet,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { brandLogoSrc, useIsDark } from '@/lib/brandLogo'
import { cn } from '@/lib/utils'
import { listBrands, type Brand } from '../bannerBuilder/brandsApi'
import { listCampaigns, listJobs, type CampaignInfo } from '../lpMaterials/api'
import { CampaignPicker } from '../lpMaterials/CampaignPicker'
import {
  brandTokens,
  composePage,
  DEVICE_BUCKET,
  DEVICE_WIDTH,
  downloadExportZip,
  getProject,
  importLpAsset,
  saveProject,
  uploadLpAsset,
  type Breakpoint,
  type Device,
  type Instance,
  type Language,
  type Project,
  type SectionDef,
  type SectionField,
} from './api'

interface Selection {
  iid: string
  fields: { kind: string; key: string }[]
  tag: string
}

let iidCounter = 0
const newIid = () => `i${Date.now().toString(36)}${(++iidCounter).toString(36)}`

const CATEGORY_LABEL: Record<string, string> = {
  braintrade: 'BrainTrade template', elements: 'Elements', hero: 'Hero',
  content: 'Content', 'social-proof': 'Social proof', conversion: 'Conversion',
  legal: 'Legal & footer',
}

// Windows Chromium renders emoji flags as bare letters, so use tiny PNGs
// (flagcdn is allowed by the CSP img-src https: whitelist; on failure the
// picker falls back to the language code).
const FLAG_CC: Record<string, string> = {
  en: 'gb', ms: 'my', th: 'th', ja: 'jp', sv: 'se', pt: 'br', es: 'es',
  vi: 'vn', it: 'it', pl: 'pl', fr: 'fr', de: 'de', ar: 'sa', zh: 'cn',
}
const flagUrl = (code: string) =>
  FLAG_CC[code] ? `https://flagcdn.com/w40/${FLAG_CC[code]}.png` : ''

/** Compact popover picker used for brand + language in the top bar. */
function TopPicker({
  trigger,
  title,
  children,
  open,
  setOpen,
}: {
  trigger: React.ReactNode
  title: string
  children: React.ReactNode
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-secondary px-2 transition-colors hover:border-foreground/25"
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-[60] max-h-72 w-52 animate-pop-in overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">
          {children}
        </div>
      )}
    </div>
  )
}

export function Builder({
  projectId,
  sections,
  languages,
  onBack,
  onError,
}: {
  projectId: string
  sections: SectionDef[]
  languages: Language[]
  onBack: () => void
  onError: (m: string) => void
}) {
  const [project, setProject] = useState<Project | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [preview, setPreview] = useState(false)
  // Layers is the working default — Add is for building the page up, Layers
  // for everything after.
  const [leftTab, setLeftTab] = useState<'add' | 'layers' | 'assets'>('layers')
  const [brands, setBrands] = useState<Brand[]>([])
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([])
  const [assets, setAssets] = useState<{ url: string; label: string }[]>([])
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [exporting, setExporting] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const dark = useIsDark()
  const [srcdoc, setSrcdoc] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const canvasLoadedRef = useRef(false)
  const canvasModeRef = useRef<'editor' | 'preview'>('editor')
  const [scale, setScale] = useState(0.5)
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  const [zoomMenu, setZoomMenu] = useState(false)
  const scaleRef = useRef(0.5)
  const zoomBoxRef = useRef<HTMLDivElement>(null)
  const zoomCtrlRef = useRef<HTMLDivElement>(null)
  const zoomFocusRef = useRef<{ ux: number; cx: number; innerTop?: number } | null>(null)
  const structuralRef = useRef(0)
  const [structural, setStructural] = useState(0)
  const lastScrollRef = useRef(0)
  const dragKeyRef = useRef<string | null>(null)
  const history = useRef<{ stack: string[]; idx: number; lastPush: number }>({ stack: [], idx: -1, lastPush: 0 })
  const skipSaveRef = useRef(true)

  const bucket: Breakpoint = DEVICE_BUCKET[device]
  const lib = useMemo(() => {
    const m = new Map<string, SectionDef>()
    sections.forEach((s) => m.set(s.key, s))
    return m
  }, [sections])

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    getProject(projectId)
      .then((p) => {
        setProject(p)
        history.current = { stack: [JSON.stringify(p)], idx: 0, lastPush: Date.now() }
        setStructural((v) => v + 1)
      })
      .catch((e) => onError(e.message))
    listBrands().then(setBrands).catch(() => {})
    listCampaigns().then(setCampaigns).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ---- campaign assets ------------------------------------------------------
  useEffect(() => {
    if (!project?.campaign_id) {
      setAssets([])
      return
    }
    const camp = campaigns.find((c) => c.campaign_id === project.campaign_id)
    const out: { url: string; label: string }[] = []
    if (camp?.hero_url) out.push({ url: camp.hero_url, label: 'Campaign hero' })
    listJobs(project.campaign_id)
      .then((jobs) => {
        for (const jb of jobs) {
          for (const it of jb.items) {
            if (it.url) out.push({ url: it.url, label: (it as { label?: string }).label || jb.kind })
          }
        }
        setAssets([...out])
      })
      .catch(() => setAssets(out))
  }, [project?.campaign_id, campaigns])

  // ---- history ---------------------------------------------------------------
  const pushHistory = useCallback((p: Project) => {
    const h = history.current
    const snap = JSON.stringify(p)
    const now = Date.now()
    if (h.idx >= 0 && now - h.lastPush < 800) {
      h.stack[h.idx] = snap // coalesce rapid typing
    } else {
      h.stack = h.stack.slice(0, h.idx + 1)
      h.stack.push(snap)
      if (h.stack.length > 50) h.stack.shift()
      h.idx = h.stack.length - 1
    }
    h.lastPush = now
    setCanUndo(h.idx > 0)
    setCanRedo(h.idx < h.stack.length - 1)
  }, [])

  const timeTravel = useCallback((dir: -1 | 1) => {
    const h = history.current
    const next = h.idx + dir
    if (next < 0 || next >= h.stack.length) return
    h.idx = next
    h.lastPush = 0
    const p = JSON.parse(h.stack[next]) as Project
    setProject(p)
    setCanUndo(h.idx > 0)
    setCanRedo(h.idx < h.stack.length - 1)
    setStructural((v) => v + 1)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        timeTravel(e.shiftKey ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timeTravel])

  /** Every mutation goes through here. structuralChange=false only for edits
   * the iframe ALREADY shows (inline typing) — everything else re-renders. */
  const mutate = useCallback(
    (fn: (p: Project) => Project, opts?: { structural?: boolean }) => {
      setProject((prev) => {
        if (!prev) return prev
        const next = fn(JSON.parse(JSON.stringify(prev)) as Project)
        pushHistory(next)
        if (opts?.structural !== false) setStructural((v) => v + 1)
        return next
      })
    },
    [pushHistory],
  )

  // ---- compose the canvas ----------------------------------------------------
  // First load (and every editor<->preview switch) sets srcdoc — a full
  // document load. Every edit AFTER that is applied IN PLACE via the runtime's
  // 'update' morph, so the canvas never reloads, never jumps to the top and
  // never flashes while you work.
  useEffect(() => {
    if (!project) return
    let alive = true
    const t = window.setTimeout(() => {
      const mode = preview ? 'preview' : 'editor'
      composePage(project, mode)
        .then((html) => {
          if (!alive) return
          const canMorph =
            mode === 'editor' && canvasModeRef.current === 'editor' && canvasLoadedRef.current &&
            !!iframeRef.current?.contentWindow
          if (canMorph) {
            iframeRef.current!.contentWindow!.postMessage({ type: 'update', html }, '*')
          } else {
            canvasModeRef.current = mode
            canvasLoadedRef.current = false
            setSrcdoc(html)
          }
        })
        .catch((e) => onError(e.message))
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structural, preview])

  // ---- autosave ---------------------------------------------------------------
  useEffect(() => {
    if (!project) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    setSaving('saving')
    const t = window.setTimeout(() => {
      saveProject(project)
        .then(() => setSaving('saved'))
        .catch((e) => {
          setSaving('idle')
          onError(e.message)
        })
    }, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // ---- iframe messages ----------------------------------------------------------
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const m = e.data
      if (!m || m.lp !== 1) return
      if (m.type === 'ready') {
        canvasLoadedRef.current = true
        iframeRef.current?.contentWindow?.postMessage({ type: 'scrollTo', y: lastScrollRef.current }, '*')
        if (selection) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'highlight', iid: selection.iid, key: selection.fields[0]?.key ?? null }, '*')
        }
      } else if (m.type === 'updated') {
        // in-place morph finished — restore the selection outline, nothing else
        if (selection) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'highlight', iid: selection.iid, key: selection.fields[0]?.key ?? null }, '*')
        }
      } else if (m.type === 'select') {
        setSelection(m.iid ? { iid: m.iid, fields: m.fields ?? [], tag: m.tag ?? '' } : null)
      } else if (m.type === 'text') {
        mutate((p) => {
          const inst = p.sections.find((s) => s.iid === m.iid)
          if (inst) inst.texts[m.key] = String(m.value ?? '')
          return p
        }, { structural: false })
      } else if (m.type === 'drop') {
        const key = dragKeyRef.current
        dragKeyRef.current = null
        if (key) addSection(key, m.index)
      } else if (m.type === 'dropImage') {
        if (m.iid && m.key && m.url) void assignImageTo(m.iid, m.key, m.url)
      } else if (m.type === 'sectionAction') {
        const iid = String(m.iid || '')
        if (!iid) return
        if (m.action === 'delete') {
          if (window.confirm('Remove this section?')) removeSection(iid)
        } else if (m.action === 'duplicate') {
          duplicateSection(iid)
        } else if (m.action === 'up' || m.action === 'down') {
          mutate((p) => {
            const i = p.sections.findIndex((s) => s.iid === iid)
            const j = m.action === 'up' ? i - 1 : i + 1
            if (i >= 0 && j >= 0 && j < p.sections.length) {
              const [s] = p.sections.splice(i, 1)
              p.sections.splice(j, 0, s)
            }
            return p
          })
        }
      } else if (m.type === 'scroll') {
        lastScrollRef.current = m.y || 0
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, mutate])

  // ---- canvas zoom ----------------------------------------------------------------
  // Default is Fit: auto-scale to the pane, re-measured on pane resize and
  // device switch. Any manual zoom (steppers, presets, Ctrl/Cmd+wheel) flips to
  // 'manual' and stays put until Fit is picked again in the zoom menu.
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])
  useEffect(() => {
    if (zoomMode !== 'fit') return
    const el = canvasRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - 40
      // Same floor as manual zoom — a degenerate pane must never yield scale≈0
      // (100/scale% heights explode).
      const s = Math.min(1, Math.max(0.1, w / DEVICE_WIDTH[device]))
      scaleRef.current = s
      setScale(s)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device, preview, zoomMode])

  /**
   * Zoom to `next`, keeping a focus point visually still. `cx` is the focus in
   * viewport coords (horizontal — the box recenters via mx-auto, corrected
   * after paint below); `innerY` anchors vertically INSIDE the iframe, whose
   * internal scroll is the page's vertical scroll (the box height is
   * pane-fixed, so the outer pane never scrolls vertically).
   */
  const zoomTo = useCallback((next: number, focus?: { cx?: number; innerY?: number }) => {
    const el = canvasRef.current
    const box = zoomBoxRef.current
    const prev = scaleRef.current
    const s = Math.min(2, Math.max(0.1, next))
    setZoomMode('manual')
    if (s === prev) return
    if (el && box) {
      const r = box.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const cx = focus?.cx ?? er.left + el.clientWidth / 2
      const f: { ux: number; cx: number; innerTop?: number } = { ux: (cx - r.left) / prev, cx }
      if (focus?.innerY !== undefined) {
        const se = iframeRef.current?.contentDocument?.scrollingElement
        if (se) f.innerTop = se.scrollTop + focus.innerY * (1 - prev / s)
      }
      zoomFocusRef.current = f
    }
    // Sync the ref NOW — rapid stepper clicks land in one tick, before the
    // post-paint effect would update it, and must compound rather than repeat.
    scaleRef.current = s
    setScale(s)
  }, [])
  // After the new scale paints, put the focused point back under the pointer.
  useLayoutEffect(() => {
    const f = zoomFocusRef.current
    if (!f) return
    zoomFocusRef.current = null
    const el = canvasRef.current
    const box = zoomBoxRef.current
    if (el && box) {
      const r = box.getBoundingClientRect()
      el.scrollLeft += r.left + f.ux * scale - f.cx
    }
    if (f.innerTop !== undefined) {
      const se = iframeRef.current?.contentDocument?.scrollingElement
      if (se) se.scrollTop = f.innerTop
    }
  }, [scale])

  // Ctrl/Cmd + wheel zooms — over the pane AND inside the canvas iframe (which
  // swallows wheel events; allow-same-origin lets us attach straight onto its
  // document, re-attached on every load since each srcdoc is a fresh document).
  const wheelZoom = useCallback(
    (e: WheelEvent, toParent?: (x: number, y: number) => { cx: number; innerY: number }) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      const p = toParent ? toParent(e.clientX, e.clientY) : { cx: e.clientX, innerY: undefined }
      zoomTo(scaleRef.current * factor, p)
    },
    [zoomTo],
  )
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const h = (e: WheelEvent) => wheelZoom(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [wheelZoom])
  const attachIframeWheel = useCallback(() => {
    const frame = iframeRef.current
    const doc = frame?.contentDocument
    if (!frame || !doc) return
    const h = (e: WheelEvent) =>
      wheelZoom(e, (x, y) => {
        const s = scaleRef.current
        return { cx: frame.getBoundingClientRect().left + x * s, innerY: y }
      })
    doc.addEventListener('wheel', h, { passive: false })
  }, [wheelZoom])

  // Close the zoom menu on outside click / Escape.
  useEffect(() => {
    if (!zoomMenu) return
    const onDown = (e: PointerEvent) => {
      if (!zoomCtrlRef.current?.contains(e.target as Node)) setZoomMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomMenu(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [zoomMenu])

  // ---- mutations --------------------------------------------------------------------
  function addSection(templateKey: string, index?: number) {
    if (!lib.has(templateKey)) return
    mutate((p) => {
      const inst: Instance = { iid: newIid(), template_key: templateKey, texts: {}, images: {}, links: {}, repeats: {}, props: {} }
      const at = index === undefined ? p.sections.length : Math.max(0, Math.min(p.sections.length, index))
      p.sections.splice(at, 0, inst)
      return p
    })
  }
  function removeSection(iid: string) {
    mutate((p) => {
      p.sections = p.sections.filter((s) => s.iid !== iid)
      return p
    })
    setSelection((s) => (s?.iid === iid ? null : s))
  }
  function duplicateSection(iid: string) {
    mutate((p) => {
      const i = p.sections.findIndex((s) => s.iid === iid)
      if (i >= 0) {
        const copy = JSON.parse(JSON.stringify(p.sections[i])) as Instance
        copy.iid = newIid()
        p.sections.splice(i + 1, 0, copy)
      }
      return p
    })
  }
  function moveSection(from: number, to: number) {
    mutate((p) => {
      const [s] = p.sections.splice(from, 1)
      p.sections.splice(to, 0, s)
      return p
    })
  }
  function setProp(iid: string, field: string, prop: string, value: string | boolean | null) {
    mutate((p) => {
      const inst = p.sections.find((s) => s.iid === iid)
      if (!inst) return p
      inst.props[field] = inst.props[field] ?? {}
      const bp = (inst.props[field][bucket] = inst.props[field][bucket] ?? {})
      if (value === null || value === '') delete bp[prop]
      else bp[prop] = value
      if (Object.keys(bp).length === 0) delete inst.props[field][bucket]
      return p
    })
  }
  function resetProps(iid: string, field: string) {
    mutate((p) => {
      const inst = p.sections.find((s) => s.iid === iid)
      if (inst?.props[field]) delete inst.props[field][bucket]
      return p
    })
  }
  function setPanelText(iid: string, key: string, value: string) {
    mutate((p) => {
      const inst = p.sections.find((s) => s.iid === iid)
      if (inst) inst.texts[key] = value
      return p
    })
  }
  /** Assign an image URL into a specific slot — imports sibling-tool images
   * into the LP asset store first so exports can bundle them. */
  async function assignImageTo(iid: string, key: string, url: string) {
    try {
      const local = url.startsWith('/api/tools/lp-builder/') ? { url } : await importLpAsset(url)
      mutate((p) => {
        const inst = p.sections.find((s) => s.iid === iid)
        if (inst) inst.images[key] = local.url
        return p
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }
  async function assignImage(url: string) {
    const sel = selection
    const imgField = sel?.fields.find((f) => f.kind === 'img')
    if (!sel || !imgField) return
    await assignImageTo(sel.iid, imgField.key, url)
  }
  async function uploadAndAssign(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    try {
      const up = await uploadLpAsset(f)
      setAssets((prev) => [{ url: up.url, label: f.name }, ...prev])
      const imgField = selection?.fields.find((x) => x.kind === 'img')
      if (imgField && selection) {
        mutate((p) => {
          const inst = p.sections.find((s) => s.iid === selection.iid)
          if (inst) inst.images[imgField.key] = up.url
          return p
        })
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const selInst = selection ? project.sections.find((s) => s.iid === selection.iid) ?? null : null
  const selDef = selInst ? lib.get(selInst.template_key) ?? null : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* ------------------------------- top bar ------------------------------- */}
      {/* relative z-40: backdrop-blur makes this bar a stacking context, so
          without a raised z-index the picker dropdowns paint UNDER the canvas
          (same trap as the v1.46.1 header dropdown). */}
      <div className="relative z-40 flex shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={onBack} title="Back to landing pages" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={project.name}
          onChange={(e) => mutate((p) => ({ ...p, name: e.target.value }), { structural: false })}
          className="h-8 w-56 min-w-32 max-w-md flex-1 font-display text-sm font-semibold"
          aria-label="Landing page name"
        />
        {/* Brand — shows the LOGO from the brands store (Settings ▸ Brands). */}
        <TopPicker
          open={brandOpen}
          setOpen={setBrandOpen}
          title={`Brand: ${brands.find((b) => b.id === project.brand_id)?.name ?? 'none'} — click to switch`}
          trigger={
            brandLogoSrc(brands.find((b) => b.id === project.brand_id), dark) ? (
              <img src={brandLogoSrc(brands.find((b) => b.id === project.brand_id), dark)} alt="" className="h-5 max-w-24 object-contain" />
            ) : (
              <span className="text-xs font-medium text-muted-foreground">
                {brands.find((b) => b.id === project.brand_id)?.name ?? 'Brand'}
              </span>
            )
          }
        >
          {[null, ...brands].map((b) => (
            <button
              key={b?.id ?? 'none'}
              type="button"
              onClick={() => {
                mutate((p) => ({ ...p, brand_id: b?.id ?? '', tokens: b ? brandTokens(b) : p.tokens }))
                setBrandOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                (b?.id ?? '') === project.brand_id && 'bg-primary/10 font-semibold',
              )}
            >
              {b && brandLogoSrc(b, dark) ? (
                <img src={brandLogoSrc(b, dark)} alt="" className="h-4 w-14 shrink-0 object-contain object-left" />
              ) : (
                <span className="inline-block h-4 w-14 shrink-0 rounded bg-secondary" />
              )}
              <span className="truncate">{b?.name ?? 'No brand'}</span>
            </button>
          ))}
        </TopPicker>
        {/* Language — flag + code, compact. */}
        <TopPicker
          open={langOpen}
          setOpen={setLangOpen}
          title={`Language: ${languages.find((l) => l.code === project.language)?.label ?? project.language} — click to switch`}
          trigger={
            <>
              {flagUrl(project.language) && (
                <img src={flagUrl(project.language)} alt="" className="h-3.5 w-5 rounded-[2px] object-cover" />
              )}
              <span className="text-xs font-bold uppercase">{project.language}</span>
            </>
          }
        >
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                mutate((p) => ({ ...p, language: l.code }))
                setLangOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                l.code === project.language && 'bg-primary/10 font-semibold',
              )}
            >
              {flagUrl(l.code) ? (
                <img src={flagUrl(l.code)} alt="" className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" />
              ) : (
                <span className="w-5 shrink-0 text-center text-[9px] font-bold uppercase">{l.code}</span>
              )}
              <span className="truncate">{l.label}</span>
              <span className="ml-auto text-[9px] uppercase text-muted-foreground">{l.code}</span>
            </button>
          ))}
        </TopPicker>
        <CampaignPicker
          campaigns={campaigns}
          value={project.campaign_id}
          onChange={(id) => mutate((p) => ({ ...p, campaign_id: id }), { structural: false })}
          onCreated={(c) => setCampaigns((cs) => [c, ...cs])}
          className="w-44 max-w-64 flex-1"
        />

        {/* Right cluster — device sizes + undo/redo stay pinned to the far right. */}
        <span className="ml-auto inline-flex items-center rounded-lg border border-border bg-secondary p-0.5">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => {
            const Icon = d === 'desktop' ? Monitor : d === 'tablet' ? Tablet : Smartphone
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                aria-pressed={device === d}
                title={`${d} · ${DEVICE_WIDTH[d]}px`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  device === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {DEVICE_WIDTH[d]}
              </button>
            )
          })}
        </span>

        <Button variant="ghost" size="icon" disabled={!canUndo} onClick={() => timeTravel(-1)} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" disabled={!canRedo} onClick={() => timeTravel(1)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>

        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {saving === 'saving' ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
          ) : saving === 'saved' ? (
            <><Check className="h-3 w-3 text-emerald-500" /> Saved</>
          ) : null}
        </span>
        <Button
          variant={preview ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setPreview((v) => !v)
            setSelection(null)
          }}
          title="Toggle preview (exactly the exported page)"
        >
          <Eye className="h-4 w-4" /> Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // flush any pending edits, then open the WORKING site in a new tab
            saveProject(project)
              .catch(() => {})
              .finally(() =>
                window.open(`/api/tools/lp-builder/projects/${project.id}/preview.html`, '_blank'))
          }}
          title="Open the working website in a new browser tab"
        >
          <ExternalLink className="h-4 w-4" /> Open
        </Button>
        <Button
          size="sm"
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            downloadExportZip(project)
              .catch((e) => onError(e.message))
              .finally(() => setExporting(false))
          }}
          title="Download the finished website (HTML + CSS + JS + assets)"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export
        </Button>
      </div>

      {/* ------------------------------- body ------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* left panel — widens while Add is active so 2-per-row thumbnails read well */}
        {!preview && (
          <div
            className={cn(
              'flex shrink-0 flex-col border-r border-border bg-card/60 transition-[width] duration-200',
              leftTab === 'add' ? 'w-96' : 'w-64',
            )}
          >
            <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border p-1.5">
              {([['add', 'Add', Plus], ['layers', 'Layers', Layers], ['assets', 'Assets', ImagePlus]] as const).map(
                ([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLeftTab(id)}
                    aria-pressed={leftTab === id}
                    className={cn(
                      'inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                      leftTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ),
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {leftTab === 'add' && (
                <AddTab
                  sections={sections}
                  brands={brands}
                  project={project}
                  onDragKey={(k) => (dragKeyRef.current = k)}
                  onAppend={(k) => addSection(k)}
                />
              )}
              {leftTab === 'layers' && (
                <LayersTab
                  project={project}
                  lib={lib}
                  bucket={bucket}
                  selection={selection}
                  onSelect={(iid, field) => {
                    setSelection({ iid, fields: field ? [field] : [], tag: field ? field.kind : 'section' })
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: 'highlight', iid, key: field?.key ?? null },
                      '*',
                    )
                  }}
                  onMove={moveSection}
                  onDuplicate={duplicateSection}
                  onRemove={removeSection}
                  onToggleHidden={(iid, hidden) => setProp(iid, '_section', 'hidden', hidden || null)}
                />
              )}
              {leftTab === 'assets' && (
                <AssetsTab assets={assets} selection={selection} onAssign={(u) => void assignImage(u)} onUpload={(f) => void uploadAndAssign(f)} />
              )}
            </div>
          </div>
        )}

        {/* canvas */}
        <div className="relative min-w-0 flex-1">
          <div ref={canvasRef} className="h-full w-full overflow-auto bg-secondary/40 p-5">
            <div ref={zoomBoxRef} className="mx-auto" style={{ width: DEVICE_WIDTH[device] * scale, height: `calc(100% - 4px)` }}>
              <div
                style={{
                  width: DEVICE_WIDTH[device],
                  height: `${100 / scale}%`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
                className="overflow-hidden rounded-xl border border-border bg-white shadow-2xl"
              >
                <iframe
                  ref={iframeRef}
                  title="Landing page canvas"
                  srcDoc={srcdoc}
                  onLoad={attachIframeWheel}
                  className="h-full w-full border-0"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </div>
          </div>
          {/* zoom control — sits on the pane wrapper, NOT inside the scroller,
              so it stays pinned bottom-right however far the canvas scrolls */}
          <div ref={zoomCtrlRef} className="absolute bottom-3 right-4 z-10">
            {zoomMenu && (
              <div className="absolute bottom-full right-0 mb-1.5 w-40 rounded-xl border border-border bg-popover p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setZoomMode('fit')
                    setZoomMenu(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent',
                    zoomMode === 'fit' ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Fit to pane
                  {zoomMode === 'fit' && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                {[0.5, 0.75, 1, 1.5, 2].map((z) => {
                  const active = zoomMode === 'manual' && Math.abs(scale - z) < 0.005
                  return (
                    <button
                      key={z}
                      type="button"
                      onClick={() => {
                        zoomTo(z)
                        setZoomMenu(false)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs tabular-nums transition-colors hover:bg-accent',
                        active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {Math.round(z * 100)}%
                      {active && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  )
                })}
                <p className="border-t border-border px-2.5 pb-1 pt-1.5 text-[10px] text-muted-foreground">
                  {DEVICE_WIDTH[device]}px canvas · Ctrl+scroll zooms
                </p>
              </div>
            )}
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-card/90 p-0.5 shadow backdrop-blur">
              <button
                type="button"
                onClick={() => zoomTo(scaleRef.current / 1.25)}
                title="Zoom out"
                aria-label="Zoom out"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMenu((v) => !v)}
                title={`Zoom — ${DEVICE_WIDTH[device]}px canvas`}
                aria-haspopup="menu"
                aria-expanded={zoomMenu}
                className="min-w-[3.5rem] rounded-full px-1.5 py-1 text-center text-[11px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {Math.round(scale * 100)}%{zoomMode === 'fit' ? ' · Fit' : ''}
              </button>
              <button
                type="button"
                onClick={() => zoomTo(scaleRef.current * 1.25)}
                title="Zoom in"
                aria-label="Zoom in"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* right panel */}
        {!preview && (
          <div className="flex w-72 shrink-0 flex-col border-l border-border bg-card/60">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selInst && selDef ? (
                <PropertiesPanel
                  inst={selInst}
                  def={selDef}
                  selection={selection!}
                  project={project}
                  bucket={bucket}
                  device={device}
                  onProp={(field, prop, v) => setProp(selInst.iid, field, prop, v)}
                  onResetField={(field) => resetProps(selInst.iid, field)}
                  onText={(key, v) => setPanelText(selInst.iid, key, v)}
                  onLink={(key, v) =>
                    mutate((p) => {
                      const i = p.sections.find((s) => s.iid === selInst.iid)
                      if (i) i.links[key] = v
                      return p
                    })
                  }
                  onRepeat={(key, n) =>
                    mutate((p) => {
                      const i = p.sections.find((s) => s.iid === selInst.iid)
                      if (i) i.repeats[key] = n
                      return p
                    })
                  }
                  onUpload={(f) => void uploadAndAssign(f)}
                  onDuplicate={() => duplicateSection(selInst.iid)}
                  onRemove={() => removeSection(selInst.iid)}
                />
              ) : (
                <PageSettings
                  project={project}
                  mutate={mutate}
                  assets={assets}
                  brandLogo={brandLogoSrc(brands.find((b) => b.id === project.brand_id), dark) || undefined}
                  onError={onError}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Left tabs
// ---------------------------------------------------------------------------
// Section thumbnails are real renders: each template composes server-side as a
// one-section page (same compositor as the canvas, current brand tokens +
// language) and paints in a tiny scripts-off iframe. Cached per template+theme
// so reopening a category is instant; the single-open accordion keeps at most
// one category's iframes alive.
const THUMB_W = 800 // compose viewport — tablet-ish styles, readable when scaled
const thumbCache = new Map<string, string>()

function thumbKey(defKey: string, p: Project) {
  const t = p.tokens || {}
  return [defKey, p.brand_id, p.language, t.primary, t.accent, t.bg, t.card].join('|')
}

function SectionThumb({ def, project }: { def: SectionDef; project: Project }) {
  const key = thumbKey(def.key, project)
  const [doc, setDoc] = useState<string | null>(() => thumbCache.get(key) ?? null)
  useEffect(() => {
    let gone = false
    const cached = thumbCache.get(key)
    if (cached !== undefined) {
      setDoc(cached)
      return
    }
    const stub = {
      id: 'thumb', name: def.name, brand_id: project.brand_id, language: project.language,
      campaign_id: '', tokens: project.tokens, form: { action_url: '', success_url: '' },
      fonts: 'system', meta_title: '', meta_description: '',
      sections: [{ iid: 'thumb0', template_key: def.key, texts: {}, images: {}, links: {}, repeats: {}, props: {} }],
    } as unknown as Project
    composePage(stub, 'preview')
      .then((html) => {
        thumbCache.set(key, html)
        if (!gone) setDoc(html)
      })
      .catch(() => {
        thumbCache.set(key, '')
        if (!gone) setDoc('')
      })
    return () => {
      gone = true
    }
  }, [key, def, project])
  return (
    <span className="pointer-events-none block h-20 overflow-hidden rounded-t-[11px] bg-white">
      {doc ? (
        <iframe
          title={`${def.name} preview`}
          srcDoc={doc}
          tabIndex={-1}
          aria-hidden
          scrolling="no"
          sandbox=""
          className="origin-top-left border-0"
          style={{ width: THUMB_W, height: THUMB_W, transform: 'scale(var(--thumb-scale))' }}
        />
      ) : (
        <span className="flex h-full items-center justify-center bg-secondary/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
        </span>
      )}
    </span>
  )
}

function AddTab({
  sections,
  brands,
  project,
  onDragKey,
  onAppend,
}: {
  sections: SectionDef[]
  brands: Brand[]
  project: Project
  onDragKey: (k: string) => void
  onAppend: (k: string) => void
}) {
  const dark = useIsDark()
  // Template groups are BRAND groups: a category matching a brand id gets the
  // brand's logo as its header. The top-bar brand SCOPES this tab: only that
  // brand's templates (plus the generic element categories) are offered.
  const brandFor = useCallback(
    (cat: string) =>
      brands.find((b) => b.id.toLowerCase() === cat.toLowerCase() || b.name.toLowerCase() === cat.toLowerCase()),
    [brands],
  )
  const activeBrand = brands.find((b) => b.id === project.brand_id)
  const cats = useMemo(() => {
    const by = new Map<string, SectionDef[]>()
    for (const s of [...sections].sort((a, b) => a.position - b.position)) {
      if (!by.has(s.category)) by.set(s.category, [])
      by.get(s.category)!.push(s)
    }
    let all = [...by.entries()]
    if (activeBrand) {
      all = all.filter(([cat]) => {
        const b = brandFor(cat)
        return !b || b.id === activeBrand.id
      })
    }
    // brand template groups float to the top, generic element categories after
    return all.sort((a, b) => Number(Boolean(brandFor(b[0]))) - Number(Boolean(brandFor(a[0]))))
  }, [sections, activeBrand, brandFor])

  // Single-open accordion. Opening one closes the other; switching the brand
  // opens its template group.
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [switcher, setSwitcher] = useState(false)
  const open = cats.some(([c]) => c === openCat) ? openCat : (cats[0]?.[0] ?? null)
  useEffect(() => {
    if (!activeBrand) return
    const own = cats.find(([c]) => brandFor(c)?.id === activeBrand.id)
    if (own) setOpenCat(own[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on brand switch
  }, [project.brand_id])

  const catLabel = (cat: string) => brandFor(cat)?.name ?? (CATEGORY_LABEL[cat] ?? cat)

  return (
    <div className="relative space-y-1.5" style={{ ['--thumb-scale' as string]: `${169 / THUMB_W}` }}>
      {/* sticky switcher — always shows which category is open */}
      <div className="sticky -top-2 z-10 -mx-1 rounded-lg border border-border bg-card/95 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setSwitcher((v) => !v)}
          aria-expanded={switcher}
          title="Switch category"
          className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
        >
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Showing</span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{open ? catLabel(open) : '—'}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', switcher && 'rotate-180')} />
        </button>
        {switcher && (
          <div className="border-t border-border p-1">
            {cats.map(([cat]) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setOpenCat(cat)
                  setSwitcher(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                  cat === open ? 'font-semibold' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {catLabel(cat)}
                {cat === open && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {cats.map(([cat, list]) => {
        const brand = brandFor(cat)
        const isOpen = cat === open
        return (
          <div key={cat} className="overflow-hidden rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setOpenCat(isOpen ? null : cat)}
              aria-expanded={isOpen}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors',
                isOpen ? 'bg-secondary/70' : 'bg-secondary/30 hover:bg-secondary/60',
              )}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
              {brand && brandLogoSrc(brand, dark) ? (
                <img src={brandLogoSrc(brand, dark)} alt="" className="h-4 max-w-20 object-contain object-left" />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                {brand ? brand.name : (CATEGORY_LABEL[cat] ?? cat)}
              </span>
              {brand && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">template</span>}
              <span className="rounded-full bg-secondary px-1.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
                {list.length}
              </span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-2 border-t border-border p-2">
                {list.map((s) => (
                  <div
                    key={s.key}
                    draggable
                    onDragStart={(e) => {
                      onDragKey(s.key)
                      e.dataTransfer.setData('text/lp-section', s.key)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className="group relative cursor-grab overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 active:cursor-grabbing"
                    title={`${s.name} — drag onto the page, or use ＋ to append`}
                  >
                    <SectionThumb def={s} project={project} />
                    <span className="block truncate border-t border-border px-2 py-1.5 text-[10px] font-medium">
                      {s.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAppend(s.key)}
                      className="absolute right-1 top-1 rounded-md border border-border bg-card/95 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                      title={`Append "${s.name}" to the page`}
                      aria-label={`Append ${s.name}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Figma-style layer tree: sections expand into their editable layers (texts,
// images, links, repeat groups → items). Clicking a layer selects it in the
// properties panel and flashes it on the canvas, exactly like a canvas click.
const FIELD_ICON: Record<SectionField['kind'], typeof Type> = {
  text: Type,
  rich: Type,
  img: ImageIcon,
  link: Link2,
}

function LayersTab({
  project,
  lib,
  bucket,
  selection,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  onToggleHidden,
}: {
  project: Project
  lib: Map<string, SectionDef>
  bucket: Breakpoint
  selection: Selection | null
  onSelect: (iid: string, field?: SectionField) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (iid: string) => void
  onRemove: (iid: string) => void
  onToggleHidden: (iid: string, hidden: boolean) => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set()) // expanded section iids
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set()) // `${iid}:${repeatKey}`
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  // Canvas (or anywhere) selects a section → reveal it: expand + scroll to it.
  useEffect(() => {
    const iid = selection?.iid
    if (!iid) return
    setOpen((prev) => (prev.has(iid) ? prev : new Set(prev).add(iid)))
    requestAnimationFrame(() => rowRefs.current.get(iid)?.scrollIntoView({ block: 'nearest' }))
  }, [selection?.iid])

  if (project.sections.length === 0) {
    return <p className="p-3 text-center text-xs text-muted-foreground">No sections yet — drag one in from the Add tab.</p>
  }

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  /** Layer label: live value if edited, else the template default, tags stripped. */
  const labelFor = (inst: Instance, def: SectionDef | undefined, key: string) => {
    const defaults = def ? { ...(def.texts.en ?? {}), ...(def.texts[project.language] ?? {}) } : {}
    const raw = inst.texts[key] ?? defaults[key] ?? ''
    const s = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return s
  }
  const fieldSelected = (iid: string, key: string) =>
    selection?.iid === iid && selection.fields[0]?.key === key

  const layerRow = (
    iid: string,
    field: SectionField,
    label: string,
    depth: number,
  ) => {
    const Icon = FIELD_ICON[field.kind] ?? Type
    return (
      <button
        key={`${iid}:${field.key}`}
        type="button"
        onClick={() => onSelect(iid, field)}
        title={label || field.key}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left transition-colors',
          depth > 1 ? 'pl-10' : 'pl-6',
          fieldSelected(iid, field.key)
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className="h-3 w-3 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate text-[11px]">{label || field.key}</span>
      </button>
    )
  }

  return (
    <div className="space-y-1">
      {project.sections.map((inst, i) => {
        const def = lib.get(inst.template_key)
        const hidden = Boolean(inst.props?._section?.[bucket]?.hidden)
        const kids = (def?.fields.length ?? 0) + (def?.repeats.length ?? 0)
        const expanded = open.has(inst.iid) && kids > 0
        return (
          <div key={inst.iid}>
            <div
              ref={(el) => {
                if (el) rowRefs.current.set(inst.iid, el)
                else rowRefs.current.delete(inst.iid)
              }}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) onMove(drag, i)
                setDrag(null)
              }}
              onClick={() => onSelect(inst.iid)}
              className={cn(
                'group flex cursor-pointer items-center gap-1 rounded-xl border px-1.5 py-1.5 transition-colors',
                selection?.iid === inst.iid && selection.fields.length === 0
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-foreground/25',
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((prev) => flip(prev, inst.iid))
                }}
                disabled={kids === 0}
                title={expanded ? 'Collapse layers' : 'Expand layers'}
                aria-label={expanded ? 'Collapse layers' : 'Expand layers'}
                aria-expanded={expanded}
                className={cn(
                  'rounded p-0.5 text-muted-foreground hover:text-foreground',
                  kids === 0 && 'invisible',
                )}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
              </button>
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" />
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-secondary font-display text-[9px] font-bold">
                {i + 1}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-xs', hidden && 'text-muted-foreground line-through')}>
                {def?.name ?? inst.template_key}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleHidden(inst.iid, !hidden)
                }}
                title={hidden ? `Show on ${bucket}` : `Hide on ${bucket}`}
                aria-label={hidden ? 'Show section' : 'Hide section'}
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
              >
                {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate(inst.iid)
                }}
                title="Duplicate section"
                aria-label="Duplicate section"
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm('Remove this section?')) onRemove(inst.iid)
                }}
                title="Remove section"
                aria-label="Remove section"
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {expanded && def && (
              <div className="mb-1 mt-0.5 space-y-px">
                {def.fields.map((f) => layerRow(inst.iid, f, labelFor(inst, def, f.key) || f.key, 1))}
                {def.repeats.map((r) => {
                  const gid = `${inst.iid}:${r.key}`
                  const gOpen = openGroups.has(gid)
                  const count = inst.repeats[r.key] ?? Math.max(1, countDefaults(def, project.language, r.key))
                  const firstField = r.fields[0]
                  return (
                    <div key={gid}>
                      <button
                        type="button"
                        onClick={() => setOpenGroups((prev) => flip(prev, gid))}
                        aria-expanded={gOpen}
                        className="flex w-full items-center gap-1.5 rounded-lg py-1 pl-3.5 pr-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', gOpen && 'rotate-90')} />
                        <Rows3 className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate text-[11px] capitalize">{r.key}</span>
                        <span className="rounded-full bg-secondary px-1.5 text-[9px] font-semibold tabular-nums">{count}</span>
                      </button>
                      {gOpen &&
                        firstField &&
                        Array.from({ length: count }, (_, idx) => {
                          const full = { ...firstField, key: `${r.key}.${idx}.${firstField.key}` }
                          const preview = labelFor(inst, def, full.key)
                          return layerRow(inst.iid, full, preview || `Item ${idx + 1}`, 2)
                        })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssetsTab({
  assets,
  selection,
  onAssign,
  onUpload,
}: {
  assets: { url: string; label: string }[]
  selection: Selection | null
  onAssign: (url: string) => void
  onUpload: (f: FileList | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const imgSelected = !!selection?.fields.some((f) => f.kind === 'img')
  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Upload an asset"
             onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
      <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
        <Upload className="h-4 w-4" /> Upload image
      </Button>
      <p className="px-1 text-[10px] leading-snug text-muted-foreground">
        <b>Drag an image onto any image slot</b> on the page
        {imgSelected ? ' — or click it to fill the selected slot.' : ' (slots highlight green while dragging).'}
      </p>
      {assets.length === 0 ? (
        <p className="p-2 text-center text-xs text-muted-foreground">
          No assets yet — attach a campaign in the top bar or upload an image.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {assets.map((a, i) => (
            <button
              key={`${a.url}:${i}`}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/lp-asset', a.url)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => imgSelected && onAssign(a.url)}
              className={cn(
                'cursor-grab overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-all',
                'hover:-translate-y-0.5 hover:border-primary/50 active:cursor-grabbing',
              )}
              title={`Drag "${a.label}" onto an image slot${imgSelected ? ' — or click to fill the selected one' : ''}`}
            >
              <span className="block aspect-square bg-muted/40">
                <img src={a.url} alt="" loading="lazy" className="pointer-events-none h-full w-full object-cover" />
              </span>
              <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right panel
// ---------------------------------------------------------------------------
function defaultText(def: SectionDef, lang: string, key: string): string {
  const t = { ...(def.texts.en ?? {}), ...(def.texts[lang] ?? {}) }
  if (t[key] !== undefined) return t[key]
  const m = /^([A-Za-z0-9_-]+)\.\d+\.(.+)$/.exec(key)
  if (m) return t[`${m[1]}.0.${m[2]}`] ?? ''
  return ''
}

function PropertiesPanel({
  inst,
  def,
  selection,
  project,
  bucket,
  device,
  onProp,
  onResetField,
  onText,
  onLink,
  onRepeat,
  onUpload,
  onDuplicate,
  onRemove,
}: {
  inst: Instance
  def: SectionDef
  selection: Selection
  project: Project
  bucket: Breakpoint
  device: Device
  onProp: (field: string, prop: string, v: string | boolean | null) => void
  onResetField: (field: string) => void
  onText: (key: string, v: string) => void
  onLink: (key: string, v: string) => void
  onRepeat: (key: string, n: number) => void
  onUpload: (f: FileList | null) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const textField = selection.fields.find((f) => f.kind === 'text' || f.kind === 'rich')
  const imgField = selection.fields.find((f) => f.kind === 'img')
  const linkField = selection.fields.find((f) => f.kind === 'link')
  const elementSelected = selection.fields.length > 0
  const field = textField?.key ?? imgField?.key ?? linkField?.key ?? '_section'
  const bp = (inst.props[field]?.[bucket] ?? {}) as Record<string, string | boolean>
  const overridden = bucket !== 'base' && Object.keys(bp).length > 0

  const prop = (name: string) => (bp[name] as string) ?? ''
  const P = ({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) => (
    <label className="block">
      <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        {label}
        {bucket !== 'base' && bp[name] !== undefined && <Dot />}
      </span>
      <input
        value={prop(name)}
        onChange={(e) => onProp(field, name, e.target.value || null)}
        placeholder={placeholder ?? '—'}
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
      />
    </label>
  )
  const ColorP = ({ label, name }: { label: string; name: string }) => (
    <label className="block">
      <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        {label}
        {bucket !== 'base' && bp[name] !== undefined && <Dot />}
      </span>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(prop(name)) ? prop(name) : '#000000'}
          onChange={(e) => onProp(field, name, e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-input bg-background p-0.5"
          aria-label={label}
        />
        <input
          value={prop(name)}
          onChange={(e) => onProp(field, name, e.target.value || null)}
          placeholder="inherit"
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
        />
      </span>
    </label>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate font-medium text-foreground">{def.name}</span>
        {elementSelected && (
          <>
            <span>/</span>
            <span className="truncate">{field}</span>
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[9px] font-semibold uppercase">
          {device}
          {overridden && <Dot />}
        </span>
      </div>
      {bucket !== 'base' && (
        <p className="rounded-lg border border-dashed border-border bg-secondary/40 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
          Editing the <b>{bucket}</b> breakpoint — changes apply at this width only.
          {overridden && (
            <button type="button" onClick={() => onResetField(field)} className="ml-1 font-semibold text-primary hover:underline">
              Reset to desktop
            </button>
          )}
        </p>
      )}

      {textField && (
        <div className="space-y-2.5">
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Text</span>
            <textarea
              value={inst.texts[textField.key] ?? defaultText(def, project.language, textField.key)}
              onChange={(e) => onText(textField.key, e.target.value)}
              rows={textField.kind === 'rich' ? 4 : 2}
              spellCheck
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:border-primary focus-visible:outline-none"
              aria-label="Element text"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <P label="Font size" name="fontSize" placeholder="56px" />
            <label className="block">
              <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">Weight{bucket !== 'base' && bp.fontWeight !== undefined && <Dot />}</span>
              <select
                value={prop('fontWeight')}
                onChange={(e) => onProp(field, 'fontWeight', e.target.value || null)}
                className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
                aria-label="Font weight"
              >
                <option value="">inherit</option>
                {['400', '500', '600', '700', '800'].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
          </div>
          <ColorP label="Color" name="color" />
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-secondary p-0.5">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onProp(field, 'align', prop('align') === a ? null : a)}
                aria-pressed={prop('align') === a}
                className={cn(
                  'rounded-md px-1.5 py-1 text-[10px] font-medium capitalize transition-colors',
                  prop('align') === a ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <P label="Margin top" name="marginTop" placeholder="0px" />
            <P label="Margin bottom" name="marginBottom" placeholder="0px" />
          </div>
        </div>
      )}

      {imgField && (
        <div className="space-y-2.5">
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Upload image"
                 onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
          {inst.images[imgField.key] && (
            <img src={inst.images[imgField.key]} alt="" className="max-h-28 w-full rounded-lg border border-border object-contain" />
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload image
          </Button>
          <p className="text-[10px] leading-snug text-muted-foreground">…or pick one in the <b>Assets</b> tab.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Fit</span>
              <select
                value={prop('fit')}
                onChange={(e) => onProp(field, 'fit', e.target.value || null)}
                className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
                aria-label="Object fit"
              >
                <option value="">default</option>
                <option value="cover">cover</option>
                <option value="contain">contain</option>
              </select>
            </label>
            <P label="Radius" name="radius" placeholder="16px" />
          </div>
          <P label="Height" name="height" placeholder="auto" />
        </div>
      )}

      {linkField && (
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Link (href)</span>
          <input
            value={inst.links[linkField.key] ?? ''}
            onChange={(e) => onLink(linkField.key, e.target.value)}
            placeholder="#signup"
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
            aria-label="Link target"
          />
        </label>
      )}

      {!elementSelected && (
        <div className="space-y-2.5">
          <ColorP label="Background" name="bg" />
          <div className="grid grid-cols-2 gap-2">
            <P label="Padding Y" name="padY" placeholder="96px" />
            <P label="Max width" name="maxWidth" placeholder="1140px" />
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-2.5 py-2">
            <span className="text-xs">Hidden on {device}</span>
            <input
              type="checkbox"
              checked={Boolean(bp.hidden)}
              onChange={(e) => onProp('_section', 'hidden', e.target.checked || null)}
              aria-label={`Hide section on ${device}`}
            />
          </label>
          {def.repeats.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Items</p>
              {def.repeats.map((r) => {
                const count = inst.repeats[r.key] ?? Math.max(1, countDefaults(def, project.language, r.key))
                return (
                  <div key={r.key} className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5">
                    <span className="text-xs capitalize">{r.key}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <button type="button" onClick={() => onRepeat(r.key, Math.max(1, count - 1))}
                              className="rounded-md border border-border p-1 hover:bg-accent" aria-label={`Fewer ${r.key}`}>
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center font-display text-xs font-bold">{count}</span>
                      <button type="button" onClick={() => onRepeat(r.key, Math.min(12, count + 1))}
                              className="rounded-md border border-border p-1 hover:bg-accent" aria-label={`More ${r.key}`}>
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1" onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 hover:border-destructive hover:text-destructive"
              onClick={() => window.confirm('Remove this section?') && onRemove()}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function countDefaults(def: SectionDef, lang: string, key: string): number {
  const t = { ...(def.texts.en ?? {}), ...(def.texts[lang] ?? {}) }
  let n = 0
  const rx = new RegExp(`^${key}\\.(\\d+)\\.`)
  for (const k of Object.keys(t)) {
    const m = rx.exec(k)
    if (m) n = Math.max(n, parseInt(m[1], 10) + 1)
  }
  return n || 3
}

const Dot = () => <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" title="Overridden at this breakpoint" />

function PageSettings({
  project,
  mutate,
  assets,
  brandLogo,
  onError,
}: {
  project: Project
  mutate: (fn: (p: Project) => Project, opts?: { structural?: boolean }) => void
  assets: { url: string; label: string }[]
  brandLogo?: string
  onError: (m: string) => void
}) {
  const set = (patch: Partial<Project>, structural = true) => mutate((p) => ({ ...p, ...patch }), { structural })
  const [tab, setTab] = useState<'page' | 'seo'>('page')
  const seo = useMemo(
    () => ({
      og_title: '', og_description: '', og_image: '', favicon: '',
      canonical: '', robots_index: true,
      ...(project.seo ?? {}),
    }),
    [project.seo],
  )
  const setSeo = (patch: Partial<typeof seo>) => set({ seo: { ...seo, ...patch } }, false)
  const [pickFor, setPickFor] = useState<'og_image' | 'favicon' | null>(null)
  async function pickAsset(url: string, field: 'og_image' | 'favicon') {
    setPickFor(null)
    try {
      const local = url.startsWith('/api/tools/lp-builder/') ? { url } : await importLpAsset(url)
      setSeo({ [field]: local.url } as Partial<typeof seo>)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }
  const title = project.meta_title || project.name
  const desc = project.meta_description

  if (tab === 'seo') {
    return (
      <div className="space-y-3">
        <PageSettingsTabs tab={tab} onTab={setTab} />
        <label className="block">
          <span className="mb-0.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
            Search title
            <span className={cn('tabular-nums', (project.meta_title || '').length > 60 && 'font-semibold text-destructive')}>
              {(project.meta_title || '').length}/60
            </span>
          </span>
          <input
            value={project.meta_title}
            onChange={(e) => set({ meta_title: e.target.value }, false)}
            placeholder={project.name}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
            aria-label="Search title"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
            Meta description
            <span className={cn('tabular-nums', desc.length > 160 && 'font-semibold text-destructive')}>{desc.length}/160</span>
          </span>
          <textarea
            value={project.meta_description}
            onChange={(e) => set({ meta_description: e.target.value }, false)}
            rows={3}
            placeholder="One or two sentences shown under the title in Google."
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:border-primary focus-visible:outline-none"
            aria-label="Meta description"
          />
        </label>
        {/* Google-style search preview */}
        <div className="rounded-lg border border-border bg-background p-2.5">
          <p className="truncate text-[13px] font-medium leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{title}</p>
          <p className="truncate text-[10px] text-[#006621] dark:text-[#99c794]">
            {seo.canonical || 'https://your-domain.com/'}
          </p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {desc || 'Add a meta description to control this text in search results.'}
          </p>
        </div>

        <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Social sharing</p>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Social title (og:title)</span>
          <input
            value={seo.og_title}
            onChange={(e) => setSeo({ og_title: e.target.value })}
            placeholder={title}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Social description (og:description)</span>
          <textarea
            value={seo.og_description}
            onChange={(e) => setSeo({ og_description: e.target.value })}
            rows={2}
            placeholder={desc || 'Falls back to the meta description.'}
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus-visible:border-primary focus-visible:outline-none"
          />
        </label>
        {/* Social card preview + image picker */}
        <div className="overflow-hidden rounded-lg border border-border">
          {seo.og_image ? (
            <img src={seo.og_image} alt="" className="aspect-[1.91/1] w-full bg-muted/40 object-cover" />
          ) : (
            <div className="grid aspect-[1.91/1] w-full place-items-center bg-secondary/60 text-[10px] text-muted-foreground">
              No social image (og:image) yet
            </div>
          )}
          <div className="border-t border-border bg-secondary/40 p-2">
            <p className="truncate text-[11px] font-semibold">{seo.og_title || title}</p>
            <p className="line-clamp-2 text-[10px] text-muted-foreground">{seo.og_description || desc || ' '}</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => setPickFor(pickFor === 'og_image' ? null : 'og_image')}>
            <ImagePlus className="h-3.5 w-3.5" /> {seo.og_image ? 'Change image' : 'Pick from assets'}
          </Button>
          {seo.og_image && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Remove social image" onClick={() => setSeo({ og_image: '' })}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {pickFor === 'og_image' && <AssetPickGrid assets={assets} onPick={(u) => void pickAsset(u, 'og_image')} />}

        <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Site basics</p>
        <div className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Favicon</span>
          <div className="flex items-center gap-1.5">
            {seo.favicon ? (
              <img src={seo.favicon} alt="" className="h-6 w-6 shrink-0 rounded border border-border bg-white object-contain p-0.5" />
            ) : (
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-dashed border-border text-[9px] text-muted-foreground">—</span>
            )}
            {brandLogo && (
              <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => void pickAsset(brandLogo, 'favicon')}>
                Use brand logo
              </Button>
            )}
            <Button variant="outline" size="sm" className={cn('h-7 text-xs', !brandLogo && 'flex-1')} onClick={() => setPickFor(pickFor === 'favicon' ? null : 'favicon')}>
              Pick…
            </Button>
            {seo.favicon && (
              <Button variant="ghost" size="sm" className="h-7 px-2" title="Remove favicon" onClick={() => setSeo({ favicon: '' })}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {pickFor === 'favicon' && <AssetPickGrid assets={assets} onPick={(u) => void pickAsset(u, 'favicon')} />}
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Canonical URL (the page's final address)</span>
          <input
            value={seo.canonical}
            onChange={(e) => setSeo({ canonical: e.target.value })}
            placeholder="https://your-domain.com/offer"
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
          />
        </label>
        <label className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-2.5 py-2">
          <span className="text-xs">Allow search engines to index</span>
          <input
            type="checkbox"
            checked={seo.robots_index !== false}
            onChange={(e) => setSeo({ robots_index: e.target.checked })}
            aria-label="Allow search engines to index"
          />
        </label>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <PageSettingsTabs tab={tab} onTab={setTab} />
      <label className="block">
        <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Brand primary</span>
        <span className="flex items-center gap-1.5">
          <input type="color" value={project.tokens.primary ?? '#E71E25'}
                 onChange={(e) => set({ tokens: { ...project.tokens, primary: e.target.value } })}
                 className="h-7 w-9 cursor-pointer rounded border border-input p-0.5" aria-label="Primary color" />
          <input type="color" value={project.tokens.accent ?? '#0A0F2E'}
                 onChange={(e) => set({ tokens: { ...project.tokens, accent: e.target.value } })}
                 className="h-7 w-9 cursor-pointer rounded border border-input p-0.5" aria-label="Accent color" />
          <span className="text-[10px] text-muted-foreground">primary · accent</span>
        </span>
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Website background · card fill</span>
        <span className="flex items-center gap-1.5">
          <input type="color" value={project.tokens.bg ?? '#FFFFFF'}
                 onChange={(e) => set({ tokens: { ...project.tokens, bg: e.target.value } })}
                 className="h-7 w-9 cursor-pointer rounded border border-input p-0.5" aria-label="Website background color" />
          <input type="color" value={project.tokens.card ?? '#FFFFFF'}
                 onChange={(e) => set({ tokens: { ...project.tokens, card: e.target.value } })}
                 className="h-7 w-9 cursor-pointer rounded border border-input p-0.5" aria-label="Card fill color" />
          <span className="text-[10px] text-muted-foreground">background · cards</span>
        </span>
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Form action URL (where signups POST)</span>
        <input
          value={project.form.action_url}
          onChange={(e) => set({ form: { ...project.form, action_url: e.target.value } })}
          placeholder="https://your-crm.example/lead"
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Success redirect (optional)</span>
        <input
          value={project.form.success_url}
          onChange={(e) => set({ form: { ...project.form, success_url: e.target.value } })}
          placeholder="https://…/thank-you"
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:border-primary focus-visible:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Fonts in the export</span>
        <select
          value={project.fonts}
          onChange={(e) => set({ fonts: e.target.value as Project['fonts'] })}
          className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
          aria-label="Fonts strategy"
        >
          <option value="system">System fonts (offline, fastest)</option>
          <option value="google">Google Fonts link (all scripts, needs internet)</option>
        </select>
      </label>
      <p className="rounded-lg border border-dashed border-border bg-secondary/40 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        Click any element on the page to edit it — double-click text to type directly. Use the device
        toggle to set per-width overrides. Titles, descriptions and social previews live in the <b>SEO</b> tab.
      </p>
    </div>
  )
}

function PageSettingsTabs({ tab, onTab }: { tab: 'page' | 'seo'; onTab: (t: 'page' | 'seo') => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary/40 p-0.5">
      {(['page', 'seo'] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTab(t)}
          aria-pressed={tab === t}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium transition-colors',
            tab === t ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t === 'page' ? 'Page' : 'SEO'}
        </button>
      ))}
    </div>
  )
}

/** Compact asset chooser used by the SEO tab (og:image / favicon). */
function AssetPickGrid({ assets, onPick }: { assets: { url: string; label: string }[]; onPick: (url: string) => void }) {
  if (assets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-2 py-1.5 text-[10px] text-muted-foreground">
        No assets yet — attach a campaign in the top bar or upload one in the Assets tab.
      </p>
    )
  }
  return (
    <div className="grid max-h-40 grid-cols-3 gap-1.5 overflow-y-auto rounded-lg border border-border p-1.5">
      {assets.map((a, i) => (
        <button
          key={`${a.url}:${i}`}
          type="button"
          onClick={() => onPick(a.url)}
          title={a.label}
          className="overflow-hidden rounded-md border border-border transition-all hover:border-primary/60"
        >
          <img src={a.url} alt="" loading="lazy" className="aspect-square w-full bg-muted/40 object-cover" />
        </button>
      ))}
    </div>
  )
}

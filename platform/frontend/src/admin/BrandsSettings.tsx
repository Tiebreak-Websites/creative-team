import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { cn } from '@/lib/utils'
import {
  academyOptions,
  createBrand,
  entityAccent,
  ENTITY_KINDS,
  KIND_HINT,
  KIND_LABEL,
  kindOf,
  listBrands,
  NEUTRAL_ACCENT,
  normaliseName,
  updateBrand,
  whitelabelOptions,
  type Brand,
  type BrandInput,
  type EntityKind,
} from '../bannerBuilder/brandsApi'

/** ~1.2MB cap on an uploaded logo — a data: URI is ~1.37x the file bytes and the
 * backend caps the stored string at ~2MB, so this stays comfortably under. */
const MAX_LOGO_BYTES = 1_200_000

interface BrandDraft {
  id?: string
  name: string
  kind: EntityKind
  active: boolean
  colors: string[]
  icon_svg: string | null
  logo_svg: string | null
  logo_svg_dark: string | null
  font: string
  accent: string | null
  voice: string
}

const EMPTY_DRAFT: BrandDraft = {
  name: '',
  kind: 'broker',
  active: true,
  colors: [],
  icon_svg: null,
  logo_svg: null,
  logo_svg_dark: null,
  font: '',
  accent: null,
  voice: '',
}

const draftOf = (b: Brand): BrandDraft => ({
  id: b.id,
  name: b.name,
  kind: kindOf(b),
  active: b.active !== false,
  colors: b.colors ?? [],
  icon_svg: b.icon_svg ?? null,
  logo_svg: b.logo_svg ?? null,
  logo_svg_dark: b.logo_svg_dark ?? null,
  font: b.font ?? '',
  accent: b.accent ?? null,
  voice: b.voice ?? '',
})

/**
 * Brand / White label / Academy registry (admin Settings surface — already
 * admin-gated in App.tsx, and every write is admin-gated on the backend too).
 *
 * This registry is the single source of truth: every picker and filter in the
 * app derives from `kind`, and nothing infers the vocabulary from values found
 * on existing records (which would turn a typo into a permanent option).
 * Entities are RETIRED, never deleted, so historical records keep rendering.
 */
export function BrandsSettings() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BrandDraft | null>(null)

  async function refresh() {
    setError(null)
    try {
      setBrands(await listBrands())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** Retire / restore. Retiring keeps the record so anything historical that
   * references it still renders; it just leaves every picker. */
  async function setActive(brand: Brand, active: boolean) {
    try {
      await updateBrand(brand.id, { active })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Buckets mirror the model exactly: an academy appears in its own bucket AND
  // is selectable everywhere a broker is — brandOptions() includes it.
  const live = brands.filter((b) => b.active !== false)
  const buckets: { kind: EntityKind; items: Brand[] }[] = [
    { kind: 'broker', items: live.filter((b) => kindOf(b) === 'broker') },
    { kind: 'whitelabel', items: whitelabelOptions(live) },
    { kind: 'academy', items: academyOptions(live) },
  ]
  const retired = brands.filter((b) => b.active === false)

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Brands</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The registry every picker reads from. A <b className="font-semibold text-foreground">broker</b>{' '}
            is the product being sold; a <b className="font-semibold text-foreground">white label</b> is a
            surface that routes traffic to one; an{' '}
            <b className="font-semibold text-foreground">academy</b> sells education — it picks like a
            broker everywhere, and is grouped separately only for reporting.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
            <Plus className="h-4 w-4" /> Add entity
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading registry…
        </div>
      ) : brands.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing registered yet — add your first entity.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {buckets.map(({ kind, items }) => (
            <section key={kind}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="font-display text-sm font-semibold text-foreground">
                  {kind === 'academy' ? 'Academies' : `${KIND_LABEL[kind]}s`}
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
                <span className="text-xs text-muted-foreground/80">{KIND_HINT[kind]}</span>
              </div>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  None yet.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((brand) => (
                    <BrandCard
                      key={brand.id}
                      brand={brand}
                      onEdit={() => setEditing(draftOf(brand))}
                      onRetire={() => void setActive(brand, false)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          {retired.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="font-display text-sm font-semibold text-muted-foreground">Retired</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{retired.length}</span>
                <span className="text-xs text-muted-foreground/80">
                  Hidden from every picker; kept so historical records still render.
                </span>
              </div>
              <div className="grid gap-3 opacity-60 sm:grid-cols-2 xl:grid-cols-3">
                {retired.map((brand) => (
                  <BrandCard
                    key={brand.id}
                    brand={brand}
                    showKind
                    onEdit={() => setEditing(draftOf(brand))}
                    onRestore={() => void setActive(brand, true)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {editing && (
        <BrandEditor
          draft={editing}
          existing={brands}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

/** The add/edit form, in a modal. Builds a BrandInput and POSTs/PUTs it. */
function BrandEditor({
  draft,
  existing,
  onClose,
  onSaved,
}: {
  draft: BrandDraft
  /** The whole registry — used to reject a duplicate name before saving. */
  existing: Brand[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [d, setD] = useState<BrandDraft>(draft)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const darkFileRef = useRef<HTMLInputElement>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)
  const patch = (p: Partial<BrandDraft>) => setD((cur) => ({ ...cur, ...p }))

  function onLogoFile(
    file: File | undefined,
    field: 'logo_svg' | 'logo_svg_dark' | 'icon_svg' = 'logo_svg',
  ) {
    if (!file) return
    if (file.size > MAX_LOGO_BYTES) {
      setErr('That logo is too large — please use one under ~1.2 MB.')
      return
    }
    setErr(null)
    const reader = new FileReader()
    reader.onload = () => patch({ [field]: String(reader.result || '') || null })
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      reader.readAsText(file) // inline SVG markup — backend rasterizes it
    } else {
      reader.readAsDataURL(file) // data: URI for PNG/JPG/WebP
    }
  }

  async function save() {
    if (!d.name.trim()) {
      setErr('A name is required.')
      return
    }
    // The registry is the vocabulary, so two entities must not normalise to the
    // same name — otherwise findByName() can't tell them apart and the wrong
    // colour resolves. Compares via the shared normaliser, so "Digital Spearhead"
    // and "Digital-Spearhead" collide here rather than silently later.
    const slug = normaliseName(d.name)
    const clash = existing.find((b) => b.id !== d.id && normaliseName(b.name) === slug)
    if (clash) {
      setErr(`“${clash.name}” already uses that name — names must be unique in the registry.`)
      return
    }
    const input: BrandInput = {
      name: d.name.trim(),
      kind: d.kind,
      active: d.active,
      colors: d.colors,
      icon_svg: d.icon_svg,
      logo_svg: d.logo_svg,
      logo_svg_dark: d.logo_svg_dark,
      font: d.font.trim() || null,
      accent: d.accent || null,
      voice: d.voice.trim() || null,
    }
    setBusy(true)
    setErr(null)
    try {
      if (d.id) await updateBrand(d.id, input)
      else await createBrand(input)
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the brand.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={d.id ? `Edit ${KIND_LABEL[d.kind].toLowerCase()}` : 'Add entity'}
      description="Name, palette and logo keep generated banners on-brand. The CTA stays auto high-contrast."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} className="mr-auto">
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !d.name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={d.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. Acme Capital"
            className="h-9"
          />
        </Field>

        <Field label="Type" hint="Decides which pickers this appears in.">
          <div className="grid gap-1.5 sm:grid-cols-3">
            {ENTITY_KINDS.map((k) => {
              const on = d.kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch({ kind: k })}
                  aria-pressed={on}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition-colors',
                    on
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border bg-background hover:bg-secondary/60',
                  )}
                >
                  <span
                    className={cn(
                      'block font-display text-sm font-semibold',
                      on ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {KIND_LABEL[k]}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {KIND_HINT[k]}
                  </span>
                </button>
              )
            })}
          </div>
          {d.kind === 'academy' && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              An academy is a brand — it stays selectable in every brand picker alongside the
              brokers, and is never offered as a white label. If it genuinely needs to front
              another brand, register it twice under distinct names.
            </p>
          )}
        </Field>

        <Field label="Palette" hint="Folded into the art direction so the design stays on-brand.">
          <div className="flex flex-wrap items-center gap-2">
            {d.colors.map((hex, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background py-1 pl-1.5 pr-1.5"
              >
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#2563EB'}
                  onChange={(e) =>
                    patch({ colors: d.colors.map((c, j) => (j === i ? e.target.value.toUpperCase() : c)) })
                  }
                  className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
                  title="Change colour"
                />
                <span className="font-mono text-[11px] text-foreground">{hex.toUpperCase()}</span>
                <button
                  type="button"
                  onClick={() => patch({ colors: d.colors.filter((_, j) => j !== i) })}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${hex}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => patch({ colors: [...d.colors, '#2563EB'] })}
              disabled={d.colors.length >= 12}
            >
              <Plus className="h-3.5 w-3.5" /> Colour
            </Button>
          </div>
        </Field>

        <Field label="Icon" hint="The square mark shown in this registry. Not composited onto banners.">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
              {brandLogoUri(d.icon_svg, false) ? (
                <img src={brandLogoUri(d.icon_svg, false)} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Icon
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                ref={iconFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                className="hidden"
                onChange={(e) => onLogoFile(e.target.files?.[0], 'icon_svg')}
              />
              <Button size="sm" variant="outline" onClick={() => iconFileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {d.icon_svg ? 'Replace icon' : 'Upload icon'}
              </Button>
              {d.icon_svg && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => patch({ icon_svg: null })}
                >
                  <X className="h-4 w-4" /> Remove icon
                </Button>
              )}
            </div>
          </div>
        </Field>

        <Field label="Logo (light theme)" hint="SVG, PNG, JPG or WebP. SVGs are rasterized for the overlay.">
          <div className="flex items-center gap-3">
            <LogoPreview svg={d.logo_svg} className="h-16 w-16 shrink-0" />
            <div className="flex flex-col gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                className="hidden"
                onChange={(e) => onLogoFile(e.target.files?.[0])}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {d.logo_svg ? 'Replace logo' : 'Upload logo'}
              </Button>
              {d.logo_svg && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => patch({ logo_svg: null })}
                >
                  <X className="h-4 w-4" /> Remove logo
                </Button>
              )}
            </div>
          </div>
        </Field>

        <Field
          label="Logo (dark theme, optional)"
          hint="Shown wherever the app renders the logo on dark surfaces. Without one, dark letters are auto-recolored to white."
        >
          <div className="flex items-center gap-3">
            <LogoPreview svg={d.logo_svg_dark} svgDark={d.logo_svg_dark} className="h-16 w-16 shrink-0 !bg-slate-900" />
            <div className="flex flex-col gap-1.5">
              <input
                ref={darkFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                className="hidden"
                onChange={(e) => onLogoFile(e.target.files?.[0], 'logo_svg_dark')}
              />
              <Button size="sm" variant="outline" onClick={() => darkFileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {d.logo_svg_dark ? 'Replace dark logo' : 'Upload dark logo'}
              </Button>
              {d.logo_svg_dark && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => patch({ logo_svg_dark: null })}
                >
                  <X className="h-4 w-4" /> Remove dark logo
                </Button>
              )}
            </div>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Typography hint">
            <Input
              value={d.font}
              onChange={(e) => patch({ font: e.target.value })}
              placeholder="e.g. Inter / geometric sans"
              className="h-9"
            />
          </Field>
          <Field label="Accent colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={d.accent && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : '#2563EB'}
                onChange={(e) => patch({ accent: e.target.value.toUpperCase() })}
                className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                title="Accent colour"
              />
              {d.accent ? (
                <>
                  <span className="font-mono text-xs text-foreground">{d.accent.toUpperCase()}</span>
                  <button
                    type="button"
                    onClick={() => patch({ accent: null })}
                    className="text-muted-foreground hover:text-foreground"
                    title="Clear (auto)"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Auto</span>
              )}
            </div>
          </Field>
        </div>

        <Field label="Tone of voice">
          <Input
            value={d.voice}
            onChange={(e) => patch({ voice: e.target.value })}
            placeholder="e.g. confident, concise, expert"
            className="h-9"
          />
        </Field>

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-2 font-normal text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * One entity, sized to sit 2–3 across in the registry grid: accent stripe, icon,
 * name over its registry slug, and a palette strip. The stripe is this entity's
 * own colour — a card pairing a WL with a brand resolves precedence via
 * resolveAccent() instead. Actions surface on hover (always on touch/keyboard).
 */
function BrandCard({
  brand,
  onEdit,
  onRetire,
  onRestore,
  showKind,
}: {
  brand: Brand
  onEdit?: () => void
  /** Retire (active=false) — the model never deletes. */
  onRetire?: () => void
  onRestore?: () => void
  /** Retired cards mix kinds, so they label it; grouped sections don't need to. */
  showKind?: boolean
}) {
  const swatches =
    brand.swatches && brand.swatches.length
      ? brand.swatches
      : brand.colors.map((hex) => ({ hex, role: '' }))
  const kind = kindOf(brand)
  const accent = entityAccent(brand) ?? NEUTRAL_ACCENT

  return (
    <div className="group flex overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-colors hover:border-foreground/20">
      {/* The entity's resolved accent — the card tint the model calls for. */}
      <span className="w-1 shrink-0" style={{ backgroundColor: accent }} aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-3 p-3">
        <EntityIcon brand={brand} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-sm font-semibold text-foreground">
              {brand.name || 'Untitled'}
            </span>
            {showKind && (
              <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[kind]}
              </span>
            )}
          </div>
          {/* The registry slug — what every lookup normalises to. */}
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {normaliseName(brand.name)}
          </div>

          {swatches.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {swatches.map((s, i) => (
                <span
                  key={`${s.hex}-${i}`}
                  title={s.role ? `${s.hex.toUpperCase()} · ${s.role}` : s.hex.toUpperCase()}
                  className="h-3 w-3 rounded-full border border-border"
                  style={{ backgroundColor: s.hex }}
                />
              ))}
              {!brand.icon_svg && (
                <span className="ml-1 text-[10px] text-muted-foreground">No icon</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onEdit && (
            <IconAction onClick={onEdit} label="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
          )}
          {onRestore && (
            <IconAction onClick={onRestore} label="Restore">
              <RotateCcw className="h-3.5 w-3.5" />
            </IconAction>
          )}
          {onRetire && (
            <IconAction
              onClick={onRetire}
              label="Retire — leaves every picker; historical records keep rendering"
              danger
            >
              <Archive className="h-3.5 w-3.5" />
            </IconAction>
          )}
        </div>
      </div>
    </div>
  )
}

/** A compact icon-only card action. */
function IconAction({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'rounded p-1 text-muted-foreground transition-colors',
        danger ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The registry ICON: an entity's square mark, or — until one is supplied — a
 * tinted initial so the row still reads. Icons are shown as-authored (no
 * dark-mode letter recolouring), since they carry their own plate.
 */
function EntityIcon({ brand }: { brand: Brand }) {
  const src = brandLogoUri(brand.icon_svg, false)
  const accent = entityAccent(brand) ?? NEUTRAL_ACCENT
  if (!src) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border"
        title="No icon yet"
      >
        <span className="font-display text-base font-semibold" style={{ color: accent }}>
          {(brand.name || '?').trim().charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
      <img src={src} alt="" className="h-full w-full object-contain" />
    </div>
  )
}

/** Preview a brand logo — handles a data: URI (raster) or inline SVG markup. */
function LogoPreview({
  svg,
  svgDark,
  className,
}: {
  svg: string | null
  /** Explicit dark-theme variant; without it dark letters are recolored. */
  svgDark?: string | null
  className?: string
}) {
  const dark = useIsDark()
  const src = brandLogoSrc({ logo_svg: svg, logo_svg_dark: svgDark }, dark) || null
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-md border border-border bg-secondary/50',
        className,
      )}
    >
      {src ? (
        <img src={src} alt="Brand logo" className="h-full w-full object-contain p-1" />
      ) : (
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Logo</span>
      )}
    </div>
  )
}

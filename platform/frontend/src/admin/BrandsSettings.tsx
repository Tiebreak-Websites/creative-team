import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { PillMultiSelect, type PillOption } from '@/components/PillMultiSelect'
import { brandLogoSrc, brandLogoUri, useIsDark } from '@/lib/brandLogo'
import { countryFlagUrl, flagUrl } from '@/lib/flags'
import { MARKETS, REGION_LABEL } from '@/lib/markets'
import { cn } from '@/lib/utils'
import { listSections, type Language } from '../lpBuilder/api'
import {
  academyOptions,
  createBrand,
  propOptions,
  entityAccent,
  ENTITY_KINDS,
  FONT_WEIGHTS,
  KIND_HINT,
  KIND_LABEL,
  kindOf,
  listBrands,
  NEUTRAL_ACCENT,
  normaliseName,
  REGULATION_LABEL,
  REGULATIONS,
  TOKEN_FIELDS,
  TYPE_ROLES,
  updateBrand,
  whitelabelOptions,
  type Brand,
  type BrandInput,
  type EntityKind,
  type Regulation,
  type TypeSpec,
  type Typography,
} from '../bannerBuilder/brandsApi'

/** ~1.2MB cap on an uploaded logo — a data: URI is ~1.37x the file bytes and the
 * backend caps the stored string at ~2MB, so this stays comfortably under. */
const MAX_LOGO_BYTES = 1_200_000

/** The five logo shapes an entity can carry. */
type LogoField = 'icon_svg' | 'favicon' | 'logo_wide' | 'logo_svg' | 'logo_svg_dark'

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** '0050f9' / '#0050F9' / ' #05f ' -> '#0050F9'. null when it isn't a hex yet.
 *
 * Shorthand is EXPANDED to six digits: `<input type="color">` can only hold
 * #rrggbb, so storing '#ABC' would leave every swatch silently showing the
 * default blue while the value itself was fine. */
function normaliseHex(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const withHash = s.startsWith('#') ? s : `#${s}`
  if (!HEX_RE.test(withHash)) return null
  const body = withHash.slice(1)
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body
  return `#${full}`.toUpperCase()
}

/**
 * A hex field you can type into. Keeps its own draft so half-typed values like
 * "#00" don't get rejected mid-keystroke; commits as soon as the draft parses,
 * and snaps back to the last good value on blur if it never did. The leading
 * '#' is optional — pasting a bare hex from a design tool just works.
 */
function HexText({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string | null
  onCommit: (hex: string) => void
  placeholder?: string
  className?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(value ?? '')
  // Follow the value when it changes elsewhere (picker, clear, reopening the form).
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])
  const parsed = normaliseHex(draft)
  const invalid = draft.trim() !== '' && !parsed
  return (
    <input
      type="text"
      inputMode="text"
      spellCheck={false}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value)
        const hex = normaliseHex(e.target.value)
        if (hex) onCommit(hex)
      }}
      onBlur={() => setDraft(parsed ?? value ?? '')}
      className={cn(
        'w-full bg-transparent font-mono outline-none placeholder:text-muted-foreground',
        invalid ? 'text-destructive' : 'text-foreground',
        className,
      )}
    />
  )
}

/** One logo shape: preview, upload, clear. `wide` gives a letterbox preview for
 * horizontal lockups; `onDark` previews white-lettered marks on a dark plate. */
function LogoSlot({
  label,
  note,
  value,
  wide,
  onDark,
  onPick,
  onClear,
}: {
  label: string
  note: string
  value: string | null
  wide?: boolean
  onDark?: boolean
  onPick: () => void
  onClear: () => void
}) {
  const src = brandLogoUri(value, false)
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-2">
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border',
          wide ? 'h-11 w-20' : 'h-11 w-11',
          onDark ? 'bg-slate-900' : 'bg-white',
        )}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            None
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12px] font-medium text-foreground">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{note}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onPick}
          title={value ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          aria-label={value ? `Replace ${label}` : `Upload ${label}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
        {value && (
          <button
            type="button"
            onClick={onClear}
            title={`Remove ${label.toLowerCase()}`}
            aria-label={`Remove ${label}`}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

interface BrandDraft {
  id?: string
  name: string
  kind: EntityKind
  active: boolean
  regulation: Regulation | null
  markets: string[]
  languages: string[]
  colors: string[]
  icon_svg: string | null
  favicon: string | null
  logo_wide: string | null
  logo_svg: string | null
  logo_svg_dark: string | null
  font: string
  accent: string | null
  tokens: Record<string, string>
  typography: Typography
}

const EMPTY_DRAFT: BrandDraft = {
  name: '',
  kind: 'broker',
  active: true,
  regulation: null,
  markets: [],
  languages: [],
  colors: [],
  icon_svg: null,
  favicon: null,
  logo_wide: null,
  logo_svg: null,
  logo_svg_dark: null,
  font: '',
  accent: null,
  tokens: {},
  typography: {},
}

const draftOf = (b: Brand): BrandDraft => ({
  id: b.id,
  name: b.name,
  kind: kindOf(b),
  active: b.active !== false,
  regulation: b.regulation ?? null,
  markets: b.markets ?? [],
  languages: b.languages ?? [],
  colors: b.colors ?? [],
  icon_svg: b.icon_svg ?? null,
  favicon: b.favicon ?? null,
  logo_wide: b.logo_wide ?? null,
  logo_svg: b.logo_svg ?? null,
  logo_svg_dark: b.logo_svg_dark ?? null,
  font: b.font ?? '',
  accent: b.accent ?? null,
  tokens: { ...(b.tokens ?? {}) },
  typography: {
    ...(b.typography ?? {}),
    scale: { ...(b.typography?.scale ?? {}) },
  },
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
    { kind: 'prop', items: propOptions(live) },
  ]
  const retired = brands.filter((b) => b.active === false)

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Brands</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The registry every picker reads from. A <b className="font-semibold text-foreground">broker</b>{' '}
            is the product being sold; an <b className="font-semibold text-foreground">academy</b> sells
            education and a <b className="font-semibold text-foreground">prop firm</b> sells
            funded-account challenges — both pick like a broker everywhere, and are grouped separately
            only for reporting. A <b className="font-semibold text-foreground">white label</b> is the one
            true exception: a surface that routes traffic to a brand, never a brand itself.
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
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
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
              <div className="grid gap-3 opacity-60 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
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
  const uploadRef = useRef<HTMLInputElement>(null)
  const [uploadField, setUploadField] = useState<LogoField | null>(null)

  // Markets are static reference data; languages come from the LP registry so
  // the picker can't offer one the backend would reject on save.
  const [languages, setLanguages] = useState<Language[]>([])
  useEffect(() => {
    listSections()
      .then((d) => setLanguages(d.languages))
      .catch(() => {
        /* the field just stays empty — nothing else in the form depends on it */
      })
  }, [])

  const marketOptions: PillOption[] = useMemo(
    () =>
      MARKETS.map((m) => ({
        value: m.code,
        label: m.name,
        flag: countryFlagUrl(m.code),
        group: REGION_LABEL[m.region],
      })),
    [],
  )

  const languageOptions: PillOption[] = useMemo(
    () =>
      languages.map((l) => ({
        value: l.code,
        label: l.label,
        flag: flagUrl(l.code),
      })),
    [languages],
  )
  function pickFile(field: LogoField) {
    setUploadField(field)
    uploadRef.current?.click()
  }
  const patch = (p: Partial<BrandDraft>) => setD((cur) => ({ ...cur, ...p }))

  function onLogoFile(file: File | undefined, field: LogoField = 'logo_svg') {
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
      // Regulation only means something for a broker; a white label or academy
      // isn't the licensed entity, so don't persist a stale value against one.
      regulation: d.kind === 'broker' ? d.regulation : null,
      markets: d.markets,
      languages: d.languages,
      colors: d.colors,
      icon_svg: d.icon_svg,
      favicon: d.favicon,
      logo_wide: d.logo_wide,
      logo_svg: d.logo_svg,
      logo_svg_dark: d.logo_svg_dark,
      font: d.font.trim() || null,
      accent: d.accent || null,
      tokens: d.tokens,
      typography: d.typography,
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
      description="The brand kit: what pickers show, what a landing page is built from, and what keeps generated banners on-brand."
      className="max-w-2xl"
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
          <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-4">
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

        {/* Regulation is a property of the licensed entity, so it's only asked
            for brokers — a white label fronts someone else's licence. */}
        {d.kind === 'broker' && (
          <Field label="Regulation" hint="Which licence this broker operates under.">
            <div className="flex flex-wrap gap-1.5">
              {REGULATIONS.map((r) => {
                const on = d.regulation === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => patch({ regulation: on ? null : r })}
                    aria-pressed={on}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 font-display text-xs font-medium transition-colors',
                      on
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-secondary/60',
                    )}
                  >
                    {REGULATION_LABEL[r]}
                  </button>
                )
              })}
              {d.regulation && (
                <button
                  type="button"
                  onClick={() => patch({ regulation: null })}
                  className="px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </Field>
        )}

        <Field label="Target markets" hint="Where this entity operates. Grouped by region.">
          <PillMultiSelect
            options={marketOptions}
            selected={d.markets}
            onChange={(markets) => patch({ markets })}
            addLabel="Add market"
            searchPlaceholder="Search countries…"
            emptyHint="No markets yet."
          />
        </Field>

        <Field label="Languages" hint="What this entity publishes in.">
          <PillMultiSelect
            options={languageOptions}
            selected={d.languages}
            onChange={(languages) => patch({ languages })}
            addLabel="Add language"
            searchPlaceholder="Search languages…"
            emptyHint="No languages yet."
          />
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
                <HexText
                  value={hex}
                  ariaLabel={`Palette colour ${i + 1} hex`}
                  className="w-[68px] text-[11px]"
                  onCommit={(next) =>
                    patch({ colors: d.colors.map((c, j) => (j === i ? next : c)) })
                  }
                />
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

        {/* One hidden input serves every slot — the target field is picked when
            the button is clicked, rather than keeping five refs in sync. */}
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          className="hidden"
          onChange={(e) => {
            if (uploadField) onLogoFile(e.target.files?.[0], uploadField)
            e.target.value = '' // let the same file be re-picked after a remove
          }}
        />

        <Field label="Logos" hint="SVG or PNG. Each shape has its own job.">
          <div className="grid gap-2 sm:grid-cols-2">
            <LogoSlot
              label="Square"
              note="Registry cards, folder tiles"
              value={d.icon_svg}
              onPick={() => pickFile('icon_svg')}
              onClear={() => patch({ icon_svg: null })}
            />
            <LogoSlot
              label="Favicon"
              note="Tab icon on exported pages"
              value={d.favicon}
              onPick={() => pickFile('favicon')}
              onClear={() => patch({ favicon: null })}
            />
            <LogoSlot
              label="Horizontal"
              note="Page headers"
              value={d.logo_wide}
              wide
              onPick={() => pickFile('logo_wide')}
              onClear={() => patch({ logo_wide: null })}
            />
            <LogoSlot
              label="Banner wordmark"
              note="Composited onto banners"
              value={d.logo_svg}
              wide
              onPick={() => pickFile('logo_svg')}
              onClear={() => patch({ logo_svg: null })}
            />
            <LogoSlot
              label="Wordmark (dark)"
              note="Optional — else dark letters auto-whiten"
              value={d.logo_svg_dark}
              wide
              onDark
              onPick={() => pickFile('logo_svg_dark')}
              onClear={() => patch({ logo_svg_dark: null })}
            />
          </div>
        </Field>

        <Field
          label="Page colours"
          hint="Drive the landing page directly. Unset falls back to the palette."
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {TOKEN_FIELDS.map((f) => {
              const val = d.tokens[f.key]
              return (
                <div
                  key={f.key}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  {/* An unset token still needs a value for the colour input,
                      so it's dimmed and dashed — otherwise every unset swatch
                      reads as a deliberate blue. */}
                  <input
                    type="color"
                    value={val && /^#[0-9a-fA-F]{6}$/.test(val) ? val : '#2563EB'}
                    onChange={(e) =>
                      patch({ tokens: { ...d.tokens, [f.key]: e.target.value.toUpperCase() } })
                    }
                    className={cn(
                      'h-7 w-7 shrink-0 cursor-pointer rounded border bg-transparent p-0',
                      val ? 'border-border' : 'border-dashed border-muted-foreground/50 opacity-30',
                    )}
                    title={val ? f.label : `${f.label} — not set, using the palette fallback`}
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {f.label}
                    </span>
                    <HexText
                      value={val ?? null}
                      ariaLabel={`${f.label} hex`}
                      placeholder={f.hint}
                      className="text-[10px]"
                      onCommit={(hex) => patch({ tokens: { ...d.tokens, [f.key]: hex } })}
                    />
                  </span>
                  {val && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...d.tokens }
                        delete next[f.key]
                        patch({ tokens: next })
                      }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title="Clear — fall back to the palette"
                      aria-label={`Clear ${f.label}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Field>

        <Field
          label="Typography"
          hint="Families apply to pages now; the scale is read by templates that opt in."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={d.typography.heading_font ?? ''}
              onChange={(e) =>
                patch({ typography: { ...d.typography, heading_font: e.target.value } })
              }
              placeholder="Heading font — e.g. Poppins"
              className="h-9"
            />
            <Input
              value={d.typography.body_font ?? ''}
              onChange={(e) =>
                patch({ typography: { ...d.typography, body_font: e.target.value } })
              }
              placeholder="Body font — e.g. Inter"
              className="h-9"
            />
          </div>

          <div className="mt-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Role</span>
              <span className="w-16 text-center">Size</span>
              <span className="w-20 text-center">Weight</span>
              <span className="w-16 text-center">Line</span>
            </div>
            {TYPE_ROLES.map((role) => {
              const spec = d.typography.scale?.[role.key] ?? {}
              const setSpec = (next: TypeSpec) =>
                patch({
                  typography: {
                    ...d.typography,
                    scale: { ...(d.typography.scale ?? {}), [role.key]: { ...spec, ...next } },
                  },
                })
              return (
                <div
                  key={role.key}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  <span className="truncate text-[12px] font-medium">{role.label}</span>
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={spec.size ?? ''}
                    onChange={(e) =>
                      setSpec({ size: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                    placeholder="—"
                    aria-label={`${role.label} size in px`}
                    className="h-8 w-16 rounded-md border border-border bg-background px-2 text-center text-xs"
                  />
                  <select
                    value={spec.weight ?? ''}
                    onChange={(e) =>
                      setSpec({
                        weight: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    aria-label={`${role.label} weight`}
                    className="h-8 w-20 rounded-md border border-border bg-background px-1 text-center text-xs"
                  >
                    <option value="">—</option>
                    {FONT_WEIGHTS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0.8}
                    max={3}
                    step={0.05}
                    value={spec.line ?? ''}
                    onChange={(e) =>
                      setSpec({ line: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                    placeholder="—"
                    aria-label={`${role.label} line height`}
                    className="h-8 w-16 rounded-md border border-border bg-background px-2 text-center text-xs"
                  />
                </div>
              )
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Typography hint" hint="Steers banner art direction.">
            <Input
              value={d.font}
              onChange={(e) => patch({ font: e.target.value })}
              placeholder="e.g. Inter / geometric sans"
              className="h-9"
            />
          </Field>
          <Field label="Accent colour" hint="Banner CTA hint.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={d.accent && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : '#2563EB'}
                onChange={(e) => patch({ accent: e.target.value.toUpperCase() })}
                className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                title="Accent colour"
              />
              <HexText
                value={d.accent}
                ariaLabel="Accent colour hex"
                placeholder="Auto"
                className="w-[76px] text-xs"
                onCommit={(hex) => patch({ accent: hex })}
              />
              {d.accent && (
                <button
                  type="button"
                  onClick={() => patch({ accent: null })}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="Clear (auto)"
                  aria-label="Clear accent colour"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Field>
        </div>

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
            <span
              className="truncate font-display text-sm font-semibold text-foreground"
              title={brand.name || 'Untitled'}
            >
              {brand.name || 'Untitled'}
            </span>
            {showKind && (
              <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[kind]}
              </span>
            )}
          </div>
          {/* The registry slug — what every lookup normalises to. Titled because
              a long slug truncates at this card width. */}
          <div
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={normaliseName(brand.name)}
          >
            {normaliseName(brand.name)}
          </div>
          {brand.regulation && (
            <span
              className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={REGULATION_LABEL[brand.regulation]}
            >
              <ShieldCheck className="h-2.5 w-2.5 shrink-0" aria-hidden />
              {brand.regulation === 'eu' ? 'EU' : 'International'}
            </span>
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

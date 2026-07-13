import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { brandLogoSrc, useIsDark } from '@/lib/brandLogo'
import { cn } from '@/lib/utils'
import {
  createBrand,
  deleteBrand,
  listBrands,
  updateBrand,
  type Brand,
  type BrandInput,
} from '../bannerBuilder/brandsApi'

/** ~1.2MB cap on an uploaded logo — a data: URI is ~1.37x the file bytes and the
 * backend caps the stored string at ~2MB, so this stays comfortably under. */
const MAX_LOGO_BYTES = 1_200_000

interface BrandDraft {
  id?: string
  name: string
  colors: string[]
  logo_svg: string | null
  logo_svg_dark: string | null
  font: string
  accent: string | null
  voice: string
}

const EMPTY_DRAFT: BrandDraft = {
  name: '',
  colors: [],
  logo_svg: null,
  logo_svg_dark: null,
  font: '',
  accent: null,
  voice: '',
}

/**
 * Brands catalog + editor (admin Settings surface — the whole surface is already
 * admin-gated in App.tsx, and every write is admin-gated on the backend too).
 * Admins can add brands, edit/delete the ones they created, and upload a logo
 * (SVG or PNG/JPG/WebP); built-in brands stay read-only. Saved brands are shared,
 * so every user can pick them when generating.
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

  async function handleDelete(brand: Brand) {
    if (!window.confirm(`Delete the brand “${brand.name}”? This can’t be undone.`)) return
    try {
      await deleteBrand(brand.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Brands</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The brands available for campaigns — each with a palette, an optional logo, and brand-kit
            hints (typography / accent / tone) that keep creative on-brand. Saved brands are shared
            with everyone.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
            <Plus className="h-4 w-4" /> Add brand
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh brands"
            aria-label="Refresh brands"
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

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading brands…
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No brands yet — add your first.
          </div>
        ) : (
          brands.map((brand) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              onEdit={() =>
                setEditing({
                  id: brand.id,
                  name: brand.name,
                  colors: brand.colors ?? [],
                  logo_svg: brand.logo_svg ?? null,
                  logo_svg_dark: brand.logo_svg_dark ?? null,
                  font: brand.font ?? '',
                  accent: brand.accent ?? null,
                  voice: brand.voice ?? '',
                })
              }
              onDelete={brand.builtin ? undefined : () => void handleDelete(brand)}
            />
          ))
        )}
      </div>

      {editing && (
        <BrandEditor
          draft={editing}
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
  onClose,
  onSaved,
}: {
  draft: BrandDraft
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [d, setD] = useState<BrandDraft>(draft)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const darkFileRef = useRef<HTMLInputElement>(null)
  const patch = (p: Partial<BrandDraft>) => setD((cur) => ({ ...cur, ...p }))

  function onLogoFile(file: File | undefined, field: 'logo_svg' | 'logo_svg_dark' = 'logo_svg') {
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
      setErr('A brand name is required.')
      return
    }
    const input: BrandInput = {
      name: d.name.trim(),
      colors: d.colors,
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
      title={d.id ? 'Edit brand' : 'Add brand'}
      description="Name, palette and logo keep generated banners on-brand. The CTA stays auto high-contrast."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} className="mr-auto">
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !d.name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save brand
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
 * A brand showcase card: logo, name (+ "Built-in" badge), palette swatches, and
 * brand-kit hints. Admin Edit / Delete controls appear for stored (non-built-in)
 * brands.
 */
function BrandCard({
  brand,
  onEdit,
  onDelete,
}: {
  brand: Brand
  onEdit?: () => void
  onDelete?: () => void
}) {
  const swatches =
    brand.swatches && brand.swatches.length
      ? brand.swatches
      : brand.colors.map((hex) => ({ hex, role: '' }))

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-start gap-4">
        <LogoPreview svg={brand.logo_svg} svgDark={brand.logo_svg_dark} className="h-20 w-20 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-sm font-semibold text-foreground">
              {brand.name || 'Untitled brand'}
            </span>
            {brand.builtin && (
              <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Built-in
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {onEdit && (
                <Button size="sm" variant="ghost" onClick={onEdit} title="Edit brand" aria-label="Edit brand">
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDelete}
                  title="Delete brand"
                  aria-label="Delete brand"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </span>
          </div>

          {swatches.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {swatches.map((s, i) => (
                <span
                  key={`${s.hex}-${i}`}
                  title={s.hex}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-1.5 pr-2.5"
                >
                  <span
                    className="h-5 w-5 rounded-md border border-border"
                    style={{ backgroundColor: s.hex }}
                  />
                  <span className="leading-tight">
                    <span className="block font-mono text-[11px] font-medium text-foreground">
                      {s.hex.toUpperCase()}
                    </span>
                    {s.role && <span className="block text-[10px] text-muted-foreground">{s.role}</span>}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">No colours</div>
          )}

          {(brand.font || brand.accent || brand.voice) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {brand.font && (
                <span>
                  <span className="font-medium text-foreground/80">Type:</span> {brand.font}
                </span>
              )}
              {brand.accent && (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-foreground/80">Accent:</span>
                  <span className="h-3 w-3 rounded border border-border" style={{ backgroundColor: brand.accent }} />
                  <span className="font-mono">{brand.accent.toUpperCase()}</span>
                </span>
              )}
              {brand.voice && (
                <span>
                  <span className="font-medium text-foreground/80">Voice:</span> {brand.voice}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
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

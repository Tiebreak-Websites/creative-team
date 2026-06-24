import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ColorPicker } from '@/components/ColorPicker'
import { cn } from '@/lib/utils'
import {
  createBrand,
  deleteBrand,
  listBrands,
  updateBrand,
  type Brand,
} from '../bannerBuilder/brandsApi'

/**
 * Brands management panel for the admin Settings surface. Lists existing brands
 * as cards (name, palette swatches, logo preview), lets you add a brand (name +
 * editable palette + SVG logo upload), and edit/delete each one. Every mutation
 * refetches so the list always reflects the backend. Self-contained: no props.
 */
export function BrandsSettings() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

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

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Brands</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable brands with a palette and logo. Add one to seed campaign colours and
            keep creative on-brand.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh brands"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Button>
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
            No brands yet. Add your first one below.
          </div>
        ) : (
          brands.map((brand) =>
            editingId === brand.id && !brand.builtin ? (
              <BrandForm
                key={brand.id}
                initial={brand}
                submitLabel="Save changes"
                onCancel={() => setEditingId(null)}
                onSubmit={async (values) => {
                  await updateBrand(brand.id, values)
                  setEditingId(null)
                  await refresh()
                }}
              />
            ) : (
              <BrandCard
                key={brand.id}
                brand={brand}
                // Built-in brands ship with the app — not editable/deletable.
                onEdit={brand.builtin ? undefined : () => setEditingId(brand.id)}
                onDelete={
                  brand.builtin
                    ? undefined
                    : async () => {
                        await deleteBrand(brand.id)
                        await refresh()
                      }
                }
              />
            ),
          )
        )}
      </div>

      <div className="mt-5">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Add a brand
        </div>
        <BrandForm
          // Reset the inline form after each successful add.
          key={brands.length}
          submitLabel="Add brand"
          onSubmit={async (values) => {
            await createBrand(values)
            await refresh()
          }}
        />
      </div>
    </div>
  )
}

/**
 * A read-only brand showcase card: logo, name (+ "Built-in" badge), and the
 * palette as role-labelled swatches when available. Edit/Delete render only
 * when their handlers are passed (built-in brands omit them).
 */
function BrandCard({
  brand,
  onEdit,
  onDelete,
}: {
  brand: Brand
  onEdit?: () => void
  onDelete?: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function remove() {
    if (!onDelete) return
    setErr(null)
    setBusy(true)
    try {
      await onDelete()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  // Prefer role-annotated swatches (built-ins); fall back to the raw palette.
  const swatches =
    brand.swatches && brand.swatches.length
      ? brand.swatches
      : brand.colors.map((hex) => ({ hex, role: '' }))

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-start gap-4">
        <LogoPreview svg={brand.logo_svg} className="h-20 w-20 shrink-0" />

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
                    {s.role && (
                      <span className="block text-[10px] text-muted-foreground">{s.role}</span>
                    )}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">No colours</div>
          )}
        </div>

        {(onEdit || onDelete) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {onEdit && (
              <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Add/edit form for a brand. Holds local draft state for name, palette and logo.
 * `initial` pre-fills it for editing; otherwise it starts empty. Surfaces a
 * submit error inline and keeps the form open so the draft isn't lost.
 */
function BrandForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Brand
  submitLabel: string
  onSubmit: (values: { name: string; colors: string[]; logo_svg: string | null }) => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [colors, setColors] = useState<string[]>(initial?.colors ?? [])
  const [logoSvg, setLogoSvg] = useState<string | null>(initial?.logo_svg ?? null)
  const [openSwatch, setOpenSwatch] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = name.trim().length > 0 && !saving

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Allow re-uploading the same file later.
    e.target.value = ''
    if (!file) return
    setErr(null)
    try {
      const text = await file.text()
      if (!text.includes('<svg')) {
        setErr('That file doesn’t look like an SVG.')
        return
      }
      setLogoSvg(text)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not read that file.')
    }
  }

  async function submit() {
    if (!canSubmit) return
    setErr(null)
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), colors, logo_svg: logoSvg })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="brand-name">Name</Label>
          <Input
            id="brand-name"
            value={name}
            placeholder="e.g. Internovus"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Logo (SVG)</Label>
          <div className="flex items-center gap-2">
            <LogoPreview svg={logoSvg} className="h-9 w-9 shrink-0" />
            <input
              ref={fileRef}
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {logoSvg ? 'Replace' : 'Upload'}
            </Button>
            {logoSvg && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setLogoSvg(null)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label>Palette</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {colors.map((color, i) => (
            <div key={i} className="relative">
              <button
                type="button"
                title={color}
                onClick={() => setOpenSwatch(openSwatch === i ? null : i)}
                className={cn(
                  'group relative h-8 w-8 rounded-md border transition-transform hover:scale-105',
                  openSwatch === i ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                )}
                style={{ backgroundColor: color }}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setColors((cs) => cs.filter((_, j) => j !== i))
                    setOpenSwatch(null)
                  }}
                  className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title="Remove colour"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>

              {openSwatch === i && (
                <SwatchPopover onClose={() => setOpenSwatch(null)}>
                  <ColorPicker
                    value={color}
                    onChange={(hex) => setColors((cs) => cs.map((c, j) => (j === i ? hex : c)))}
                  />
                </SwatchPopover>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setColors((cs) => [...cs, '#E71E25'])
              setOpenSwatch(colors.length)
            }}
            title="Add colour"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

/** Small popover anchored under a swatch; closes on outside-click or Escape. */
function SwatchPopover({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-2 rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      {children}
    </div>
  )
}

/** Render an inline SVG string safely inside a bordered box (via a data: URL). */
function LogoPreview({ svg, className }: { svg: string | null; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-md border border-border bg-secondary/50',
        className,
      )}
    >
      {svg ? (
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          alt="Brand logo"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          SVG
        </span>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { listBrands, type Brand } from '../bannerBuilder/brandsApi'

/**
 * Brands catalog panel for the admin Settings surface. Brands are hard-coded
 * built-ins shipped with the app, so this is read-only: it lists each brand as a
 * card (name, palette swatches, logo preview). Refresh refetches from the
 * backend. Self-contained: no props.
 */
export function BrandsSettings() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
            The brands available for campaigns — each with a palette and logo to keep creative
            on-brand. These are built in and read-only.
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
            No brands available.
          </div>
        ) : (
          brands.map((brand) => <BrandCard key={brand.id} brand={brand} />)
        )}
      </div>
    </div>
  )
}

/**
 * A read-only brand showcase card: logo, name (+ "Built-in" badge), and the
 * palette as role-labelled swatches when available.
 */
function BrandCard({ brand }: { brand: Brand }) {
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
      </div>
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

import { useState } from 'react'
import { Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ColorPick, COLOR_MOODS } from '../bannerBuilder/artDirection'
import { LOCALES, MODEL_LABELS, QUALITY_LABELS } from '../bannerBuilder/BannerBuilder'
import { EMPTY_BRAND, loadBrand, saveBrand, type BrandDefaults } from '../bannerBuilder/brand'

/**
 * Brand & defaults editor (localStorage). Every new campaign starts from these:
 * the colours seed the Art-direction palette and the selects seed model/quality/
 * language. The CTA is deliberately not configurable — it stays auto-contrast.
 */
export function BrandSettings() {
  const [brand, setBrand] = useState<BrandDefaults>(loadBrand)
  const [saved, setSaved] = useState(false)
  const patch = (p: Partial<BrandDefaults>) => {
    setBrand((b) => ({ ...b, ...p }))
    setSaved(false)
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-display text-base font-semibold text-foreground">Brand &amp; defaults</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Set these once and every new campaign starts here. Colours seed the Art-direction palette; the CTA button
        always stays auto high-contrast.
      </p>

      <div className="space-y-5">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Brand palette</div>
          <div className="flex flex-wrap items-start gap-6">
            <ColorPick label="Scene / background" value={brand.scene} onChange={(v) => patch({ scene: v })} />
            <ColorPick label="Headline text" value={brand.text} onChange={(v) => patch({ text: v })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {COLOR_MOODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => patch({ colorMood: brand.colorMood === m.key ? null : m.key })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  brand.colorMood === m.key
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BrandSelect
            label="Default model"
            value={brand.model}
            onValueChange={(v) => patch({ model: v })}
            options={Object.entries(MODEL_LABELS)}
          />
          <BrandSelect
            label="Default quality"
            value={brand.quality}
            onValueChange={(v) => patch({ quality: v })}
            options={Object.entries(QUALITY_LABELS)}
          />
          <BrandSelect
            label="Default language"
            value={brand.locale}
            onValueChange={(v) => patch({ locale: v })}
            options={LOCALES.map((l) => [l.value, l.label] as [string, string])}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            saveBrand(brand)
            setSaved(true)
          }}
        >
          <Save className="h-4 w-4" /> Save brand
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setBrand(EMPTY_BRAND)
            setSaved(false)
          }}
        >
          Clear
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-primary">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </div>
  )
}

function BrandSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string
  value: string | null
  onValueChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <Select value={value ?? ''} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Tool default" />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

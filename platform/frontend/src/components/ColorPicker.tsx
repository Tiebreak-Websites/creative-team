import { HexColorPicker, HexColorInput } from 'react-colorful'
import { Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'

// Brand-led default swatches (red brand + neutrals + a few accents).
const DEFAULT_SWATCHES = [
  '#E71E25',
  '#9E181C',
  '#171717',
  '#0B0B0C',
  '#FFFFFF',
  '#0E1A2B',
  '#16A34A',
  '#F5A623',
  '#2563EB',
  '#7C5CFF',
]

/**
 * Figma-style colour picker: saturation/value square + hue slider (react-colorful),
 * a hex input, the native screen eyedropper (where supported), and quick swatches.
 */
export function ColorPicker({
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
}: {
  value: string
  onChange: (hex: string) => void
  swatches?: string[]
}) {
  const color = value || '#E71E25'
  const supportsEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window

  async function pickFromScreen() {
    try {
      // EyeDropper isn't in the TS DOM lib yet.
      // @ts-expect-error - experimental API
      const ed = new window.EyeDropper()
      const res = await ed.open()
      if (res?.sRGBHex) onChange(res.sRGBHex.toUpperCase())
    } catch {
      /* user cancelled the eyedropper */
    }
  }

  return (
    <div className="cb-colorpicker w-[224px] space-y-3">
      <HexColorPicker color={color} onChange={(c) => onChange(c.toUpperCase())} />
      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-border"
          style={{ backgroundColor: color }}
        />
        <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-secondary px-2">
          <HexColorInput
            color={color}
            prefixed
            onChange={(c) => onChange(c.toUpperCase())}
            className="w-full bg-transparent font-mono text-xs uppercase text-foreground outline-none"
          />
        </div>
        {supportsEyedropper && (
          <button
            type="button"
            onClick={pickFromScreen}
            title="Pick a colour from the screen"
            aria-label="Pick a color from the screen"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pipette className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            onClick={() => onChange(s.toUpperCase())}
            className={cn(
              'h-5 w-5 rounded border transition-transform hover:scale-110',
              color.toLowerCase() === s.toLowerCase()
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-border',
            )}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>
    </div>
  )
}

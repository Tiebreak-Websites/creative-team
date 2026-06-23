// Structured art direction for the Banner Builder.
//
// None of this is sent as discrete fields — the GPT-5.5 creative director only
// consumes a free-text `style`, so `composeArtDirection` flattens the user's
// selections into one art-direction paragraph that is appended to whatever the
// user typed. The CTA colour is intentionally NOT a control: the director
// always picks a high-contrast button colour itself, so we only steer the rest
// of the palette and tell it to keep the CTA as the standout accent.
import { type ReactNode } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type Gender = 'either' | 'woman' | 'man' | 'none'
export type CountOpt = 'solo' | 'duo' | 'group'
export type AgeOpt = 'young' | 'adult' | 'mature'

export interface ArtDirection {
  vibe: string | null // a VIBE_PRESETS value
  scene: string | null // hex
  text: string | null // hex
  colorMood: string | null // a COLOR_MOODS key
  gender: Gender | null
  count: CountOpt | null
  age: AgeOpt | null
  wardrobe: string | null
  localize: boolean
}

export const DEFAULT_ART: ArtDirection = {
  vibe: null,
  scene: null,
  text: null,
  colorMood: null,
  gender: null,
  count: null,
  age: null,
  wardrobe: null,
  localize: false,
}

// Overall look presets (were the old inline "Presets" popover).
export const VIBE_PRESETS: { name: string; value: string }[] = [
  { name: 'Bold Editorial', value: 'bold editorial, high-contrast typography, premium magazine feel' },
  { name: 'Minimal Clean', value: 'minimal, generous whitespace, clean sans-serif, calm muted palette' },
  { name: 'Vibrant Gradient', value: 'vibrant gradient background, energetic, modern, glossy highlights' },
  { name: 'Dark Luxury', value: 'dark luxury, gold accents, elegant serif, cinematic lighting' },
  { name: 'Playful Pop', value: 'playful pop, bright saturated colors, rounded shapes, fun and friendly' },
  { name: 'Photo Hero', value: 'photo-driven hero, a real product or person, natural lighting, lifestyle' },
]

export const COLOR_MOODS: { key: string; label: string; hint: string }[] = [
  { key: 'warm', label: 'Warm', hint: 'a warm, inviting colour temperature' },
  { key: 'cool', label: 'Cool', hint: 'a cool, calm colour temperature' },
  { key: 'pop', label: 'High-contrast Pop', hint: 'bold, saturated, high-contrast colour' },
  { key: 'pastel', label: 'Pastel', hint: 'soft, light pastel tones' },
  { key: 'mono', label: 'Mono + Accent', hint: 'a near-monochrome palette lifted by a single accent' },
]

const GENDERS: { key: Gender; label: string }[] = [
  { key: 'either', label: 'Either' },
  { key: 'woman', label: 'Woman' },
  { key: 'man', label: 'Man' },
  { key: 'none', label: 'No people' },
]
const COUNTS: { key: CountOpt; label: string }[] = [
  { key: 'solo', label: 'Solo' },
  { key: 'duo', label: 'Duo' },
  { key: 'group', label: 'Group' },
]
const AGES: { key: AgeOpt; label: string }[] = [
  { key: 'young', label: 'Young adult' },
  { key: 'adult', label: 'Adult' },
  { key: 'mature', label: 'Mature' },
]
const WARDROBES = ['business', 'smart casual', 'casual', 'athletic', 'formal', 'streetwear']

// Suggested swatches: brand mint + neutrals + a few accents.
const SWATCHES = ['#21F1A8', '#171717', '#0B0B0C', '#FFFFFF', '#0E1A2B', '#E5484D', '#F5A623', '#7C5CFF']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** True if any field is set (drives the bar highlight). */
export function isArtActive(a: ArtDirection): boolean {
  return Boolean(
    a.vibe || a.scene || a.text || a.colorMood || a.gender || a.count || a.age || a.wardrobe || a.localize,
  )
}

/** Number of touched categories — shown as a badge on the bar button. */
export function artActiveCount(a: ArtDirection): number {
  let n = 0
  if (a.vibe) n += 1
  if (a.scene || a.text || a.colorMood) n += 1
  if (a.gender || a.count || a.age) n += 1
  if (a.wardrobe) n += 1
  if (a.localize) n += 1
  return n
}

/** Flatten the selections into one art-direction paragraph for the director. */
export function composeArtDirection(a: ArtDirection, languageLabel: string): string {
  const parts: string[] = []
  if (a.vibe) parts.push(a.vibe)

  // People / casting
  if (a.gender === 'none') {
    parts.push('No human subject — lead with the product, the typography, or a graphic concept.')
  } else if (a.gender || a.count || a.age || a.wardrobe) {
    const noun = a.gender === 'woman' ? 'woman' : a.gender === 'man' ? 'man' : 'person'
    const plural = noun === 'person' ? 'people' : `${noun}s`
    const ageWord = a.age === 'young' ? 'young-adult ' : a.age === 'mature' ? 'mature ' : a.age === 'adult' ? 'adult ' : ''
    let subject: string
    if (a.count === 'group') subject = `a group of confident ${ageWord}${plural}`
    else if (a.count === 'duo') subject = `two confident ${ageWord}${plural}`
    else subject = `a confident, real-looking ${ageWord}${noun}`
    const wardrobe = a.wardrobe ? ` in ${a.wardrobe} attire` : ''
    parts.push(`Casting: ${subject}${wardrobe}, facing the viewer.`)
  }

  // Colour
  const color: string[] = []
  if (a.scene) color.push(`build the background and scene around ${a.scene}`)
  if (a.text) color.push(`set the headline text in ${a.text}`)
  const mood = COLOR_MOODS.find((m) => m.key === a.colorMood)
  if (mood) color.push(mood.hint)
  if (color.length) {
    color.push(
      'keep most of the frame within this palette, but reserve one vivid, high-contrast colour for the CTA button so it clearly stands out',
    )
    parts.push(`Colour direction: ${color.join('; ')}.`)
  }

  if (a.localize) {
    parts.push(`Localise the styling, casting, props and setting so it feels authentically ${languageLabel}.`)
  }

  return parts.join(' ')
}

// --------------------------------------------------------------------------
// Modal UI
// --------------------------------------------------------------------------
export function ArtDirectionModal({
  open,
  onClose,
  art,
  onChange,
  onReset,
  languageLabel,
}: {
  open: boolean
  onClose: () => void
  art: ArtDirection
  onChange: (patch: Partial<ArtDirection>) => void
  onReset: () => void
  languageLabel: string
}) {
  const preview = composeArtDirection(art, languageLabel)
  const noPeople = art.gender === 'none'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Art direction"
      description="Steer the look. Everything here is optional — the AI fills in whatever you leave blank."
      className="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onReset} disabled={!isArtActive(art)}>
            Reset
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Section title="Vibe" hint="overall look & feel">
          <div className="flex flex-wrap gap-1.5">
            {VIBE_PRESETS.map((p) => (
              <Chip
                key={p.name}
                active={art.vibe === p.value}
                onClick={() => onChange({ vibe: art.vibe === p.value ? null : p.value })}
              >
                {p.name}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Colour" hint="brand palette — the CTA stays auto high-contrast">
          <div className="flex flex-wrap items-start gap-6">
            <ColorPick label="Scene / background" value={art.scene} onChange={(v) => onChange({ scene: v })} />
            <ColorPick label="Headline text" value={art.text} onChange={(v) => onChange({ text: v })} />
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">CTA button</div>
              <div className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Auto · high-contrast
              </div>
              <div className="text-[11px] text-muted-foreground">picked for max pop</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {COLOR_MOODS.map((m) => (
              <Chip
                key={m.key}
                active={art.colorMood === m.key}
                onClick={() => onChange({ colorMood: art.colorMood === m.key ? null : m.key })}
              >
                {m.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="People" hint="who's in the ad">
          <div className="flex flex-wrap gap-1.5">
            {GENDERS.map((g) => (
              <Chip
                key={g.key}
                active={art.gender === g.key}
                onClick={() => onChange({ gender: art.gender === g.key ? null : g.key })}
              >
                {g.label}
              </Chip>
            ))}
          </div>
          {!noPeople && (
            <div className="mt-3 flex flex-wrap gap-6">
              <SubRow label="Count">
                {COUNTS.map((c) => (
                  <Chip
                    key={c.key}
                    small
                    active={art.count === c.key}
                    onClick={() => onChange({ count: art.count === c.key ? null : c.key })}
                  >
                    {c.label}
                  </Chip>
                ))}
              </SubRow>
              <SubRow label="Age">
                {AGES.map((c) => (
                  <Chip
                    key={c.key}
                    small
                    active={art.age === c.key}
                    onClick={() => onChange({ age: art.age === c.key ? null : c.key })}
                  >
                    {c.label}
                  </Chip>
                ))}
              </SubRow>
            </div>
          )}
        </Section>

        {!noPeople && (
          <Section title="Wardrobe" hint="what they're wearing">
            <div className="flex flex-wrap gap-1.5">
              {WARDROBES.map((w) => (
                <Chip key={w} active={art.wardrobe === w} onClick={() => onChange({ wardrobe: art.wardrobe === w ? null : w })}>
                  {cap(w)}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        <Section title="Local elements" hint="match the audience">
          <button
            type="button"
            onClick={() => onChange({ localize: !art.localize })}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
              art.localize
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border',
                art.localize ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
              )}
            >
              {art.localize && <Check className="h-3 w-3" />}
            </span>
            Localise visuals to {languageLabel}
          </button>
        </Section>

        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            What the director will read
          </div>
          {preview ? (
            <p className="text-sm leading-relaxed text-foreground/90">{preview}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">Nothing set yet — the AI will choose freely.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

// --------------------------------------------------------------------------
// Small presentational helpers
// --------------------------------------------------------------------------
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  small,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border font-medium transition-colors',
        small ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border bg-secondary text-muted-foreground hover:border-foreground/25 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function ColorPick({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <label
          className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border"
          style={value ? { backgroundColor: value } : undefined}
          title="Pick a custom colour"
        >
          {!value && <span className="text-[9px] uppercase text-muted-foreground">auto</span>}
          <input
            type="color"
            value={value ?? '#21F1A8'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {value ? (
          <>
            <code className="font-mono text-xs text-foreground/80">{value.toUpperCase()}</code>
            <button
              type="button"
              onClick={() => onChange(null)}
              title="Clear (auto)"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Auto</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            onClick={() => onChange(s)}
            className={cn(
              'h-5 w-5 rounded border transition-transform hover:scale-110',
              value && value.toLowerCase() === s.toLowerCase() ? 'border-primary ring-2 ring-primary/30' : 'border-border',
            )}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>
    </div>
  )
}

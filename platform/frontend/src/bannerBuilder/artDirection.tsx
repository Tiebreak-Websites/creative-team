// Structured art direction for the Banner Builder — a tabbed creative brief.
//
// None of this is sent as discrete fields — the GPT-5.5 creative director only
// consumes a free-text `style`, so `composeArtDirection` flattens the user's
// selections into one art-direction paragraph appended to whatever they typed.
// The CTA colour is intentionally NOT a control: the director always picks a
// high-contrast button colour itself. Everything here is optional — leave a
// control blank and the AI decides.
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  Aperture,
  Bookmark,
  Check,
  Globe,
  LayoutGrid,
  Loader2,
  Palette,
  Shirt,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ColorPicker } from '@/components/ColorPicker'
import { createPreset, deletePreset, listPresets, type Preset } from './presetsApi'
import { cn } from '@/lib/utils'

export type Gender = 'either' | 'woman' | 'man' | 'none'
export type CountOpt = 'solo' | 'duo' | 'group'
export type AgeOpt = 'young' | 'adult' | 'mature'

export interface ArtDirection {
  // Look
  medium: string | null
  subject: string | null // hero element (person / trading app / product / typographic …)
  typeStyle: string | null // headline type treatment
  mood: string | null
  lighting: string | null
  // People
  gender: Gender | null
  count: CountOpt | null
  age: AgeOpt | null
  wardrobe: string | null
  expression: string | null
  // Colour
  scene: string | null // hex
  text: string | null // hex
  colorMood: string | null // a COLOR_MOODS key (temperature)
  background: string | null
  // Layout
  alignment: string | null
  density: string | null
  focal: string | null
  framing: string | null
  // Finish
  dof: string | null
  texture: string | null
  finish: string | null
  glow: boolean
  // Context
  market: string | null // localization target market (visuals adapt; copy stays as written)
  occasion: string | null
}

export const DEFAULT_ART: ArtDirection = {
  medium: null,
  subject: null,
  typeStyle: null,
  mood: null,
  lighting: null,
  gender: null,
  count: null,
  age: null,
  wardrobe: null,
  expression: null,
  scene: null,
  text: null,
  colorMood: null,
  background: null,
  alignment: null,
  density: null,
  focal: null,
  framing: null,
  dof: null,
  texture: null,
  finish: null,
  glow: false,
  market: null,
  occasion: null,
}

// --- Option sets (key/label/phrase) ---------------------------------------
type Opt = { key: string; label: string; phrase: string }

// Hero / subject — what leads the ad (includes a mobile trading-app mockup).
const SUBJECTS: Opt[] = [
  { key: 'person', label: 'Person', phrase: 'a confident, real-looking non-celebrity human subject as the hero' },
  { key: 'app', label: 'Trading app', phrase: 'a sleek mobile trading-app interface on a modern smartphone as the hero — clean premium fintech UI with abstract, non-readable charts/graphs (no invented numbers, no real logos)' },
  { key: 'person_app', label: 'Person + app', phrase: 'a confident human subject holding a smartphone showing a sleek mobile trading app (abstract, non-readable UI)' },
  { key: 'device', label: 'Device / product', phrase: 'a premium device/product shot (smartphone or laptop) as the hero' },
  { key: 'data', label: 'Abstract market', phrase: 'an abstract, premium market/data visual as the hero — depth, upward growth cues, kept non-readable' },
  { key: 'type', label: 'Typographic', phrase: 'a bold, type-led hero with little or no photography' },
]

// Headline type treatment (advanced).
const TYPE_STYLES: Opt[] = [
  { key: 'condensed', label: 'Condensed bold', phrase: 'a tall condensed bold display headline' },
  { key: 'grotesk', label: 'Modern grotesk', phrase: 'a clean modern grotesk sans headline' },
  { key: 'serif', label: 'Elegant serif', phrase: 'an elegant, high-contrast serif headline' },
  { key: 'impact', label: 'Heavy impact', phrase: 'a heavy, poster-weight impact headline' },
  { key: 'techno', label: 'Techno mono', phrase: 'a techno, monospace-influenced headline' },
]

// Localization markets — visuals (casting, styling, props, setting) adapt to the
// market; the on-image copy stays exactly as written (it is NOT translated).
const MARKETS: Opt[] = [
  { key: 'global', label: 'Global', phrase: 'a broad, neutral global audience' },
  { key: 'us', label: 'North America', phrase: 'a North American audience' },
  { key: 'latam', label: 'Latin America', phrase: 'a Latin-American audience' },
  { key: 'brazil', label: 'Brazil', phrase: 'a Brazilian audience' },
  { key: 'india', label: 'India', phrase: 'an Indian audience' },
  { key: 'mena', label: 'Middle East', phrase: 'a Middle-Eastern / Gulf audience' },
  { key: 'sea', label: 'Southeast Asia', phrase: 'a Southeast-Asian audience' },
  { key: 'europe', label: 'Europe', phrase: 'a European audience' },
  { key: 'eastasia', label: 'East Asia', phrase: 'an East-Asian audience' },
  { key: 'africa', label: 'Africa', phrase: 'an African audience' },
]

const MEDIUMS: Opt[] = [
  { key: 'photography', label: 'Photography', phrase: 'premium advertising photography (a real-looking, non-celebrity subject)' },
  { key: '3d', label: '3D Render', phrase: 'a polished, premium 3D render' },
  { key: 'graphic', label: 'Bold Graphic', phrase: 'a bold graphic / typographic poster — type-led, little or no photography' },
  { key: 'illustration', label: 'Illustration', phrase: 'a modern flat / vector illustration' },
  { key: 'cinematic', label: 'Cinematic', phrase: 'a cinematic, filmic frame with real depth' },
]

const MOODS: Opt[] = [
  { key: 'premium', label: 'Premium', phrase: 'premium and aspirational' },
  { key: 'energetic', label: 'Energetic', phrase: 'energetic and high-energy' },
  { key: 'calm', label: 'Calm', phrase: 'calm and reassuring' },
  { key: 'bold', label: 'Bold / Edgy', phrase: 'bold and edgy' },
  { key: 'corporate', label: 'Corporate', phrase: 'clean and corporate-professional' },
  { key: 'playful', label: 'Playful', phrase: 'playful and friendly' },
]

const LIGHTINGS: Opt[] = [
  { key: 'soft', label: 'Soft', phrase: 'soft, natural lighting' },
  { key: 'studio', label: 'Studio', phrase: 'clean studio lighting' },
  { key: 'dramatic', label: 'Dramatic', phrase: 'dramatic, high-contrast directional lighting' },
  { key: 'neon', label: 'Neon', phrase: 'moody neon / rim lighting' },
  { key: 'golden', label: 'Golden hour', phrase: 'warm golden-hour lighting' },
]

export const COLOR_MOODS: { key: string; label: string; hint: string }[] = [
  { key: 'warm', label: 'Warm', hint: 'a warm, inviting colour temperature' },
  { key: 'cool', label: 'Cool', hint: 'a cool, calm colour temperature' },
  { key: 'pop', label: 'High-contrast Pop', hint: 'bold, saturated, high-contrast colour' },
  { key: 'pastel', label: 'Pastel', hint: 'soft, light pastel tones' },
  { key: 'mono', label: 'Mono + Accent', hint: 'a near-monochrome palette lifted by a single accent' },
]

const BACKGROUNDS: Opt[] = [
  { key: 'solid', label: 'Solid', phrase: 'a clean solid-colour background' },
  { key: 'gradient', label: 'Gradient', phrase: 'a smooth gradient background' },
  { key: 'dark', label: 'Dark', phrase: 'a deep, dark background' },
  { key: 'light', label: 'Light', phrase: 'a bright, airy light background' },
  { key: 'textured', label: 'Textured', phrase: 'a subtly textured, depth-rich background' },
]

const EXPRESSIONS: Opt[] = [
  { key: 'confident', label: 'Confident', phrase: 'a confident, self-assured expression' },
  { key: 'welcoming', label: 'Welcoming', phrase: 'a warm, welcoming expression' },
  { key: 'serious', label: 'Serious', phrase: 'a focused, serious expression' },
  { key: 'joyful', label: 'Joyful', phrase: 'a genuine, joyful expression' },
]

const ALIGNMENTS: Opt[] = [
  { key: 'centered', label: 'Centered', phrase: 'Compose symmetrically — CENTER the headline, supporting copy and CTA together on one shared axis' },
  { key: 'left', label: 'Left', phrase: 'Left-align the headline, copy and CTA as one stack, with the subject to the right' },
  { key: 'right', label: 'Right', phrase: 'Right-align the headline, copy and CTA as one stack, with the subject to the left' },
]

const DENSITIES: Opt[] = [
  { key: 'minimal', label: 'Minimal', phrase: 'keep it minimal with generous negative space and few elements' },
  { key: 'balanced', label: 'Balanced', phrase: 'a balanced composition with clear breathing room' },
  { key: 'rich', label: 'Rich', phrase: 'a rich, layered composition with supporting graphic detail' },
]

const FOCALS: Opt[] = [
  { key: 'subject', label: 'Subject', phrase: 'make the human subject the clear focal point' },
  { key: 'typography', label: 'Typography', phrase: 'make the headline typography the hero / focal point' },
  { key: 'product', label: 'Product', phrase: 'make the product the focal point' },
  { key: 'balanced', label: 'Balanced', phrase: 'balance subject and typography as co-equal heroes' },
]

const FRAMINGS: Opt[] = [
  { key: 'closeup', label: 'Close-up', phrase: 'frame the subject tight (close-up, shoulders-up)' },
  { key: 'medium', label: 'Medium', phrase: 'frame the subject at medium distance (waist-up)' },
  { key: 'wide', label: 'Wide', phrase: 'frame wide, the subject within an environment' },
]

const DOFS: Opt[] = [
  { key: 'shallow', label: 'Shallow', phrase: 'shallow depth of field with a softly blurred background' },
  { key: 'deep', label: 'Deep focus', phrase: 'deep focus, everything crisp' },
]

const TEXTURES: Opt[] = [
  { key: 'clean', label: 'Clean', phrase: 'a clean, crisp finish' },
  { key: 'grain', label: 'Film grain', phrase: 'subtle film grain' },
  { key: 'paper', label: 'Paper', phrase: 'a tactile paper / print texture' },
]

const FINISHES: Opt[] = [
  { key: 'matte', label: 'Matte', phrase: 'a matte finish' },
  { key: 'glossy', label: 'Glossy', phrase: 'a glossy, high-shine finish' },
]

const OCCASIONS: Opt[] = [
  { key: 'sale', label: 'Sale / offer', phrase: 'frame it around a limited-time sale or offer' },
  { key: 'launch', label: 'New launch', phrase: 'frame it as a new launch / announcement' },
  { key: 'holiday', label: 'Holiday', phrase: 'give it a festive holiday feel' },
  { key: 'seasonal', label: 'Seasonal', phrase: 'give it a seasonal feel' },
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const phraseOf = (opts: Opt[], key: string | null) => opts.find((o) => o.key === key)?.phrase

/** True if any field is set (drives the bar highlight). */
export function isArtActive(a: ArtDirection): boolean {
  return artActiveCount(a) > 0
}

/** Number of touched categories — shown as a badge on the bar button. */
export function artActiveCount(a: ArtDirection): number {
  let n = 0
  if (a.medium || a.subject || a.typeStyle || a.mood || a.lighting) n += 1
  if (a.gender || a.count || a.age || a.wardrobe || a.expression) n += 1
  if (a.scene || a.text || a.colorMood || a.background) n += 1
  if (a.alignment || a.density || a.focal || a.framing) n += 1
  if (a.dof || a.texture || a.finish || a.glow) n += 1
  if (a.market || a.occasion) n += 1
  return n
}

/** Flatten the selections into one art-direction paragraph for the director. */
export function composeArtDirection(a: ArtDirection, languageLabel: string): string {
  const parts: string[] = []

  // Look
  const look: string[] = []
  const med = phraseOf(MEDIUMS, a.medium)
  if (med) look.push(med)
  const subj = phraseOf(SUBJECTS, a.subject)
  if (subj) look.push(subj)
  const typeStyle = phraseOf(TYPE_STYLES, a.typeStyle)
  if (typeStyle) look.push(typeStyle)
  const mood = phraseOf(MOODS, a.mood)
  if (mood) look.push(mood)
  const light = phraseOf(LIGHTINGS, a.lighting)
  if (light) look.push(light)
  if (look.length) parts.push(`Look: ${look.join('; ')}.`)

  // People / casting
  if (a.gender === 'none') {
    parts.push('No human subject — lead with the product, the typography, or a graphic concept.')
  } else if (a.gender || a.count || a.age || a.wardrobe || a.expression) {
    const noun = a.gender === 'woman' ? 'woman' : a.gender === 'man' ? 'man' : 'person'
    const plural = noun === 'person' ? 'people' : `${noun}s`
    const ageWord = a.age === 'young' ? 'young-adult ' : a.age === 'mature' ? 'mature ' : a.age === 'adult' ? 'adult ' : ''
    let subject: string
    if (a.count === 'group') subject = `a group of confident ${ageWord}${plural}`
    else if (a.count === 'duo') subject = `two confident ${ageWord}${plural}`
    else subject = `a confident, real-looking ${ageWord}${noun}`
    const wardrobe = a.wardrobe ? ` in ${a.wardrobe} attire` : ''
    const expr = phraseOf(EXPRESSIONS, a.expression)
    const exprClause = expr ? ` with ${expr}` : ''
    parts.push(`Casting: ${subject}${wardrobe}, facing the viewer${exprClause}.`)
  }

  // Colour
  const color: string[] = []
  if (a.scene) color.push(`build the background and scene around ${a.scene}`)
  if (a.text) color.push(`set the headline text in ${a.text}`)
  const temp = COLOR_MOODS.find((m) => m.key === a.colorMood)
  if (temp) color.push(temp.hint)
  const bg = phraseOf(BACKGROUNDS, a.background)
  if (bg) color.push(bg)
  if (color.length) {
    color.push(
      'keep most of the frame within this palette, but reserve one vivid, high-contrast colour for the CTA button so it clearly stands out',
    )
    parts.push(`Colour direction: ${color.join('; ')}.`)
  }

  // Layout
  const layout: string[] = []
  const align = phraseOf(ALIGNMENTS, a.alignment)
  if (align) layout.push(align)
  const density = phraseOf(DENSITIES, a.density)
  if (density) layout.push(density)
  const focal = phraseOf(FOCALS, a.focal)
  if (focal) layout.push(focal)
  const framing = phraseOf(FRAMINGS, a.framing)
  if (framing) layout.push(framing)
  if (layout.length) parts.push(`Composition: ${layout.join('; ')}.`)

  // Finish
  const finish: string[] = []
  const dof = phraseOf(DOFS, a.dof)
  if (dof) finish.push(dof)
  const texture = phraseOf(TEXTURES, a.texture)
  if (texture) finish.push(texture)
  const fin = phraseOf(FINISHES, a.finish)
  if (fin) finish.push(fin)
  if (a.glow) finish.push('tasteful neon glow / light accents')
  if (finish.length) parts.push(`Finish: ${finish.join('; ')}.`)

  // Context
  const occ = phraseOf(OCCASIONS, a.occasion)
  if (occ) parts.push(cap(occ) + '.')
  const market = MARKETS.find((m) => m.key === a.market)
  if (market && a.market !== 'global') {
    parts.push(
      `Localise the casting, styling, props and setting so the people and scene authentically ` +
        `represent ${market.phrase}, while keeping the on-image copy exactly as provided in ` +
        `${languageLabel} (do not translate it).`,
    )
  }

  return parts.join(' ')
}

/** The user's selections as short {label, value} tags for the banner detail view.
 * Display-only — generation is still driven by composeArtDirection's `style`. */
export function artDirectionTags(a: ArtDirection): { label: string; value: string }[] {
  const tags: { label: string; value: string }[] = []
  const lbl = (arr: { key: string; label: string }[], key: string | null) =>
    arr.find((o) => o.key === key)?.label ?? null
  const push = (label: string, value: string | null | undefined) => {
    if (value) tags.push({ label, value })
  }
  // Look
  push('Hero', lbl(SUBJECTS, a.subject))
  push('Medium', lbl(MEDIUMS, a.medium))
  push('Headline', lbl(TYPE_STYLES, a.typeStyle))
  push('Mood', lbl(MOODS, a.mood))
  push('Lighting', lbl(LIGHTINGS, a.lighting))
  // People
  if (a.gender === 'none') {
    push('People', 'No people')
  } else {
    push('Casting', lbl(GENDERS, a.gender))
    push('Count', lbl(COUNTS, a.count))
    push('Age', lbl(AGES, a.age))
    push('Wardrobe', a.wardrobe ? cap(a.wardrobe) : null)
    push('Expression', lbl(EXPRESSIONS, a.expression))
  }
  // Colour
  push('Scene', a.scene)
  push('Text', a.text)
  push('Temperature', COLOR_MOODS.find((m) => m.key === a.colorMood)?.label)
  push('Background', lbl(BACKGROUNDS, a.background))
  // Layout
  push('Alignment', lbl(ALIGNMENTS, a.alignment))
  push('Density', lbl(DENSITIES, a.density))
  push('Focal', lbl(FOCALS, a.focal))
  push('Framing', lbl(FRAMINGS, a.framing))
  // Finish
  push('Depth', lbl(DOFS, a.dof))
  push('Texture', lbl(TEXTURES, a.texture))
  push('Finish', lbl(FINISHES, a.finish))
  if (a.glow) push('Glow', 'On')
  // Context
  push('Occasion', lbl(OCCASIONS, a.occasion))
  if (a.market && a.market !== 'global') push('Market', lbl(MARKETS, a.market))
  return tags
}

/** A tasteful random brief for quick inspiration ("Surprise me"). */
function randomArt(): Partial<ArtDirection> {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
  const maybe = <T,>(v: T): T | null => (Math.random() < 0.7 ? v : null)
  return {
    ...DEFAULT_ART,
    medium: maybe(pick(MEDIUMS).key),
    subject: maybe(pick(SUBJECTS).key),
    typeStyle: maybe(pick(TYPE_STYLES).key),
    mood: maybe(pick(MOODS).key),
    lighting: maybe(pick(LIGHTINGS).key),
    gender: pick(GENDERS).key,
    count: maybe(pick(COUNTS).key),
    age: maybe(pick(AGES).key),
    wardrobe: maybe(pick(WARDROBES)),
    expression: maybe(pick(EXPRESSIONS).key),
    colorMood: maybe(pick(COLOR_MOODS).key),
    background: maybe(pick(BACKGROUNDS).key),
    alignment: maybe(pick(ALIGNMENTS).key),
    density: maybe(pick(DENSITIES).key),
    focal: maybe(pick(FOCALS).key),
    dof: maybe(pick(DOFS).key),
    glow: Math.random() < 0.3,
  }
}

// --------------------------------------------------------------------------
// Tabbed modal UI
// --------------------------------------------------------------------------
type TabKey = 'look' | 'people' | 'colour' | 'layout' | 'finish' | 'presets'

const TABS: { key: TabKey; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'look', label: 'Look', icon: Wand2 },
  { key: 'people', label: 'People', icon: Users },
  { key: 'colour', label: 'Colour', icon: Palette },
  { key: 'layout', label: 'Layout', icon: LayoutGrid },
  { key: 'finish', label: 'Finish', icon: Aperture },
  { key: 'presets', label: 'Presets', icon: Bookmark },
]

function tabCount(a: ArtDirection, t: TabKey): number {
  const set = (...vals: unknown[]) => vals.filter(Boolean).length
  switch (t) {
    case 'look':
      return set(a.medium, a.subject, a.typeStyle, a.mood, a.lighting)
    case 'people':
      return set(a.gender, a.count, a.age, a.wardrobe, a.expression)
    case 'colour':
      return set(a.scene, a.text, a.colorMood, a.background)
    case 'layout':
      return set(a.alignment, a.density, a.focal, a.framing)
    case 'finish':
      return set(a.dof, a.texture, a.finish, a.glow, a.market, a.occasion)
    case 'presets':
      return 0
  }
}

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
  const [tab, setTab] = useState<TabKey>('look')
  const preview = composeArtDirection(art, languageLabel)
  const noPeople = art.gender === 'none'
  const pickOne = (field: keyof ArtDirection, key: string) =>
    onChange({ [field]: (art[field] as string | null) === key ? null : key } as Partial<ArtDirection>)

  // ---- Presets: save / load ONLY the Art-Director settings (shared library) ----
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)
  useEffect(() => {
    if (open) listPresets().then(setPresets).catch(() => {})
  }, [open])
  async function savePreset() {
    const name = presetName.trim()
    if (!name) return
    setPresetBusy(true)
    setPresetError(null)
    try {
      const p = await createPreset(name, { art })
      setPresets((prev) => [...prev, p])
      setPresetName('')
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Could not save the preset.')
    } finally {
      setPresetBusy(false)
    }
  }
  function loadPreset(p: Preset) {
    if (p.data?.art) onChange({ ...DEFAULT_ART, ...p.data.art })
  }
  function removePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id))
    void deletePreset(id).catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Art Director"
      description="Brief your creative director across the tabs. Everything is optional — leave it blank and the AI decides."
      className="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onChange(randomArt())} className="mr-auto gap-1.5">
            <Shuffle className="h-4 w-4" /> Surprise me
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} disabled={!isArtActive(art)}>
            Reset
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Tab bar */}
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-secondary/40 p-1.5">
          {TABS.map((t) => {
            const n = tabCount(art, t.key)
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-display text-[13px] font-medium transition-colors',
                  active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="h-4 w-4" />
                <span>{t.label}</span>
                {n > 0 && (
                  <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {n}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Panels */}
        <div className="min-h-[18rem] animate-fade-in">
          {tab === 'look' && (
            <div className="space-y-4">
              <ChipCard icon={Wand2} title="Hero / subject" hint="What leads the ad" opts={SUBJECTS} value={art.subject} onPick={(k) => pickOne('subject', k)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <ChipCard icon={Aperture} title="Medium" opts={MEDIUMS} value={art.medium} onPick={(k) => pickOne('medium', k)} />
                <ChipCard icon={Type} title="Headline type" opts={TYPE_STYLES} value={art.typeStyle} onPick={(k) => pickOne('typeStyle', k)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ChipCard icon={Sparkles} title="Mood" opts={MOODS} value={art.mood} onPick={(k) => pickOne('mood', k)} />
                <ChipCard icon={Sun} title="Lighting" opts={LIGHTINGS} value={art.lighting} onPick={(k) => pickOne('lighting', k)} />
              </div>
            </div>
          )}

          {tab === 'people' && (
            <div className="space-y-4">
              <SectionCard icon={Users} title="Who's in the ad" hint="Casting">
                <div className="flex flex-wrap gap-2">
                  {GENDERS.map((g) => (
                    <Chip key={g.key} active={art.gender === g.key} onClick={() => pickOne('gender', g.key)}>
                      {g.label}
                    </Chip>
                  ))}
                </div>
                {!noPeople && (
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <SubRow label="Count">
                      {COUNTS.map((c) => (
                        <Chip key={c.key} small active={art.count === c.key} onClick={() => pickOne('count', c.key)}>
                          {c.label}
                        </Chip>
                      ))}
                    </SubRow>
                    <SubRow label="Age">
                      {AGES.map((c) => (
                        <Chip key={c.key} small active={art.age === c.key} onClick={() => pickOne('age', c.key)}>
                          {c.label}
                        </Chip>
                      ))}
                    </SubRow>
                  </div>
                )}
              </SectionCard>
              {!noPeople && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SectionCard icon={Shirt} title="Wardrobe" hint="What they wear">
                    <div className="flex flex-wrap gap-2">
                      {WARDROBES.map((w) => (
                        <Chip key={w} active={art.wardrobe === w} onClick={() => pickOne('wardrobe', w)}>
                          {cap(w)}
                        </Chip>
                      ))}
                    </div>
                  </SectionCard>
                  <ChipCard icon={Sparkles} title="Expression" opts={EXPRESSIONS} value={art.expression} onPick={(k) => pickOne('expression', k)} />
                </div>
              )}
            </div>
          )}

          {tab === 'colour' && (
            <div className="space-y-4">
              <SectionCard icon={Palette} title="Palette" hint="The CTA stays auto high-contrast">
                <div className="flex flex-wrap items-start gap-5">
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
                <SubRow label="Temperature">
                  {COLOR_MOODS.map((m) => (
                    <Chip key={m.key} active={art.colorMood === m.key} onClick={() => pickOne('colorMood', m.key)}>
                      {m.label}
                    </Chip>
                  ))}
                </SubRow>
              </SectionCard>
              <ChipCard icon={Palette} title="Background treatment" opts={BACKGROUNDS} value={art.background} onPick={(k) => pickOne('background', k)} />
            </div>
          )}

          {tab === 'layout' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipCard icon={LayoutGrid} title="Alignment" hint="Copy + button stay coherent" opts={ALIGNMENTS} value={art.alignment} onPick={(k) => pickOne('alignment', k)} />
              <ChipCard icon={LayoutGrid} title="Density" opts={DENSITIES} value={art.density} onPick={(k) => pickOne('density', k)} />
              <ChipCard icon={Sparkles} title="Focal point" opts={FOCALS} value={art.focal} onPick={(k) => pickOne('focal', k)} />
              <ChipCard icon={Aperture} title="Framing" opts={FRAMINGS} value={art.framing} onPick={(k) => pickOne('framing', k)} />
            </div>
          )}

          {tab === 'finish' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <ChipCard icon={Aperture} title="Depth of field" opts={DOFS} value={art.dof} onPick={(k) => pickOne('dof', k)} />
                <ChipCard icon={Sparkles} title="Texture" opts={TEXTURES} value={art.texture} onPick={(k) => pickOne('texture', k)} />
                <ChipCard icon={Sparkles} title="Finish" opts={FINISHES} value={art.finish} onPick={(k) => pickOne('finish', k)} />
                <SectionCard icon={Sparkles} title="Glow accents" hint="Neon / light pops">
                  <Toggle on={art.glow} onClick={() => onChange({ glow: !art.glow })} label="Add tasteful glow accents" />
                </SectionCard>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ChipCard icon={Sparkles} title="Occasion" opts={OCCASIONS} value={art.occasion} onPick={(k) => pickOne('occasion', k)} />
                <SectionCard
                  icon={Globe}
                  title="Localise visuals"
                  hint="Adapt people, styling & setting to a market"
                  selected={
                    art.market && art.market !== 'global'
                      ? MARKETS.find((m) => m.key === art.market)?.label
                      : null
                  }
                >
                  <div className="mb-2.5 flex items-start gap-1.5 rounded-lg border border-border bg-secondary/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      On-image copy stays in{' '}
                      <span className="font-medium text-foreground">{languageLabel}</span> — auto-detected from
                      your text. Pick a market to localise the people &amp; scene only.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {MARKETS.map((m) => (
                      <Chip key={m.key} active={art.market === m.key} onClick={() => pickOne('market', m.key)}>
                        {m.label}
                      </Chip>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </div>
          )}

          {tab === 'presets' && (
            <div className="space-y-4">
              <SectionCard
                icon={Bookmark}
                title="Save this art direction"
                hint="Saves ONLY the Art-Director settings — reuse them on any campaign"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void savePreset()
                      }
                    }}
                    placeholder="e.g. Premium fintech — India"
                    className="h-9"
                  />
                  <Button size="sm" onClick={() => void savePreset()} disabled={!presetName.trim() || presetBusy}>
                    {presetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />} Save
                  </Button>
                </div>
                {presetError && <p className="mt-1.5 text-xs text-destructive">{presetError}</p>}
              </SectionCard>

              <SectionCard icon={Bookmark} title="Saved presets" hint="Shared with the team">
                {presets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No presets yet — save your first above.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {presets.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                          {p.created_by && (
                            <div className="truncate text-[11px] text-muted-foreground">by {p.created_by}</div>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => loadPreset(p)}>
                          Load
                        </Button>
                        <button
                          type="button"
                          onClick={() => removePreset(p.id)}
                          title="Delete preset"
                          aria-label={`Delete preset ${p.name}`}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" />
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
function SectionCard({
  icon: Icon,
  title,
  hint,
  selected,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  hint?: string
  selected?: string | null
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border bg-card/50 p-4 transition-colors',
        selected ? 'border-primary/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="font-display text-sm font-semibold leading-tight text-foreground">{title}</h3>
            {selected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                <Check className="h-3 w-3" /> {selected}
              </span>
            )}
          </div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

/** A SectionCard whose body is a row of single-select chips from an option list. */
function ChipCard({
  icon,
  title,
  hint,
  opts,
  value,
  onPick,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  hint?: string
  opts: Opt[]
  value: string | null
  onPick: (key: string) => void
}) {
  const selected = opts.find((o) => o.key === value)?.label ?? null
  return (
    <SectionCard icon={icon} title={title} hint={hint} selected={selected}>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <Chip key={o.key} active={value === o.key} onClick={() => onPick(o.key)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </SectionCard>
  )
}

function SubRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold transition-all',
        small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30'
          : 'border-border bg-secondary text-foreground/80 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground',
      )}
    >
      {active && <Check className={cn(small ? 'h-3 w-3' : 'h-3.5 w-3.5', 'shrink-0')} />}
      {children}
    </button>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        on ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border',
          on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
        )}
      >
        {on && <Check className="h-3 w-3" />}
      </span>
      {label}
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
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="Pick a colour"
          className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-border transition-transform hover:scale-105"
          style={value ? { backgroundColor: value } : undefined}
        >
          {!value && <span className="text-[9px] uppercase text-muted-foreground">auto</span>}
        </button>
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

        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute left-0 top-full z-50 mt-2 rounded-xl border border-border bg-popover p-3 shadow-xl">
              <ColorPicker value={value ?? '#2563EB'} onChange={(hex) => onChange(hex)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

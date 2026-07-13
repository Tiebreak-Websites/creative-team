import { type ReactNode } from 'react'
import {
  CheckSquare,
  Download,
  Eraser,
  Eye,
  FolderPlus,
  Globe,
  HardDrive,
  ImagePlus,
  Layers,
  LayoutGrid,
  MousePointerSquareDashed,
  Newspaper,
  Palette,
  Ruler,
  ScanText,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Type,
  UserRound,
  Wand2,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'

/** Which tool the help describes — every workspace gets its own guide. */
export type HelpTool = 'generate' | 'edit' | 'lp-builder' | 'materials'

const TITLES: Record<HelpTool, { title: string; description: string }> = {
  generate: {
    title: 'How Banner Builder works',
    description: 'Describe a banner idea — the AI designs it for you, in any size.',
  },
  edit: {
    title: 'How Banner Edit works',
    description: 'Fix a finished banner — replace or remove text; the whole banner is regenerated with the same scene and layout.',
  },
  'lp-builder': {
    title: 'LP Builder',
    description: 'Landing-page generation is on its way.',
  },
  materials: {
    title: 'How LP Materials works',
    description: 'Campaign folders full of landing-page assets — customers, section cards, advertorials.',
  },
}

/**
 * "How it works" — a friendly, non-technical guide. Each tool (Generate, Edit,
 * LP Builder, LP Materials) gets its own steps and feature notes.
 */
export function HelpModal({
  open,
  onClose,
  tool = 'generate',
}: {
  open: boolean
  onClose: () => void
  tool?: HelpTool
}) {
  const meta = TITLES[tool]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meta.title}
      description={meta.description}
      className="max-w-4xl"
    >
      {tool === 'generate' && <GenerateHelp />}
      {tool === 'edit' && <EditHelp />}
      {tool === 'lp-builder' && <LpBuilderHelp />}
      {tool === 'materials' && <MaterialsHelp />}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Banner Builder · Generate
// ---------------------------------------------------------------------------
function GenerateHelp() {
  return (
    <div className="space-y-7">
      <Section title="The 3 steps">
        <div className="grid gap-3 sm:grid-cols-3">
          <StepCard n={1} icon={<LayoutGrid className="h-4 w-4" />} title="Pick your sizes">
            Choose the formats you need on the left — Facebook, Instagram, Google and more. The main square
            is always created first, then the others follow.
          </StepCard>
          <StepCard n={2} icon={<Layers className="h-4 w-4" />} title="Add your idea">
            On the right, give each version a <b>Title</b>. A subtitle and a button are optional. Add up to 5
            versions to get several different looks at once.
          </StepCard>
          <StepCard n={3} icon={<Sparkles className="h-4 w-4" />} title="Generate">
            Press <b>Generate</b>. The AI designs your banners and they appear in the middle as soon as each
            one is ready.
          </StepCard>
        </div>
        <Note>
          Only a <b>Title</b> is required. Leave everything else blank and the AI invents the concept, the
          scene, the people and the colours — and always adds a clear call-to-action button. Whatever text you
          do type is kept exactly as written.
        </Note>
      </Section>

      <Section title="What each control does">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Banner Sizes (left panel)">
            Tick every format you want. Each banner is produced at its exact pixels — a 1200×1200 really comes
            out 1200×1200, ready to use. Type an unknown size in the search to save it as a custom size.
          </Feature>
          <Feature icon={<Layers className="h-4 w-4" />} title="Versions (right panel)">
            Each version is a separate idea (Title, optional Subtitle and Button). When you add several, they
            come out as genuinely different designs — not the same layout recoloured.
          </Feature>
          <Feature icon={<Square className="h-4 w-4" />} title="Reference image">
            The square tile next to the text box. Drop in a picture and the AI copies its <b>style</b> —
            colours, mood and overall look — not the text or logos inside it.
          </Feature>
          <Feature icon={<Wand2 className="h-4 w-4" />} title="Art Director">
            Optional creative steering: the hero, the headline type, mood, lighting, colours, who’s in the
            picture, and which market to localise the visuals for. Leave anything blank and the AI chooses.
          </Feature>
          <Feature icon={<Palette className="h-4 w-4" />} title="Quality">
            <b>Medium</b> is the quick default (about a minute). <b>High</b> is sharper but takes longer. You
            can change it for any run.
          </Feature>
          <Feature icon={<Tag className="h-4 w-4" />} title="Brand">
            Pick a brand to keep the design on its colours, and choose which corner its logo sits in.
          </Feature>
          <Feature icon={<Globe className="h-4 w-4" />} title="Language">
            The language of the words shown on the banner. It’s auto-detected from what you typed — click to
            change it.
          </Feature>
          <Feature icon={<Sparkles className="h-4 w-4" />} title="Generate">
            Always available — start more batches while others are still running, and your inputs stay put. To
            stop a run, use the <b>Stop</b> button on its own card (only the person who started it sees it).
          </Feature>
        </div>
      </Section>

      <Section title="Working with your banners">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feature icon={<Eye className="h-4 w-4" />} title="View a banner">
            Hover a banner and click to open it large. Click the dark area around it, or press <b>Esc</b>, to
            close. Use the arrows to flip between banners.
          </Feature>
          <Feature icon={<Download className="h-4 w-4" />} title="Download">
            From the open view, download the banner. Files are named by version, size, then title — e.g.
            <code className="mx-1 rounded bg-secondary px-1 font-mono text-[11px]">v1-1200x1200-summer-sale</code>.
          </Feature>
          <Feature icon={<CheckSquare className="h-4 w-4" />} title="Approve the master first">
            Each version pauses after its main square so you can <b>Approve</b> it (the AI then recomposes every
            other size) or <b>Reject</b> it (keeps just the square). Only the person who started the run decides.
          </Feature>
          <Feature icon={<Sparkles className="h-4 w-4" />} title="Regenerate or edit one size">
            If a single size comes out wrong, open it and press <b>Edit prompt</b> to re-roll just that one — or
            take it to the <b>Edit</b> tool to fix only its text. A small ⚠ flags any tile worth a second look.
          </Feature>
          <Feature icon={<Ruler className="h-4 w-4" />} title="Add sizes later">
            Open any approved banner and press <b>Add sizes</b> — the picker mirrors the size groups on the left
            and recomposes the extra formats from the same master.
          </Feature>
          <Feature icon={<Trash2 className="h-4 w-4" />} title="Delete">
            Removes a banner for the whole team. The gallery is shared, so everyone sees the finished banners
            the team has made.
          </Feature>
          <Feature icon={<HardDrive className="h-4 w-4" />} title="Storage">
            The gauge at the top shows how full the shared banner storage is, so you know when it’s time to
            tidy up.
          </Feature>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Banner Builder · Edit
// ---------------------------------------------------------------------------
function EditHelp() {
  return (
    <div className="space-y-7">
      <Section title="The 3 steps">
        <div className="grid gap-3 sm:grid-cols-3">
          <StepCard n={1} icon={<ImagePlus className="h-4 w-4" />} title="Attach a banner">
            Drag &amp; drop an image, upload one, or pick any banner from the shared gallery. The tool reads
            all the text on it automatically.
          </StepCard>
          <StepCard n={2} icon={<MousePointerSquareDashed className="h-4 w-4" />} title="Mark the text">
            Drag a box over the wrong text — a floating card appears, pre-filled with what it currently says.
            Or press <b>Auto-detect</b> to mark every text block at once.
          </StepCard>
          <StepCard n={3} icon={<Sparkles className="h-4 w-4" />} title="Generate & pick">
            Type the correction and press <b>Generate</b> — one candidate appears on the right. Not right?
            Press <b>Generate more</b>; earlier takes stay for comparison. Pick the best one and it lands in
            the gallery.
          </StepCard>
        </div>
        <Note>
          How it works: the <b>whole banner is regenerated</b> with your corrections applied — same scene,
          person, layout and colors, no seams or half-repainted buttons. Because it is a fresh render, tiny
          details can vary between takes — that&rsquo;s why every take is kept side-by-side until you accept one.
          Obvious typos in your text are caught <b>before</b> a generation is spent.
        </Note>
      </Section>

      <Section title="Good to know">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feature icon={<Type className="h-4 w-4" />} title="Replace or Remove">
            Each card has two modes. <b>Replace</b> renders your new text in the original’s typography.
            <b> Remove</b> erases the marked text for good and rebuilds the background (the box turns red).
          </Feature>
          <Feature icon={<MousePointerSquareDashed className="h-4 w-4" />} title="Adjust a region">
            Double-click a box to edit it — drag to move it, pull the corner handles to make it wider or
            taller. Cards can be dragged anywhere; the dashed line always points at their region’s number.
          </Feature>
          <Feature icon={<ScanText className="h-4 w-4" />} title="Quality check">
            Every candidate is proof-read by the AI: <b>Text verified</b> means the new text rendered exactly
            (and removed text is really gone). Hold <b>Compare</b> to flip to the original.
          </Feature>
          <Feature icon={<Ruler className="h-4 w-4" />} title="After you accept">
            The corrected banner is saved to the gallery as a fresh master. The console then lets you pick
            extra sizes — they only start generating when you press <b>its</b> Generate button.
          </Feature>
          <Feature icon={<Palette className="h-4 w-4" />} title="Quality switch">
            <b>High</b> gives the cleanest text rendering; <b>low</b> is fastest for quick experiments.
          </Feature>
          <Feature icon={<Eye className="h-4 w-4" />} title="Exit">
            The ✕ in the top corner leaves the edit — it asks first if you’d lose unsaved work.
          </Feature>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LP Builder (placeholder)
// ---------------------------------------------------------------------------
function LpBuilderHelp() {
  return (
    <div className="space-y-4">
      <Note>
        <b>LP Builder is in progress.</b> It will generate full landing pages. Until it ships, use{' '}
        <b>LP Materials</b> (the tab next to it) to produce the page’s creative assets — customer photos,
        section-card images and advertorial visuals — organized per campaign.
      </Note>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LP Materials
// ---------------------------------------------------------------------------
function MaterialsHelp() {
  return (
    <div className="space-y-7">
      <Section title="The 3 steps">
        <div className="grid gap-3 sm:grid-cols-3">
          <StepCard n={1} icon={<FolderPlus className="h-4 w-4" />} title="Create a campaign">
            One campaign per landing page: upload its <b>hero image</b> (it becomes the cover and style
            anchor), give it a name, a short tag (e.g. “Malay”) and the <b>target market</b>.
          </StepCard>
          <StepCard n={2} icon={<Sparkles className="h-4 w-4" />} title="Generate assets">
            Use the console on the left — Customers, Section cards or Advertorial. The market decides who
            appears; the hero image keeps cards and advertorials on the campaign’s look.
          </StepCard>
          <StepCard n={3} icon={<Download className="h-4 w-4" />} title="Collect on the right">
            Everything lands in the assets panel, grouped by category. Click an image for full size, download
            one or zip a whole batch.
          </StepCard>
        </div>
        <Note>
          Generated images never contain text — titles and copy live on the landing page itself. If text ever
          sneaks in, a small ⚠ “text spotted” badge warns you to regenerate.
        </Note>
      </Section>

      <Section title="The generators">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feature icon={<UserRound className="h-4 w-4" />} title="Customers">
            Type a name — any language — and the profile fills in by itself (gender, age, country from the
            target market). Pick age with the −/+ stepper, add “Look” details (glasses, hijab…), and choose
            authenticity options: none selected gives a clean, still-realistic profile photo; each option adds
            real-life imperfection. Faces look into the camera with a natural slight smile.
          </Feature>
          <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Section cards">
            3–6 cards side by side, each with a title and a short sub-text — one image per card, visualizing
            its message in one shared style. Toggle <b>People</b> off for object-only scenes, or keep the{' '}
            <b>same person</b> across every image.
          </Feature>
          <Feature icon={<Newspaper className="h-4 w-4" />} title="Advertorial">
            Paste the article copy — the AI condenses it into its single strongest visual moment as one
            editorial photo. Works with or without people.
          </Feature>
          <Feature icon={<Eraser className="h-4 w-4" />} title="Regenerate & manage">
            Every image has its own regenerate button; whole generations can be zipped or deleted. Deleting a
            campaign removes everything inside it.
          </Feature>
        </div>
      </Section>

      <Section title="The dashboard">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Feature icon={<FolderPlus className="h-4 w-4" />} title="Campaign folders">
            The home screen lists every campaign — cover, tag, market, creator and image counts — with search,
            tag filters and sorting on top.
          </Feature>
          <Feature icon={<ImagePlus className="h-4 w-4" />} title="Hero category">
            The assets panel reserves a <b>Hero</b> section — hero-image variations are coming soon.
          </Feature>
        </div>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// shared presentational bits
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function StepCard({
  n,
  icon,
  title,
  children,
}: {
  n: number
  icon: ReactNode
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">
          {n}
        </span>
        <span className="text-primary">{icon}</span>
        <span className="font-display text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

function Feature({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card/60 p-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-display text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground/90">
      {children}
    </p>
  )
}

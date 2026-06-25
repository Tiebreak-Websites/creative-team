import { type ReactNode } from 'react'
import {
  CheckSquare,
  Download,
  Eye,
  Globe,
  HardDrive,
  Layers,
  LayoutGrid,
  Palette,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Wand2,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'

/**
 * "How it works" — a friendly, non-technical guide for marketers and designers:
 * the 3 steps, what every control does, and what you can do with the results.
 */
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How Banner Builder works"
      description="Describe a banner idea — the AI designs it for you, in any size."
      className="max-w-4xl"
    >
      <div className="space-y-7">
        {/* The 3 steps */}
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

        {/* The controls */}
        <Section title="What each control does">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Banner Sizes (left panel)">
              Tick every format you want. Each banner is produced at its exact pixels — a 1200×1200 really comes
              out 1200×1200, ready to use.
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
              Optional creative steering: the overall vibe, colours, who’s in the picture, what they wear, and
              whether to make it feel local. Leave anything blank and the AI chooses for you.
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
            <Feature icon={<Sparkles className="h-4 w-4" />} title="Generate / Stop">
              Starts the run. While it’s working the button becomes <b>Stop</b> — you can always stop and start a
              fresh one, and your inputs stay put.
            </Feature>
          </div>
        </Section>

        {/* After you generate */}
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
            <Feature icon={<CheckSquare className="h-4 w-4" />} title="Pick several at once">
              Tick the checkbox in the corner of any banners you want, then <b>Download</b> to get them all in a
              single zip.
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
    </Modal>
  )
}

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

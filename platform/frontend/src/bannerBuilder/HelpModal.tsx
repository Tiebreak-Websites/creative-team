import { type ReactNode } from 'react'
import { Layers, LayoutGrid, Wand2 } from 'lucide-react'
import { Modal } from '@/components/ui/modal'

/** "How it works" — a 3-step quickstart, kept deliberately minimal. */
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How Banner Builder works"
      description="Three steps — the AI fills in the rest."
      className="max-w-[54rem]"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepCard n={1} icon={<LayoutGrid className="h-4 w-4" />} title="Pick sizes">
            Choose your formats on the left. MVP is always included.
          </StepCard>
          <StepCard n={2} icon={<Layers className="h-4 w-4" />} title="Add a concept">
            Give it a Title on the right. Subtitle & button are optional.
          </StepCard>
          <StepCard n={3} icon={<Wand2 className="h-4 w-4" />} title="Direct & generate">
            Tune Art direction if you like, then hit Generate.
          </StepCard>
        </div>

        <p className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm text-foreground/90">
          Only a <b>Title</b> is required — leave the rest blank and the AI invents the concept, the casting and the
          colours, and always adds a high-contrast button.
        </p>
      </div>
    </Modal>
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-secondary/40 p-4 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <div className="flex items-center gap-1.5 font-display text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

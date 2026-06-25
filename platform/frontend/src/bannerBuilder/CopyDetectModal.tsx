import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { parseCopy, type DetectedConcept } from '../api'

const PLACEHOLDER = `Paste your copy here — one block per banner version. For example:

1
Headline: Every Trader Needs a Guru
Body: Learn to read the market with a real personal trading trainer by your side.
CTA: Schedule a Call

2
Headline: Don't Trade Alone
Body: A personal coach helps you understand the chart and build sharper skills.
CTA: Start With a Mentor

(The Headline / Body / CTA labels are optional — plain numbered or blank-line-separated blocks work too.)`

/**
 * Paste a big chunk of ad copy; the builder splits it into version cards
 * (title / subtitle / button). Closeable; Analyze fills the cards and closes.
 */
export function CopyDetectModal({
  open,
  onClose,
  onDetected,
}: {
  open: boolean
  onClose: () => void
  onDetected: (concepts: DetectedConcept[]) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const concepts = await parseCopy(text)
      if (!concepts.length) {
        setError("Couldn't detect any versions — make sure each block has at least a headline.")
        return
      }
      onDetected(concepts)
      setText('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Text Detect"
      description="Paste your ad copy and the builder splits it into version cards — title, subtitle, and button."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={analyze} disabled={!text.trim() || busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyze
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="Paste copy to detect"
          className="min-h-[300px] w-full resize-y font-mono text-xs leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">
          Up to 5 versions. Each becomes a card you can still edit before generating.
        </p>
        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

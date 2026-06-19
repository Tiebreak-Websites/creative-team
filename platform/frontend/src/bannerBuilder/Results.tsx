import type { Banner, RunData } from '../types'
import { assetUrl } from '../api'
import { Icon } from '../components/Icon'

const RUNNING = ['queued', 'running_master', 'running_recomp']

export function OutputPane({ run }: { run: RunData | null }) {
  if (!run) return <EmptyOutput />
  return (
    <>
      <RunBar run={run} />
      {run.error && (
        <div style={{ padding: '16px 24px 0' }}>
          <div className="alert err">{run.error}</div>
        </div>
      )}
      <div className="asset-grid">
        {run.banners.map((b) => (
          <AssetCard key={b.label} b={b} />
        ))}
      </div>
    </>
  )
}

function EmptyOutput() {
  return (
    <div className="empty-pane">
      <div className="inner">
        <div className="glyph">
          <Icon name="image" size={26} />
        </div>
        <h3>Your banners will appear here</h3>
        <p>Fill in the brief on the left, pick your sizes, and hit Generate.</p>
      </div>
    </div>
  )
}

function RunBar({ run }: { run: RunData }) {
  const pct = run.total ? Math.round((run.completed / run.total) * 100) : 0
  const running = RUNNING.includes(run.status)
  return (
    <div className="runbar">
      <span className="status">
        {running ? (
          <span className="spinner" />
        ) : (
          <span className={`status-dot ${run.status === 'failed' ? 'fail' : 'ok'}`} />
        )}
        {statusLabel(run.status)}
      </span>
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="count">
        {run.completed}/{run.total} ready
      </span>
    </div>
  )
}

function statusLabel(s: string): string {
  switch (s) {
    case 'queued':
      return 'Queued…'
    case 'running_master':
      return 'Rendering master concepts…'
    case 'running_recomp':
      return 'Recomposing other sizes…'
    case 'completed':
      return 'All banners ready'
    case 'partial':
      return 'Done — some frames failed'
    case 'failed':
      return 'Run failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return s
  }
}

function AssetCard({ b }: { b: Banner }) {
  const tag = b.phase === 'master' ? 'master' : 'recomposed'
  if (b.status === 'ok' && b.url) {
    const src = assetUrl(b.url)
    return (
      <div className="asset-card">
        <div className="asset-thumb">
          <img src={src} alt={b.label} loading="lazy" />
          <div className="asset-overlay">
            <a className="icon-btn" href={src} target="_blank" rel="noreferrer" title="Open full size">
              <Icon name="image" size={15} />
            </a>
            <a className="icon-btn" href={`${src}?download=1`} title="Download PNG">
              <Icon name="download" size={15} />
            </a>
          </div>
        </div>
        <div className="asset-foot">
          <span className="size">{b.size}</span>
          <span className="tag">{tag}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="asset-card placeholder">
      <div className="asset-thumb">
        <div className="ph-body">
          <div className="ph-size">
            <span className={`status-dot ${dotClass(b.status)}`} /> {b.size}
          </div>
          <div>{phLabel(b)}</div>
        </div>
      </div>
      <div className="asset-foot">
        <span className="size">{b.size}</span>
        <span className="tag">{tag}</span>
      </div>
    </div>
  )
}

function dotClass(s: string): string {
  if (s === 'ok') return 'ok'
  if (s === 'running') return 'run'
  if (s === 'pending') return 'pend'
  return 'fail'
}

function phLabel(b: Banner): string {
  if (b.status === 'pending') return 'Queued'
  if (b.status === 'running') return `Generating${b.attempts > 1 ? ` · attempt ${b.attempts}` : ''}…`
  return b.error ? `${b.status}: ${b.error}` : b.status
}

import { useContext, useState, useEffect } from 'preact/hooks'
import { WsContext, ConfigContext, RunContext } from '../app.jsx'
import { ProgressPanel } from '../components/ProgressPanel.jsx'

const formatElapsed = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const min = Math.floor(seconds / 60)
  const sec = (seconds % 60).toFixed(1)
  return `${min}m ${sec}s`
}

const formatDatetime = (date) => {
  if (!date) return '--'
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}

function useElapsedTimer(startedAt, finishedAt, isRunning) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return }
    if (finishedAt) {
      setElapsed((finishedAt - startedAt) / 1000)
      return
    }
    if (!isRunning) return
    const tick = () => setElapsed((Date.now() - startedAt.getTime()) / 1000)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, finishedAt, isRunning])
  return elapsed
}

/** Left column: error block + ProgressPanel (full height) */
export function RunLogs() {
  const run = useContext(RunContext)
  const hasOutput = run.status !== 'idle' || run.logs.length > 0

  return (
    <div style={styles.column}>
      {run.errors.length > 0 && (
        <div style={styles.errorBlock}>
          <div style={styles.errorTitle}>Errors</div>
          <ul style={styles.errorList}>
            {run.errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {hasOutput ? (
        <div style={styles.progressSection}>
          <ProgressPanel percent={run.percent} logs={run.logs} status={run.status} />
        </div>
      ) : run.errors.length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyText}>Run a simulation to see logs here</div>
        </div>
      )}
    </div>
  )
}

/** Right column: Run/Cancel, status badge, stat cards, output file list */
export function RunControls() {
  const ws = useContext(WsContext)
  const { config } = useContext(ConfigContext)
  const run = useContext(RunContext)
  const isRunning = run.status === 'running' || run.status === 'validating'
  const isComplete = run.status === 'complete'
  const isTerminal = run.status === 'complete' || run.status === 'cancelled' || run.status === 'error'
  const elapsed = useElapsedTimer(run.startedAt, run.finishedAt, isRunning)

  return (
    <div style={styles.column}>
      {/* Run / Cancel / Results controls */}
      <div style={styles.controlSection}>
        <div style={styles.controlLabel}>Simulation Controls</div>
        <div style={styles.controlRow}>
          <button
            style={styles.iconActionBtn}
            onClick={run.run}
            disabled={isRunning || isTerminal || !ws.connected}
            title={isTerminal ? 'Reset before re-running' : 'Run simulation'}
          >
            <svg width="28" height="28" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill={(isRunning || isTerminal) ? '#a3a3a3' : '#16a34a'} />
              <polygon points="6,4 6,12 12,8" fill="#fff" />
            </svg>
          </button>
          <button
            style={styles.iconActionBtn}
            onClick={run.cancel}
            disabled={!isRunning}
            title="Cancel simulation"
          >
            <svg width="28" height="28" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill={isRunning ? '#dc2626' : '#a3a3a3'} />
              <rect x="5" y="5" width="6" height="6" rx="0.5" fill="#fff" />
            </svg>
          </button>
          <button
            style={styles.iconActionBtn}
            onClick={() => {}}
            disabled={!isComplete}
            title={isComplete ? 'Simulation complete' : 'No results yet'}
          >
            <svg width="28" height="28" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill={isComplete ? '#2563eb' : '#a3a3a3'} />
              <polyline points="4.5,8.5 7,11 11.5,5.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <button
            style={styles.iconActionBtn}
            onClick={run.clearRunState}
            disabled={!isTerminal}
            title={isTerminal ? 'Reset to run again' : 'No results to reset'}
          >
            <svg width="28" height="28" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill={isTerminal ? '#eab308' : '#a3a3a3'} />
              <path d="M5.5,5 A3.5,3.5 0 1,1 5.5,11" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
              <polygon points="5.5,3.2 5.5,6.8 3.5,5" fill="#fff" />
            </svg>
          </button>

          {run.status === 'running' && <span style={styles.badgeRunning}>Running</span>}
          {run.status === 'validating' && <span style={styles.badgeRunning}>Validating</span>}
          {run.status === 'complete' && <span style={styles.badgeComplete}>Complete</span>}
          {run.status === 'cancelled' && <span style={styles.badgeCancelled}>Cancelled</span>}
          {run.status === 'error' && <span style={styles.badgeCancelled}>Error</span>}
        </div>
      </div>

      <div style={styles.infoLabel}>
        Router: <strong>{config._router || 'Not selected'}</strong>
      </div>

      {/* Stat cards */}
      <div style={styles.statsSection}>
        <div style={styles.statRow}>
          <div style={styles.stat}>
            <div style={styles.statValue}>{formatDatetime(run.startedAt)}</div>
            <div style={styles.statLabel}>Started</div>
          </div>
          <div style={styles.stat}>
            <div style={{ ...styles.statValue, ...(isRunning ? { color: 'var(--accent-bright)' } : {}) }}>
              {run.startedAt ? formatElapsed(elapsed) : '--'}
            </div>
            <div style={styles.statLabel}>Elapsed</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>{formatDatetime(run.finishedAt)}</div>
            <div style={styles.statLabel}>Finished</div>
          </div>
        </div>
        <div style={{ ...styles.statRow, marginTop: '10px' }}>
          <div style={styles.stat}>
            <div style={styles.statValue}>{run.result?.num_rivers?.toLocaleString() ?? '--'}</div>
            <div style={styles.statLabel}>Rivers</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>{run.result?.num_timesteps?.toLocaleString() ?? '--'}</div>
            <div style={styles.statLabel}>Timesteps</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>{run.result?.output_files?.length ?? '--'}</div>
            <div style={styles.statLabel}>Files</div>
          </div>
        </div>
      </div>

      {/* Output file list */}
      <div style={styles.fileSection}>
        <div style={styles.fileSectionTitle}>Output Files</div>
        {run.result?.output_files?.length > 0 ? (
          run.result.output_files.map((f, i) => (
            <div key={i} style={styles.filePath}>{f}</div>
          ))
        ) : (
          <div style={styles.filePlaceholder}>No output files yet</div>
        )}
      </div>
    </div>
  )
}

const styles = {
  column: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    padding: '16px',
    overflow: 'hidden',
    minHeight: 0,
  },
  errorBlock: {
    background: 'rgba(251, 113, 133, 0.1)',
    border: '1px solid rgba(251, 113, 133, 0.3)',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px',
    flexShrink: 0,
  },
  errorTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#fb7185',
    marginBottom: '8px',
  },
  errorList: {
    margin: '0 0 0 16px',
    color: '#fb7185',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  progressSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  controlSection: {
    marginBottom: '16px',
    flexShrink: 0,
  },
  controlLabel: {
    fontSize: '13px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: 'var(--text-primary)',
    marginBottom: '8px',
  },
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'var(--bg-elevated)',
    borderRadius: '8px',
  },
  iconActionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    padding: '4px',
    cursor: 'pointer',
    borderRadius: '50%',
    lineHeight: 0,
    opacity: 1,
    transition: 'opacity 0.1s',
  },
  infoLabel: {
    fontSize: '15px',
    color: 'var(--text-secondary)',
    marginBottom: '16px',
    flexShrink: 0,
  },
  badgeRunning: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--warning)',
    background: 'rgba(217, 119, 6, 0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  badgeComplete: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--success)',
    background: 'rgba(5, 150, 105, 0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  badgeCancelled: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--error)',
    background: 'rgba(220, 38, 38, 0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  statsSection: {
    flexShrink: 0,
    marginBottom: '16px',
  },
  statRow: {
    display: 'flex',
    gap: '10px',
  },
  stat: {
    flex: '1',
    background: 'var(--bg-elevated)',
    borderRadius: '6px',
    padding: '10px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '17px',
    fontWeight: '700',
    color: 'var(--accent-bright)',
  },
  statLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  fileSection: {
    flexShrink: 0,
    marginBottom: '16px',
  },
  fileSectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  filePath: {
    fontSize: '13px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    color: 'var(--text-secondary)',
    padding: '4px 8px',
    background: 'var(--bg-elevated)',
    borderRadius: '4px',
    marginBottom: '4px',
    wordBreak: 'break-all',
  },
  filePlaceholder: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  emptyText: {
    color: 'var(--text-muted)',
    fontSize: '15px',
  },
}

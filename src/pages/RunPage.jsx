import { useContext } from 'preact/hooks'
import { WsContext, ConfigContext, RunContext } from '../app.jsx'
import { ProgressPanel } from '../components/ProgressPanel.jsx'

const formatElapsed = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const min = Math.floor(seconds / 60)
  const sec = (seconds % 60).toFixed(1)
  return `${min}m ${sec}s`
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

  return (
    <div style={styles.column}>
      {/* Run / Cancel controls */}
      <div style={styles.controlRow}>
        {isRunning ? (
          <button class="btn-danger" onClick={run.cancel}>Cancel</button>
        ) : (
          <button class="btn-primary" onClick={run.run} disabled={!ws.connected}>
            Run Simulation
          </button>
        )}

        {run.status === 'running' && <span style={styles.badgeRunning}>Running</span>}
        {run.status === 'validating' && <span style={styles.badgeRunning}>Validating</span>}
        {run.status === 'complete' && <span style={styles.badgeComplete}>Complete</span>}
        {run.status === 'cancelled' && <span style={styles.badgeCancelled}>Cancelled</span>}
        {run.status === 'error' && <span style={styles.badgeCancelled}>Error</span>}
      </div>

      <div style={styles.infoLabel}>
        Router: <strong>{config.router || 'Not selected'}</strong>
      </div>

      {/* Stat cards — always visible, populated when data arrives */}
      <div style={styles.statsSection}>
        <div style={styles.statRow}>
          <div style={styles.stat}>
            <div style={styles.statValue}>{run.result ? formatElapsed(run.result.elapsed) : '--'}</div>
            <div style={styles.statLabel}>Elapsed</div>
          </div>
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
  controlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    flexShrink: 0,
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

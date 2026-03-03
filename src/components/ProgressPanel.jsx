import { useRef, useEffect } from 'preact/hooks'

export function ProgressPanel({ percent, logs, status }) {
  const logEndRef = useRef(null)

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const levelColor = (level) => {
    switch (level) {
      case 'ERROR':
      case 'CRITICAL':
        return '#fb7185'
      case 'WARNING':
        return '#fbbf24'
      case 'DEBUG':
        return '#475569'
      default:
        return '#94a3b8'
    }
  }

  return (
    <div style={styles.root}>
      {/* Progress bar */}
      <div style={styles.progressContainer}>
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressBar,
              width: `${Math.min(percent, 100)}%`,
            }}
          />
        </div>
        <span style={styles.progressText}>{percent.toFixed(1)}%</span>
      </div>

      {/* Log console — fills all remaining vertical space */}
      <div style={styles.console}>
        {logs.map((log, i) => (
          <div key={i} style={styles.logLine}>
            <span style={{ color: levelColor(log.level), fontWeight: '500', marginRight: '8px', fontSize: '11px' }}>
              {log.level}
            </span>
            <span style={{ color: '#cbd5e1' }}>{log.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
    flexShrink: 0,
  },
  progressTrack: {
    flex: '1',
    height: '10px',
    background: '#0f172a',
    borderRadius: '5px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #6366f1, #38bdf8)',
    borderRadius: '5px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#38bdf8',
    minWidth: '50px',
    textAlign: 'right',
  },
  console: {
    flex: 1,
    minHeight: 0,
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '12px',
    overflowY: 'auto',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    fontSize: '12px',
    lineHeight: '1.7',
  },
  logLine: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
}

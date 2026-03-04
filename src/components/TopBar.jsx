import { useState, useContext } from 'preact/hooks'
import { WsContext, WorkdirContext, RunContext } from '../app.jsx'
import { FileBrowser } from './FileBrowser.jsx'

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="8" fill="#16a34a" />
    <polygon points="6,4 6,12 12,8" fill="#fff" />
  </svg>
)

const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="8" fill="#dc2626" />
    <rect x="5" y="5" width="6" height="6" rx="0.5" fill="#fff" />
  </svg>
)

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="8" fill="#2563eb" />
    <polyline points="4.5,8.5 7,11 11.5,5.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)

const PAGES = [
  { key: 'config', label: 'Config' },
  { key: 'run', label: 'Run Simulation' },
  { key: 'results', label: 'Results' },
]

export function TopBar({ connected, activePage, onNavigate, resetAll }) {
  const ws = useContext(WsContext)
  const { workdir, setWorkdir } = useContext(WorkdirContext)
  const runCtx = useContext(RunContext)
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const handleSetWorkdir = (path) => {
    setWorkdir(path)
    ws.send({ type: 'set_workdir', path })
  }

  const isRunning = runCtx.status === 'running' || runCtx.status === 'validating'

  const handleResetConfirm = () => {
    setConfirmResetOpen(false)
    resetAll()
  }

  return (
    <header style={styles.bar}>
      <div style={styles.brand}>river-route</div>

      <button
        style={styles.resetBtn}
        onClick={() => setConfirmResetOpen(true)}
        title="Reset all"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>

      {confirmResetOpen && (
        <div style={styles.confirmBackdrop} onClick={() => setConfirmResetOpen(false)}>
          <div style={styles.confirmDialog} onClick={e => e.stopPropagation()}>
            <div style={styles.confirmTitle}>Reset Everything?</div>
            <p style={styles.confirmText}>
              This will clear all configuration, run logs, and results.
            </p>
            {isRunning && (
              <p style={styles.confirmWarning}>
                A simulation is currently running and will be cancelled.
              </p>
            )}
            <div style={styles.confirmActions}>
              <button class="btn-secondary" onClick={() => setConfirmResetOpen(false)}>Cancel</button>
              <button class="btn-danger" onClick={handleResetConfirm}>Reset</button>
            </div>
          </div>
        </div>
      )}

      <nav style={styles.nav}>
        {PAGES.map(p => {
          const isActive = activePage === p.key
          const isRun = p.key === 'run'
          const isRunning = runCtx.status === 'running' || runCtx.status === 'validating'
          const isComplete = runCtx.status === 'complete'
          const showIndicator = isRun && (isRunning || isComplete)
          return (
            <div key={p.key} style={styles.navItemGroup}>
              <button
                onClick={() => onNavigate(p.key)}
                style={{ ...styles.navBtn, ...(isActive ? styles.navActive : {}) }}
              >
                {p.label}
              </button>
              {showIndicator && (
                <span style={styles.runIndicator}>
                  {isRunning ? <StopIcon /> : <CheckIcon />}
                </span>
              )}
            </div>
          )
        })}
      </nav>

      <div style={styles.right}>
        <button
          class="btn-secondary"
          style={styles.workdirBtn}
          onClick={() => setDirBrowserOpen(true)}
          title={workdir || 'Set working directory'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span style={styles.workdirText}>
            {workdir ? workdir.split('/').pop() || workdir : 'Set working dir'}
          </span>
        </button>

        <div style={styles.status}>
          <div style={{
            ...styles.statusDot,
            background: connected ? 'var(--success)' : 'var(--error)',
          }} />
          <span style={styles.statusLabel}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <FileBrowser
        open={dirBrowserOpen}
        mode="directory"
        initialPath="~"
        onSelect={handleSetWorkdir}
        onClose={() => setDirBrowserOpen(false)}
      />
    </header>
  )
}

const styles = {
  bar: {
    position: 'relative',
    height: 'var(--topbar-height)',
    minHeight: 'var(--topbar-height)',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: '16px',
  },
  brand: {
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
  },
  nav: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '16px',
  },
  navBtn: {
    padding: '7px 16px',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '15px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
  },
  navActive: {
    background: 'var(--accent)',
    color: '#fff',
  },
  navItemGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  runIndicator: {
    display: 'flex',
    alignItems: 'center',
    lineHeight: 0,
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  workdirBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    padding: '5px 10px',
    maxWidth: '200px',
  },
  workdirText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: '0',
  },
  statusLabel: {
    fontSize: '13px',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  resetBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    padding: '4px',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    borderRadius: '4px',
    transition: 'color 0.1s',
  },
  confirmBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
  },
  confirmDialog: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    maxWidth: '380px',
    width: '90vw',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  },
  confirmTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    marginBottom: '8px',
  },
  confirmText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    marginBottom: '12px',
    lineHeight: '1.5',
  },
  confirmWarning: {
    fontSize: '13px',
    color: 'var(--error)',
    fontWeight: '500',
    background: 'rgba(220, 38, 38, 0.08)',
    padding: '8px 12px',
    borderRadius: '6px',
    marginBottom: '12px',
    lineHeight: '1.4',
  },
  confirmActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
}

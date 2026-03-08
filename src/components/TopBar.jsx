import { useState, useEffect, useContext } from 'preact/hooks'
import { WsContext, WorkdirContext, QueueContext } from '../app.jsx'
import { FileBrowser } from './FileBrowser.jsx'

const PAGES = [
  { key: 'config', label: 'Config' },
  { key: 'run', label: 'Run Queue' },
  { key: 'results', label: 'Results' },
]

export function TopBar({ connected, activePage, onNavigate, resetAll, darkMode, onToggleDark, hasRunningJobs }) {
  const ws = useContext(WsContext)
  const q = useContext(QueueContext)
  const { workdir, setWorkdir } = useContext(WorkdirContext)
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.innerWidth < 980)

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 980)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const runningCount = q.jobs.filter(j => j.status === 'running').length
  const pendingCount = q.jobs.filter(j => j.status === 'pending').length
  const failedCount = q.jobs.filter(j => j.status === 'error').length

  const handleSetWorkdir = (path) => {
    setWorkdir(path)
    ws.send({ type: 'set_workdir', path })
  }

  const handleResetConfirm = () => {
    setConfirmResetOpen(false)
    resetAll()
  }

  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <div style={styles.brandBlock}>
          <div style={styles.brand}>river-route lab</div>
          {!compact && <div style={styles.subBrand}>routing workstation</div>}
        </div>

        <nav style={styles.nav}>
          {PAGES.map(p => (
            <button
              key={p.key}
              onClick={() => onNavigate(p.key)}
              style={{ ...styles.navBtn, ...(activePage === p.key ? styles.navActive : {}) }}
            >
              {p.label}
            </button>
          ))}
        </nav>
      </div>

      <div style={styles.right}>
        {!compact && q.jobs.length > 0 && (
          <div style={styles.queueSummary}>
            <span style={styles.queueCount}>{q.jobs.length} jobs</span>
            {runningCount > 0 && <span style={{ ...styles.queueTag, color: 'var(--warning)' }}>{runningCount} running</span>}
            {pendingCount > 0 && <span style={{ ...styles.queueTag, color: 'var(--text-muted)' }}>{pendingCount} queued</span>}
            {failedCount > 0 && <span style={{ ...styles.queueTag, color: 'var(--error)' }}>{failedCount} failed</span>}
          </div>
        )}

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

        <button
          style={styles.iconBtn}
          onClick={onToggleDark}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          style={styles.iconBtn}
          onClick={() => setConfirmResetOpen(true)}
          title="Reset all"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        <div style={styles.status}>
          <div style={{
            ...styles.statusDot,
            background: connected ? 'var(--success)' : 'var(--error)',
          }} />
          {!compact && (
            <span style={styles.statusLabel}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>
      </div>

      {confirmResetOpen && (
        <div style={styles.confirmBackdrop} onClick={() => setConfirmResetOpen(false)}>
          <div style={styles.confirmDialog} onClick={e => e.stopPropagation()}>
            <div style={styles.confirmTitle}>Reset Everything?</div>
            <p style={styles.confirmText}>
              This will clear all configuration, run logs, and results.
            </p>
            {hasRunningJobs && (
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
    minHeight: 'var(--topbar-height)',
    background: 'linear-gradient(120deg, var(--bg-surface), var(--bg-elevated))',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '10px 16px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '18px',
    minWidth: 0,
  },
  brandBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    minWidth: '170px',
  },
  brand: {
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--text-primary)',
    letterSpacing: '0.4px',
    textTransform: 'lowercase',
  },
  subBrand: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    fontWeight: '600',
  },
  nav: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  navBtn: {
    padding: '7px 14px',
    borderRadius: '999px',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '700',
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.16s',
    fontFamily: 'inherit',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  navActive: {
    background: 'var(--accent)',
    color: '#fff',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  queueSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 9px',
    borderRadius: '999px',
    border: '1px solid var(--border)',
    background: 'rgba(255, 255, 255, 0.06)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  queueCount: {
    color: 'var(--text-secondary)',
    fontWeight: '700',
  },
  queueTag: {
    fontWeight: '700',
  },
  workdirBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    padding: '6px 10px',
    maxWidth: '220px',
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
    fontSize: '12px',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    fontWeight: '600',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--border)',
    padding: '6px',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    borderRadius: '999px',
    transition: 'all 0.12s',
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
    fontWeight: '700',
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
    fontWeight: '600',
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

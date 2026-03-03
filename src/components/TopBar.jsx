import { useState, useContext } from 'preact/hooks'
import { WsContext, WorkdirContext } from '../app.jsx'
import { FileBrowser } from './FileBrowser.jsx'

const PAGES = [
  { key: 'config', label: 'Config' },
  { key: 'run', label: 'Run Simulation' },
  { key: 'results', label: 'Results' },
]

export function TopBar({ connected, activePage, onNavigate }) {
  const ws = useContext(WsContext)
  const { workdir, setWorkdir } = useContext(WorkdirContext)
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false)

  const handleSetWorkdir = (path) => {
    setWorkdir(path)
    ws.send({ type: 'set_workdir', path })
  }

  return (
    <header style={styles.bar}>
      <div style={styles.brand}>river-route</div>

      <nav style={styles.nav}>
        {PAGES.map(p => (
          <button
            key={p.key}
            onClick={() => onNavigate(p.key)}
            style={{
              ...styles.navBtn,
              ...(activePage === p.key ? styles.navActive : {}),
            }}
          >
            {p.label}
          </button>
        ))}
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
    gap: '4px',
    background: 'var(--bg-elevated)',
    borderRadius: '8px',
    padding: '3px',
  },
  navBtn: {
    padding: '7px 24px',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '15px',
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
  },
  navActive: {
    background: 'var(--accent)',
    color: '#fff',
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
}

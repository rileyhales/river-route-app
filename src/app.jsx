import { createContext } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import { useWebSocket } from './hooks/useWebSocket.js'
import { TopBar } from './components/TopBar.jsx'
import { ConfigPage } from './pages/ConfigPage.jsx'
import { CodePreview } from './components/CodePreview.jsx'
import { RunControls, RunLogs } from './pages/RunPage.jsx'
import { ResultsBrowser, ResultsChart } from './pages/ResultsPage.jsx'
import './style/global.css'

export const WsContext = createContext(null)
export const ConfigContext = createContext(null)
export const WorkdirContext = createContext(null)
export const RunContext = createContext(null)

export function App() {
  const ws = useWebSocket()
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('rr_config')
      return saved ? JSON.parse(saved) : { router: 'Muskingum' }
    } catch { return { router: 'Muskingum' } }
  })

  // Persist config to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem('rr_config', JSON.stringify(config)) } catch {}
  }, [config])
  const [workdir, setWorkdir] = useState('')
  const [page, setPage] = useState(() => {
    try {
      return sessionStorage.getItem('rr_page') || 'config'
    } catch { return 'config' }
  }) // 'config' | 'run' | 'results'

  // Persist page to sessionStorage so refresh doesn't flash config page
  useEffect(() => {
    try { sessionStorage.setItem('rr_page', page) } catch {}
  }, [page])

  // Run state — lifted here so all pages can access it
  const [runStatus, setRunStatus] = useState('idle')
  const [runPercent, setRunPercent] = useState(0)
  const [runLogs, setRunLogs] = useState([])
  const [runResult, setRunResult] = useState(null)
  const [runErrors, setRunErrors] = useState([])

  // Subscribe to simulation WebSocket events
  useEffect(() => {
    const unsubs = [
      ws.on('sim_started', () => {
        setRunStatus('running')
        setRunPercent(0)
      }),
      ws.on('sim_progress', (data) => {
        setRunPercent(data.percent)
      }),
      ws.on('sim_log', (data) => {
        setRunLogs(prev => [...prev, { level: data.level, message: data.message }])
      }),
      ws.on('sim_complete', (data) => {
        setRunStatus('complete')
        setRunPercent(100)
        setRunResult(data)
      }),
      ws.on('sim_error', (data) => {
        setRunStatus('error')
        setRunErrors([data.error])
        if (data.traceback) {
          setRunLogs(prev => [...prev, { level: 'ERROR', message: data.traceback }])
        }
      }),
      ws.on('sim_cancelled', () => {
        setRunStatus('cancelled')
      }),
      // Restore state from server snapshot on reconnect
      ws.on('sim_status', (data) => {
        if (data.status === 'running') {
          setRunStatus('running')
          setRunPercent(data.percent || 0)
          setRunLogs(data.logs || [])
          setRunErrors([])
          setRunResult(null)
        } else if (data.status === 'complete') {
          setRunStatus('complete')
          setRunPercent(100)
          setRunLogs(data.logs || [])
          setRunResult(data.result || null)
          setRunErrors([])
        } else if (data.status === 'error') {
          setRunStatus('error')
          setRunLogs(data.logs || [])
          setRunErrors(data.error_info ? [data.error_info.error] : [])
          if (data.error_info?.traceback) {
            setRunLogs(prev => [...prev, { level: 'ERROR', message: data.error_info.traceback }])
          }
        }
        // idle/cancelled — leave defaults
      }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [ws])

  // Auto-navigate to Run page when simulation starts
  useEffect(() => {
    if (runStatus === 'running') setPage('run')
  }, [runStatus])

  // Auto-navigate to Results page when simulation completes
  useEffect(() => {
    if (runStatus === 'complete') setPage('results')
  }, [runStatus])

  const run = useCallback(() => {
    setRunStatus('validating')
    setRunLogs([])
    setRunPercent(0)
    setRunResult(null)
    setRunErrors([])

    const { router, ...cfgFields } = config
    ws.send({ type: 'validate_config', config: cfgFields })
    const unsub = ws.on('validation_result', (data) => {
      unsub()
      if (!data.valid) {
        setRunStatus('error')
        setRunErrors(data.errors)
        return
      }
      setRunStatus('running')
      ws.send({ type: 'run_simulation', router: router, config: cfgFields })
    })
  }, [ws, config])

  const cancel = useCallback(() => {
    ws.send({ type: 'cancel_simulation' })
  }, [ws])

  const runCtx = {
    status: runStatus,
    percent: runPercent,
    logs: runLogs,
    result: runResult,
    errors: runErrors,
    run,
    cancel,
  }

  return (
    <WsContext.Provider value={ws}>
      <ConfigContext.Provider value={{ config, setConfig, resetConfig: () => { setConfig({ router: 'Muskingum' }); try { localStorage.removeItem('rr_config') } catch {} } }}>
        <WorkdirContext.Provider value={{ workdir, setWorkdir }}>
          <RunContext.Provider value={runCtx}>
            <TopBar connected={ws.connected} activePage={page} onNavigate={setPage} />
            <div style={styles.main}>
              <div style={styles.left}>
                {page === 'config' && <ConfigPage onNavigate={setPage} />}
                {page === 'run' && <RunControls />}
                {page === 'results' && <ResultsBrowser />}
              </div>
              <div style={{
                ...styles.right,
                background: (page === 'config' || page === 'run') ? 'var(--code-bg)' : undefined,
              }}>
                {page === 'config' && <CodePreview />}
                {page === 'run' && <RunLogs />}
                {page === 'results' && <ResultsChart />}
              </div>
            </div>
          </RunContext.Provider>
        </WorkdirContext.Provider>
      </ConfigContext.Provider>
    </WsContext.Provider>
  )
}

const styles = {
  main: {
    flex: '1',
    display: 'flex',
    overflow: 'hidden',
  },
  left: {
    flex: '1',
    display: 'flex',
    overflow: 'hidden',
    minWidth: '0',
  },
  right: {
    flex: '1',
    display: 'flex',
    overflow: 'hidden',
    minWidth: '0',
    borderLeft: '1px solid var(--border)',
  },
}

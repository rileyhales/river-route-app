import { createContext } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { useWebSocket } from './hooks/useWebSocket.js'
import { TopBar } from './components/TopBar.jsx'
import { ConfigPage } from './pages/ConfigPage.jsx'
import { CodePreview, resolveDischargeDir } from './components/CodePreview.jsx'
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
      return saved ? JSON.parse(saved) : { _router: 'Muskingum' }
    } catch { return { _router: 'Muskingum' } }
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
  const [startedAt, setStartedAt] = useState(null)
  const [finishedAt, setFinishedAt] = useState(null)

  // Subscribe to simulation WebSocket events
  useEffect(() => {
    const unsubs = [
      ws.on('sim_started', () => {
        setRunStatus('running')
        setRunPercent(0)
        setStartedAt(new Date())
        setFinishedAt(null)
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
        setFinishedAt(new Date())
      }),
      ws.on('sim_error', (data) => {
        setRunStatus('error')
        setRunErrors([data.error])
        setFinishedAt(new Date())
        if (data.traceback) {
          setRunLogs(prev => [...prev, { level: 'ERROR', message: data.traceback }])
        }
      }),
      ws.on('sim_cancelled', () => {
        setRunStatus('cancelled')
        setFinishedAt(new Date())
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

  // Auto-navigate on status transitions (not on restored state from server snapshot)
  const prevRunStatus = useRef(runStatus)
  useEffect(() => {
    const prev = prevRunStatus.current
    prevRunStatus.current = runStatus
    // Only navigate if this is a real transition, not initial/restored state
    if (prev === 'idle' && runStatus !== 'idle') return // skip snapshot restores
    if (runStatus === 'running' && prev === 'validating') setPage('run')
    if (runStatus === 'complete' && prev === 'running') setPage('results')
  }, [runStatus])

  const run = useCallback(() => {
    setRunStatus('validating')
    setStartedAt(new Date())
    setFinishedAt(null)
    setRunLogs([])
    setRunPercent(0)
    setRunResult(null)
    setRunErrors([])

    const { _router: router, ...cfgFields } = resolveDischargeDir(config)
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

  const clearRunState = useCallback(() => {
    if (runStatus === 'running' || runStatus === 'validating') {
      ws.send({ type: 'cancel_simulation' })
    }
    setRunStatus('idle')
    setRunPercent(0)
    setRunLogs([])
    setRunResult(null)
    setRunErrors([])
    setStartedAt(null)
    setFinishedAt(null)
  }, [ws, runStatus])

  const resetAll = useCallback(() => {
    clearRunState()
    setConfig({ _router: 'Muskingum' })
    try { localStorage.removeItem('rr_config') } catch {}
    setPage('config')
  }, [clearRunState])

  const runCtx = {
    status: runStatus,
    percent: runPercent,
    logs: runLogs,
    result: runResult,
    errors: runErrors,
    startedAt,
    finishedAt,
    run,
    cancel,
    clearRunState,
  }

  return (
    <WsContext.Provider value={ws}>
      <ConfigContext.Provider value={{ config, setConfig }}>
        <WorkdirContext.Provider value={{ workdir, setWorkdir }}>
          <RunContext.Provider value={runCtx}>
            <TopBar connected={ws.connected} activePage={page} onNavigate={setPage} resetAll={resetAll} />
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

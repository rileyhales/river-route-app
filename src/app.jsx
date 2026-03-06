import { createContext } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { useWebSocket } from './hooks/useWebSocket.js'
import { TopBar } from './components/TopBar.jsx'
import { ConfigPage } from './pages/ConfigPage.jsx'
import { CodePreview, resolveDischargeDir } from './components/CodePreview.jsx'
import { getExcludedKeys } from './components/RouterForm.jsx'
import { QueuePanel, JobLogs } from './pages/RunPage.jsx'
import { ResultsBrowser, ResultsChart } from './pages/ResultsPage.jsx'
import './style/global.css'

export const WsContext = createContext(null)
export const ConfigContext = createContext(null)
export const WorkdirContext = createContext(null)
export const QueueContext = createContext(null)

/** Prepare a raw config (from form or loaded JSON) into {router, config} ready to send.
 *  For form-built configs (have _dischargeMode/_lateralMode), resolve discharge_dir and filter excluded keys.
 *  For plain configs (uploaded JSON without _ keys), just strip _ keys and pass through. */
export function prepareJobConfig(rawConfig) {
  const isFormConfig = '_dischargeMode' in rawConfig || '_lateralMode' in rawConfig
  const router = rawConfig._router || 'Muskingum'

  if (isFormConfig) {
    const resolved = resolveDischargeDir(rawConfig)
    const excluded = getExcludedKeys(rawConfig)
    const config = {}
    for (const [k, v] of Object.entries(resolved)) {
      if (!k.startsWith('_') && !excluded.has(k)) config[k] = v
    }
    return { router, config }
  }

  // Plain config — just strip _ prefixed keys
  const config = {}
  for (const [k, v] of Object.entries(rawConfig)) {
    if (!k.startsWith('_')) config[k] = v
  }
  return { router, config }
}

export function App() {
  const ws = useWebSocket()
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('rr_dark_mode')
      return saved !== null ? saved === 'true' : true
    } catch { return true }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    try { localStorage.setItem('rr_dark_mode', String(darkMode)) } catch {}
  }, [darkMode])

  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('rr_config')
      return saved ? JSON.parse(saved) : { _router: 'Muskingum' }
    } catch { return { _router: 'Muskingum' } }
  })

  useEffect(() => {
    try { localStorage.setItem('rr_config', JSON.stringify(config)) } catch {}
  }, [config])

  const [workdir, setWorkdir] = useState('')
  const [page, setPage] = useState(() => {
    try {
      return sessionStorage.getItem('rr_page') || 'config'
    } catch { return 'config' }
  })

  useEffect(() => {
    try { sessionStorage.setItem('rr_page', page) } catch {}
  }, [page])

  // ---- Reset key — increment to remount stateful components ----
  const [resetKey, setResetKey] = useState(0)

  // ---- Queue state ----
  const [jobs, setJobs] = useState([])
  const [maxWorkers, setMaxWorkers] = useState(1)
  const [selectedJobId, setSelectedJobId] = useState(null)
  const jobsRef = useRef([])
  useEffect(() => { jobsRef.current = jobs }, [jobs])

  // Subscribe to job queue WebSocket events
  useEffect(() => {
    const unsubs = [
      // Full snapshot on reconnect
      ws.on('queue_status', (data) => {
        const restored = (data.jobs || []).map(j => ({
          id: j.id,
          name: j.name,
          router: j.router,
          status: j.status,
          percent: j.percent || 0,
          logs: [],
          result: j.result || null,
          errorInfo: j.error_info || null,
        }))
        setJobs(restored)
        setMaxWorkers(data.max_workers || 1)
      }),
      ws.on('job_started', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id ? { ...j, status: 'running', percent: 0 } : j
        ))
      }),
      ws.on('job_progress', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id ? { ...j, percent: data.percent } : j
        ))
      }),
      ws.on('job_log', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id
            ? { ...j, logs: [...j.logs, { level: data.level, message: data.message }] }
            : j
        ))
      }),
      ws.on('job_complete', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id
            ? {
                ...j,
                status: 'complete',
                percent: 100,
                result: {
                  elapsed: data.elapsed,
                  output_files: data.output_files,
                  num_rivers: data.num_rivers,
                  num_timesteps: data.num_timesteps,
                },
              }
            : j
        ))
      }),
      ws.on('job_error', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id
            ? {
                ...j,
                status: 'error',
                errorInfo: { error: data.error, traceback: data.traceback },
                logs: data.traceback
                  ? [...j.logs, { level: 'ERROR', message: data.traceback }]
                  : j.logs,
              }
            : j
        ))
      }),
      ws.on('job_cancelled', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id ? { ...j, status: 'cancelled' } : j
        ))
      }),
      ws.on('job_removed', (data) => {
        setJobs(prev => prev.filter(j => j.id !== data.job_id))
      }),
      ws.on('queue_idle', () => {
        // All jobs done — could auto-navigate
      }),
      ws.on('max_workers_set', (data) => {
        setMaxWorkers(data.count)
      }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [ws])

  // Auto-select first running job for log viewing
  useEffect(() => {
    const running = jobs.find(j => j.status === 'running')
    if (running && !selectedJobId) {
      setSelectedJobId(running.id)
    }
    // If selected job was removed, clear selection
    if (selectedJobId && !jobs.find(j => j.id === selectedJobId)) {
      setSelectedJobId(running?.id || null)
    }
  }, [jobs, selectedJobId])

  const addToQueue = useCallback((items, autostart = false) => {
    // items: array of {name, router, config}
    const newJobs = items.map(item => ({
      id: crypto.randomUUID(),
      name: item.name,
      router: item.router,
      config: item.config,
      status: 'pending',
      percent: 0,
      logs: [],
      result: null,
      errorInfo: null,
    }))

    setJobs(prev => [...prev, ...newJobs])

    // Send to backend
    ws.send({
      type: 'submit_jobs',
      jobs: newJobs.map(j => ({ id: j.id, name: j.name, router: j.router, config: j.config })),
      autostart,
    })

    return newJobs.map(j => j.id)
  }, [ws])

  const removeFromQueue = useCallback((jobId) => {
    ws.send({ type: 'remove_job', job_id: jobId })
    setJobs(prev => prev.filter(j => j.id !== jobId))
  }, [ws])

  const runQueue = useCallback(() => {
    ws.send({ type: 'run_queue' })
  }, [ws])

  const cancelJob = useCallback((jobId) => {
    ws.send({ type: 'cancel_job', job_id: jobId })
  }, [ws])

  const cancelAll = useCallback(() => {
    ws.send({ type: 'cancel_all' })
  }, [ws])

  const clearFinished = useCallback(() => {
    ws.send({ type: 'clear_finished' })
    setJobs(prev => prev.filter(j => j.status === 'pending' || j.status === 'running'))
  }, [ws])

  const clearAll = useCallback(() => {
    ws.send({ type: 'clear_all' })
    setJobs([])
    setSelectedJobId(null)
  }, [ws])

  const requeueJob = useCallback((jobId) => {
    const old = jobsRef.current.find(j => j.id === jobId)
    if (!old) return
    // Remove old, submit fresh copy
    ws.send({ type: 'remove_job', job_id: jobId })
    const newId = crypto.randomUUID()
    const newJob = {
      id: newId,
      name: old.name,
      router: old.router,
      config: old.config,
      status: 'pending',
      percent: 0,
      logs: [],
      result: null,
      errorInfo: null,
    }
    setJobs(prev => [
      ...prev.map(j => j.id === jobId ? newJob : j),
    ])
    ws.send({
      type: 'submit_jobs',
      jobs: [{ id: newId, name: old.name, router: old.router, config: old.config }],
    })
  }, [ws])

  const changeMaxWorkers = useCallback((n) => {
    ws.send({ type: 'set_max_workers', count: n })
    setMaxWorkers(n)
  }, [ws])

  const addCurrentConfig = useCallback((autostart = false) => {
    const { router, config: cleaned } = prepareJobConfig(config)
    const name = config._configName || `${router} Config`
    return addToQueue([{ name, router, config: cleaned }], autostart)
  }, [config, addToQueue])

  const resetAll = useCallback(() => {
    clearAll()
    setConfig({ _router: 'Muskingum' })
    try { localStorage.removeItem('rr_config') } catch {}
    setResetKey(k => k + 1)
    setPage('config')
  }, [clearAll])

  const queueCtx = {
    jobs,
    maxWorkers,
    selectedJobId,
    setSelectedJobId,
    addToQueue,
    addCurrentConfig,
    removeFromQueue,
    runQueue,
    cancelJob,
    cancelAll,
    requeueJob,
    clearFinished,
    clearAll,
    changeMaxWorkers,
  }

  const hasRunningJobs = jobs.some(j => j.status === 'running')

  return (
    <WsContext.Provider value={ws}>
      <ConfigContext.Provider value={{ config, setConfig }}>
        <WorkdirContext.Provider value={{ workdir, setWorkdir }}>
          <QueueContext.Provider value={queueCtx}>
            <TopBar connected={ws.connected} activePage={page} onNavigate={setPage} resetAll={resetAll} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} hasRunningJobs={hasRunningJobs} />
            <div style={styles.main}>
              <div style={styles.left}>
                {page === 'config' && <ConfigPage onNavigate={setPage} />}
                {page === 'run' && <QueuePanel />}
                <div key={`rb-${resetKey}`} style={{ display: page === 'results' ? 'flex' : 'none', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <ResultsBrowser />
                </div>
              </div>
              <div style={{
                ...styles.right,
                background: (page === 'config' || page === 'run') ? 'var(--code-bg)' : undefined,
              }}>
                {page === 'config' && <CodePreview />}
                {page === 'run' && <JobLogs />}
                <div key={`rc-${resetKey}`} style={{ display: page === 'results' ? 'flex' : 'none', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <ResultsChart />
                </div>
              </div>
            </div>
          </QueueContext.Provider>
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

import { createContext } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { useWebSocket } from './hooks/useWebSocket.js'
import { TopBar } from './components/TopBar.jsx'
import { ConfigPage } from './pages/ConfigPage.jsx'
import { CodePreview, resolveDischargeDir } from './components/CodePreview.jsx'
import { getExcludedKeys } from './components/RouterForm.jsx'
import { QueuePanel, JobLogs } from './pages/RunPage.jsx'
import { ResultsBrowser, ResultsChart } from './pages/ResultsPage.jsx'
import { inferRouter, normalizeLoadedConfig, stripEmptyValues } from './utils/configSchema.js'
import './style/global.css'

export const WsContext = createContext(null)
export const ConfigContext = createContext(null)
export const WorkdirContext = createContext(null)
export const QueueContext = createContext(null)
export const ResultsContext = createContext(null)

/** Prepare a raw config (from form or loaded JSON) into {router, config} ready to send.
 *  For form-built configs (have _dischargeMode/_lateralMode), resolve discharge_dir and filter excluded keys.
 *  For plain configs (uploaded JSON without _ keys), just strip _ keys and pass through. */
export function prepareJobConfig(rawConfig) {
  const normalized = normalizeLoadedConfig(rawConfig)
  const isFormConfig = '_dischargeMode' in normalized || '_lateralMode' in normalized
  const router = inferRouter(normalized, normalized._router || 'Muskingum')

  if (isFormConfig) {
    const resolved = resolveDischargeDir(normalized)
    const excluded = getExcludedKeys(normalized)
    const config = stripEmptyValues(
      Object.fromEntries(Object.entries(resolved).filter(([k]) => !excluded.has(k)))
    )
    return { router, config }
  }

  const config = stripEmptyValues(normalized)
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
      return saved ? normalizeLoadedConfig(JSON.parse(saved)) : { _router: 'Muskingum' }
    } catch { return { _router: 'Muskingum' } }
  })

  useEffect(() => {
    try { localStorage.setItem('rr_config', JSON.stringify(config)) } catch {}
  }, [config])

  const [workdir, setWorkdir] = useState('')
  useEffect(() => {
    if (!ws.connected) return
    const cleanup = ws.request(
      { type: 'get_workdir' },
      'workdir_set',
      (data) => {
        if (data.path) setWorkdir(data.path)
      },
      { timeout: 5000 },
    )
    return cleanup
  }, [ws, ws.connected])

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

  // ---- Results state ----
  const [validationData, setValidationData] = useState({
    sourceName: '',
    parsed: null,
    error: '',
  })

  // ---- Queue state ----
  const [jobs, setJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [queueSettings, setQueueSettings] = useState({
    maxConcurrency: 1,
  })
  const jobsRef = useRef([])
  const batchedJobUpdatesRef = useRef(new Map())
  const flushRafRef = useRef(null)
  useEffect(() => { jobsRef.current = jobs }, [jobs])

  const flushBatchedUpdates = useCallback(() => {
    flushRafRef.current = null
    const updates = batchedJobUpdatesRef.current
    batchedJobUpdatesRef.current = new Map()
    if (updates.size === 0) return

    setJobs(prev => prev.map((job) => {
      const patch = updates.get(job.id)
      if (!patch) return job

      let next = job
      if (patch.percent !== undefined || patch.progressMessage !== undefined) {
        next = {
          ...next,
          ...(patch.percent !== undefined ? { percent: patch.percent } : {}),
          ...(patch.progressMessage !== undefined ? { progressMessage: patch.progressMessage } : {}),
        }
      }
      if (patch.logs?.length) {
        const mergedLogs = [...next.logs, ...patch.logs]
        next = { ...next, logs: mergedLogs.slice(-1200) }
      }
      return next
    }))
  }, [])

  const queueJobPatch = useCallback((jobId, patch) => {
    const prev = batchedJobUpdatesRef.current.get(jobId) || {}
    const merged = {
      ...prev,
      ...patch,
      logs: [...(prev.logs || []), ...(patch.logs || [])],
    }
    batchedJobUpdatesRef.current.set(jobId, merged)
    if (flushRafRef.current == null) {
      flushRafRef.current = requestAnimationFrame(flushBatchedUpdates)
    }
  }, [flushBatchedUpdates])

  // Subscribe to job queue WebSocket events
  useEffect(() => {
    const unsubs = [
      // Full snapshot on reconnect
      ws.on('queue_status', (data) => {
        const nowMs = Date.now()
        const restored = (data.jobs || []).map((j) => {
          const startedAt = typeof j.started_at === 'number' ? j.started_at * 1000 : null
          const endedAt = typeof j.ended_at === 'number'
            ? j.ended_at * 1000
            : (startedAt != null && (j.status === 'complete' || j.status === 'error' || j.status === 'cancelled')
                ? nowMs
                : null)
          return {
            id: j.id,
            name: j.name,
            router: j.router,
            status: j.status,
            percent: j.percent || 0,
            progressMessage: j.progress_message || '',
            logs: [],
            result: j.result || null,
            errorInfo: j.error_info || null,
            startedAt,
            endedAt,
          }
        })
        setJobs(restored)
        setQueueSettings({
          maxConcurrency: data.max_concurrency || 1,
        })
      }),
      ws.on('job_started', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id
            ? {
                ...j,
                status: 'running',
                percent: 0,
                progressMessage: '',
                startedAt: j.startedAt ?? Date.now(),
                endedAt: null,
              }
            : j
        ))
      }),
      ws.on('job_progress', (data) => {
        queueJobPatch(data.job_id, { percent: data.percent, progressMessage: data.message || '' })
      }),
      ws.on('job_log', (data) => {
        queueJobPatch(data.job_id, { logs: [{ level: data.level, message: data.message }] })
      }),
      ws.on('job_complete', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id
            ? {
                ...j,
                status: 'complete',
                percent: 100,
                endedAt: Date.now(),
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
                endedAt: Date.now(),
                errorInfo: { error: data.error, traceback: data.traceback },
                progressMessage: '',
                logs: data.traceback
                  ? [...j.logs, { level: 'ERROR', message: data.traceback }]
                  : j.logs,
              }
            : j
        ))
      }),
      ws.on('job_cancelled', (data) => {
        setJobs(prev => prev.map(j =>
          j.id === data.job_id ? { ...j, status: 'cancelled', endedAt: Date.now() } : j
        ))
      }),
      ws.on('job_removed', (data) => {
        setJobs(prev => prev.filter(j => j.id !== data.job_id))
      }),
      ws.on('queue_idle', () => {
        // All jobs done — could auto-navigate
      }),
    ]
    return () => {
      unsubs.forEach(fn => fn())
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current)
        flushRafRef.current = null
      }
    }
  }, [ws, queueJobPatch])

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
      progressMessage: '',
      logs: [],
      result: null,
      errorInfo: null,
      startedAt: null,
      endedAt: null,
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

  const runQueue = useCallback((opts = {}) => {
    ws.send({ type: 'run_queue', ...opts })
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
      progressMessage: '',
      logs: [],
      result: null,
      errorInfo: null,
      startedAt: null,
      endedAt: null,
    }
    setJobs(prev => [
      ...prev.map(j => j.id === jobId ? newJob : j),
    ])
    ws.send({
      type: 'submit_jobs',
      jobs: [{ id: newId, name: old.name, router: old.router, config: old.config }],
    })
  }, [ws])

  const addCurrentConfig = useCallback((autostart = false) => {
    const { router, config: cleaned } = prepareJobConfig(config)
    const name = config._configName || `${router} Config`
    return addToQueue([{ name, router, config: cleaned }], autostart)
  }, [config, addToQueue])

  const resetAll = useCallback(() => {
    clearAll()
    setConfig({ _router: 'Muskingum' })
    setValidationData({ sourceName: '', parsed: null, error: '' })
    try { localStorage.removeItem('rr_config') } catch {}
    setResetKey(k => k + 1)
    setPage('config')
  }, [clearAll, setValidationData])

  const queueCtx = {
    jobs,
    queueSettings,
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
  }

  const hasRunningJobs = jobs.some(j => j.status === 'running')

  return (
    <WsContext.Provider value={ws}>
      <ConfigContext.Provider value={{ config, setConfig }}>
        <WorkdirContext.Provider value={{ workdir, setWorkdir }}>
          <QueueContext.Provider value={queueCtx}>
            <ResultsContext.Provider value={{ validationData, setValidationData }}>
              <TopBar connected={ws.connected} activePage={page} onNavigate={setPage} resetAll={resetAll} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} hasRunningJobs={hasRunningJobs} />
              <div class="app-main">
                <div class="app-pane app-pane-left">
                  {page === 'config' && <ConfigPage onNavigate={setPage} />}
                  {page === 'run' && <QueuePanel />}
                  <div key={`rb-${resetKey}`} style={{ display: page === 'results' ? 'flex' : 'none', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                    <ResultsBrowser />
                  </div>
                </div>
                <div class={`app-pane app-pane-right ${(page === 'config' || page === 'run') ? 'app-pane-code' : ''}`}>
                  {page === 'config' && <CodePreview />}
                  {page === 'run' && <JobLogs />}
                  <div key={`rc-${resetKey}`} style={{ display: page === 'results' ? 'flex' : 'none', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                    <ResultsChart />
                  </div>
                </div>
              </div>
            </ResultsContext.Provider>
          </QueueContext.Provider>
        </WorkdirContext.Provider>
      </ConfigContext.Provider>
    </WsContext.Provider>
  )
}

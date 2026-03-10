import { useContext, useState, useRef, useEffect } from 'preact/hooks'
import { QueueContext, prepareJobConfig } from '../app.jsx'
import { ProgressPanel } from '../components/ProgressPanel.jsx'

const STATUS_COLORS = {
  pending: { bg: 'rgba(163,163,163,0.12)', color: 'var(--text-muted)', label: 'Pending' },
  queued: { bg: 'rgba(163,163,163,0.12)', color: 'var(--text-muted)', label: 'Queued' },
  running: { bg: 'rgba(217,119,6,0.12)', color: 'var(--warning)', label: 'Running' },
  complete: { bg: 'rgba(5,150,105,0.12)', color: 'var(--success)', label: 'Complete' },
  error: { bg: 'rgba(220,38,38,0.12)', color: 'var(--error)', label: 'Error' },
  cancelled: { bg: 'rgba(220,38,38,0.08)', color: 'var(--text-muted)', label: 'Cancelled' },
}

const formatElapsed = (seconds) => {
  if (seconds == null) return ''
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const min = Math.floor(seconds / 60)
  const sec = (seconds % 60).toFixed(1)
  return `${min}m ${sec}s`
}

const formatBatchElapsed = (elapsedMs) => {
  if (elapsedMs == null) return 'Not started'
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending
  return (
    <span style={{
      fontSize: '12px',
      fontWeight: '600',
      color: s.color,
      background: s.bg,
      padding: '2px 8px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function JobContextMenu({ x, y, onClose, onRequeue }) {
  const clampedX = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 200)
  const clampedY = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 56)

  return (
    <div
      style={{
        ...styles.contextMenu,
        left: Math.max(8, clampedX),
        top: Math.max(8, clampedY),
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        style={styles.contextMenuItem}
        onClick={() => {
          onRequeue()
          onClose()
        }}
      >
        Mark for requeue
      </button>
    </div>
  )
}

function JobRow({ job, isSelected, onSelect, onRemove, onCancel, onRequeue, onContextMenu }) {
  const isActive = job.status === 'running'
  const isTerminal = job.status === 'complete' || job.status === 'error' || job.status === 'cancelled'

  return (
    <div
      onClick={() => onSelect(job.id)}
      onContextMenu={(e) => onContextMenu(e, job)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        background: isSelected ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        transition: 'background 0.1s',
      }}
    >
      {/* Progress ring for running jobs */}
      {isActive && (
        <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx="14" cy="14" r="11" fill="none" stroke="var(--warning)" strokeWidth="3"
              strokeDasharray={`${(job.percent / 100) * 69.1} 69.1`}
              strokeLinecap="round"
              transform="rotate(-90 14 14)"
            />
          </svg>
          <span style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8px',
            fontWeight: '700',
            color: 'var(--warning)',
          }}>
            {Math.round(job.percent)}
          </span>
        </div>
      )}

      {!isActive && (
        <div style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {job.status === 'complete' && (
            <svg width="20" height="20" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill="var(--success)" opacity="0.15" />
              <polyline points="4.5,8.5 7,11 11.5,5.5" fill="none" stroke="var(--success)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {job.status === 'error' && (
            <svg width="20" height="20" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill="var(--error)" opacity="0.15" />
              <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="var(--error)" strokeWidth="1.8" strokeLinecap="round" />
              <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="var(--error)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          {job.status === 'pending' && (
            <svg width="20" height="20" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="7" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.3" />
              <circle cx="8" cy="8" r="2" fill="var(--text-muted)" opacity="0.3" />
            </svg>
          )}
          {job.status === 'cancelled' && (
            <svg width="20" height="20" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="7" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.2" />
              <line x1="5" y1="8" x2="11" y2="8" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" opacity="0.3" />
            </svg>
          )}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {job.name}
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '2px',
        }}>
          <span>{job.router}</span>
          {job.result?.elapsed != null && (
            <span>{formatElapsed(job.result.elapsed)}</span>
          )}
          {job.result?.num_rivers != null && (
            <span>{job.result.num_rivers.toLocaleString()} rivers</span>
          )}
          {isActive && job.progressMessage && (
            <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
              {job.progressMessage}
            </span>
          )}
        </div>
      </div>

      <StatusBadge status={job.status} />

      {/* Action button */}
      {isActive && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(job.id) }}
          style={styles.rowBtn}
          title="Cancel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16">
            <rect x="3" y="3" width="10" height="10" rx="1" fill="var(--error)" />
          </svg>
        </button>
      )}
      {(job.status === 'error' || job.status === 'cancelled') && (
        <button
          onClick={(e) => { e.stopPropagation(); onRequeue(job.id) }}
          style={styles.rowBtn}
          title="Requeue"
        >
          <svg width="14" height="14" viewBox="0 0 16 16">
            <path d="M4.5,4 A4.5,4.5 0 1,1 4.5,12" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" />
            <polygon points="4.5,1.5 4.5,6.5 2,4" fill="var(--warning)" />
          </svg>
        </button>
      )}
      {(job.status === 'pending' || isTerminal) && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(job.id) }}
          style={styles.rowBtn}
          title="Remove"
        >
          <svg width="14" height="14" viewBox="0 0 16 16">
            <line x1="4" y1="4" x2="12" y2="12" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="4" x2="4" y2="12" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Left panel: Queue management */
export function QueuePanel() {
  const q = useContext(QueueContext)
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [contextMenu, setContextMenu] = useState(null)

  useEffect(() => {
    const max = Number(q.queueSettings?.maxConcurrency || 1)
    setMaxConcurrency(max > 0 ? max : 1)
  }, [q.queueSettings?.maxConcurrency])

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMenu)
    }
  }, [contextMenu])

  const hasJobs = q.jobs.length > 0
  const hasPending = q.jobs.some(j => j.status === 'pending')
  const hasRunning = q.jobs.some(j => j.status === 'running')
  const hasFinished = q.jobs.some(j => j.status === 'complete' || j.status === 'error' || j.status === 'cancelled')
  const completeCount = q.jobs.filter(j => j.status === 'complete').length
  const errorCount = q.jobs.filter(j => j.status === 'error').length
  const cancelledCount = q.jobs.filter(j => j.status === 'cancelled').length
  const runningCount = q.jobs.filter(j => j.status === 'running').length
  const pendingCount = q.jobs.filter(j => j.status === 'pending').length
  const [nowMs, setNowMs] = useState(() => Date.now())

  const batchStatus = hasRunning
    ? 'running'
    : hasPending
      ? 'queued'
      : errorCount > 0
        ? 'error'
        : cancelledCount > 0
          ? 'cancelled'
          : 'complete'

  const startedTimes = q.jobs
    .map(j => (typeof j.startedAt === 'number' ? j.startedAt : null))
    .filter((t) => t != null)
  const batchStartedAt = startedTimes.length ? Math.min(...startedTimes) : null

  const endedTimes = q.jobs
    .filter(j => typeof j.startedAt === 'number')
    .map(j => (typeof j.endedAt === 'number' ? j.endedAt : null))
    .filter((t) => t != null)
  const batchEndedAt = !hasRunning && endedTimes.length ? Math.max(...endedTimes) : null
  const batchElapsedMs = batchStartedAt == null ? null : (batchEndedAt ?? nowMs) - batchStartedAt

  useEffect(() => {
    if (!hasRunning || batchStartedAt == null) return
    setNowMs(Date.now())
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [hasRunning, batchStartedAt])

  const loadConfigFiles = (files) => {
    const fileList = Array.from(files).filter(f => f.name.endsWith('.json'))
    if (!fileList.length) return

    const items = []
    let loaded = 0

    fileList.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const rawConfig = JSON.parse(ev.target.result)
          const { router, config: cleaned } = prepareJobConfig(rawConfig)
          const name = file.name.replace(/\.json$/i, '')
          items.push({ name, router, config: cleaned })
        } catch {
          // Skip invalid files
        }
        loaded++
        if (loaded === fileList.length && items.length > 0) {
          items.sort((a, b) => a.name.localeCompare(b.name))
          q.addToQueue(items)
        }
      }
      reader.readAsText(file)
    })
  }

  const handleUploadConfigs = () => {
    fileInputRef.current?.click()
  }

  const handleFilesSelected = (e) => {
    loadConfigFiles(e.target.files)
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) loadConfigFiles(e.dataTransfer.files)
  }
  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setDragOver(false) }

  const handleRunAll = () => {
    if (hasPending) {
      q.runQueue({
        max_concurrency: Math.max(1, Number(maxConcurrency) || 1),
      })
    }
  }

  const handleJobContextMenu = (e, job) => {
    if (job.status !== 'complete') return
    e.preventDefault()
    e.stopPropagation()
    q.setSelectedJobId(job.id)
    setContextMenu({
      jobId: job.id,
      x: e.clientX,
      y: e.clientY,
    })
  }

  return (
    <div
      style={{ ...styles.column, ...(dragOver ? styles.dropActive : {}) }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />

      {/* Header */}
      <div style={{ flexShrink: 0, marginBottom: '16px' }}>
        <h1 class="page-title">Run Queue</h1>
        <p class="page-subtitle">
          {hasJobs
            ? `${q.jobs.length} job${q.jobs.length !== 1 ? 's' : ''}` +
              (runningCount ? ` \u2022 ${runningCount} running` : '') +
              (pendingCount ? ` \u2022 ${pendingCount} pending` : '') +
              (completeCount ? ` \u2022 ${completeCount} done` : '') +
              (errorCount ? ` \u2022 ${errorCount} failed` : '')
            : 'Add configs to the queue and run them'}
        </p>
        {hasJobs && (
          <div style={styles.batchSummary}>
            <span style={styles.batchLabel}>Batch</span>
            <StatusBadge status={batchStatus} />
            <span style={styles.batchMeta}>
              Elapsed: <strong style={styles.batchElapsed}>{formatBatchElapsed(batchElapsedMs)}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div style={styles.controlBar}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button class="btn-secondary" onClick={handleUploadConfigs}>
            Upload Configs
          </button>
        </div>
        <div style={styles.runSettings}>
          <label style={styles.runSettingLabel}>Parallel Workers</label>
          <input
            type="number"
            min="1"
            max="16"
            value={maxConcurrency}
            onInput={(e) => setMaxConcurrency(e.target.value)}
            style={{ width: '80px' }}
            disabled={hasRunning}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!hasRunning && hasPending && (
            <button class="btn-primary" onClick={handleRunAll}>
              Run All
            </button>
          )}
          {hasRunning && (
            <button class="btn-danger" onClick={q.cancelAll}>
              Cancel All
            </button>
          )}
          {hasFinished && !hasRunning && (
            <button class="btn-secondary" onClick={q.clearFinished}>
              Clear Finished
            </button>
          )}
          {hasJobs && !hasRunning && (
            <button class="btn-secondary" onClick={q.clearAll}>
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Job list */}
      <div style={styles.jobList}>
        {q.jobs.length === 0 && (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.3 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {dragOver ? 'Drop config files to add' : 'No jobs in queue'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', opacity: 0.7 }}>
              {dragOver ? '' : 'Drag & drop config JSON files or use the buttons above'}
            </div>
          </div>
        )}
        {q.jobs.map(job => (
          <JobRow
            key={job.id}
            job={job}
            isSelected={q.selectedJobId === job.id}
            onSelect={q.setSelectedJobId}
            onRemove={q.removeFromQueue}
            onCancel={q.cancelJob}
            onRequeue={q.requeueJob}
            onContextMenu={handleJobContextMenu}
          />
        ))}
      </div>

      {contextMenu && (
        <JobContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRequeue={() => q.requeueJob(contextMenu.jobId)}
        />
      )}
    </div>
  )
}

/** Right panel: Logs for selected job */
export function JobLogs() {
  const q = useContext(QueueContext)
  const selectedJob = q.jobs.find(j => j.id === q.selectedJobId)

  if (!selectedJob) {
    return (
      <div style={styles.column}>
        <div style={styles.emptyState}>
          <div style={{ color: 'var(--text-muted)', fontSize: '15px' }}>
            Select a job to view its logs
          </div>
        </div>
      </div>
    )
  }

  const hasError = selectedJob.status === 'error' && selectedJob.errorInfo

  return (
    <div style={styles.column}>
      {/* Job header */}
      <div style={{ flexShrink: 0, marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
            {selectedJob.name}
          </span>
          <StatusBadge status={selectedJob.status} />
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
          <span>Router: <strong>{selectedJob.router}</strong></span>
          {selectedJob.result?.elapsed != null && (
            <span>Elapsed: <strong>{formatElapsed(selectedJob.result.elapsed)}</strong></span>
          )}
          {selectedJob.result?.num_rivers != null && (
            <span>Rivers: <strong>{selectedJob.result.num_rivers.toLocaleString()}</strong></span>
          )}
          {Array.isArray(selectedJob.result?.output_files) && (
            <span>Files Routed: <strong>{selectedJob.result.output_files.length.toLocaleString()}</strong></span>
          )}
          {selectedJob.status === 'running' && selectedJob.progressMessage && (
            <span>Step: <strong>{selectedJob.progressMessage}</strong></span>
          )}
        </div>
      </div>

      {/* Error block */}
      {hasError && (
        <div style={styles.errorBlock}>
          <div style={styles.errorTitle}>Error</div>
          <div style={{ fontSize: '14px', color: 'var(--error)', lineHeight: '1.5' }}>
            {selectedJob.errorInfo.error}
          </div>
        </div>
      )}

      {/* Logs */}
      {selectedJob.logs.length > 0 ? (
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <ProgressPanel
            percent={selectedJob.percent}
            logs={selectedJob.logs}
            status={selectedJob.status}
          />
        </div>
      ) : selectedJob.status === 'pending' ? (
        <div style={styles.emptyState}>
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Waiting to start...
          </div>
        </div>
      ) : !hasError && (
        <div style={styles.emptyState}>
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            No logs for this job
          </div>
        </div>
      )}
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
    height: '100%',
    minHeight: 0,
  },
  dropActive: {
    outline: '2px dashed var(--accent)',
    outlineOffset: '-2px',
    background: 'rgba(99, 102, 241, 0.04)',
  },
  controlBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
    marginBottom: '12px',
  },
  runSettings: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    flexWrap: 'wrap',
  },
  runSettingLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    fontWeight: '700',
    color: 'var(--text-muted)',
  },
  batchSummary: {
    marginTop: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  batchLabel: {
    fontSize: '12px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    color: 'var(--text-muted)',
  },
  batchMeta: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  batchElapsed: {
    color: 'var(--text-primary)',
  },
  jobList: {
    flex: 1,
    overflow: 'auto',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    minHeight: 0,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    textAlign: 'center',
    padding: '32px',
  },
  rowBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    padding: '4px',
    cursor: 'pointer',
    borderRadius: '4px',
    opacity: 0.7,
    flexShrink: 0,
  },
  contextMenu: {
    position: 'fixed',
    zIndex: 20,
    minWidth: '180px',
    padding: '6px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.28)',
  },
  contextMenuItem: {
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--text-primary)',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: 'inherit',
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
    color: 'var(--error)',
    marginBottom: '6px',
  },
}

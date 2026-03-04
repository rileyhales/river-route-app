import { useState, useContext, useCallback } from 'preact/hooks'
import { WsContext, ConfigContext, RunContext } from '../app.jsx'
import { resolveDischargeDir } from '../components/CodePreview.jsx'
import { RouterForm, VALID_KEYS } from '../components/RouterForm.jsx'

const ROUTERS = ['Muskingum', 'RapidMuskingum', 'UnitMuskingum']

export function ConfigPage({ onNavigate }) {
  const ws = useContext(WsContext)
  const { config, setConfig } = useContext(ConfigContext)
  const run = useContext(RunContext)
  const [validation, setValidation] = useState(null)
  const [validating, setValidating] = useState(false)

  const isRunning = run.status === 'running' || run.status === 'validating'

  const router = config._router || 'Muskingum'

  const updateField = useCallback((key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setValidation(null)
  }, [setConfig])

  const setRouter = useCallback((r) => {
    const valid = VALID_KEYS[r]
    setConfig(prev => {
      const next = {}
      for (const key of Object.keys(prev)) {
        if (key !== '_router' && valid.has(key)) next[key] = prev[key]
      }
      next._router = r
      return next
    })
    setValidation(null)
  }, [setConfig])

  const validate = useCallback(() => {
    setValidating(true)
    setValidation(null)
    const { _router, ...cfgFields } = config

    ws.request(
      { type: 'validate_config', config: cfgFields },
      'validation_result',
      (data) => {
        setValidation(data)
        setValidating(false)
      },
      {
        timeout: 10000,
        onError: (data) => {
          setValidation({ valid: false, errors: [data.error || 'Validation failed'] })
          setValidating(false)
        },
      },
    )
  }, [ws, config])

  const saveConfig = useCallback(() => {
    const resolved = resolveDischargeDir(config)
    const blob = new Blob([JSON.stringify(resolved, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'river_route_config.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [config])

  const hasRunData = run.status !== 'idle' || run.logs.length > 0 || run.result

  const loadConfig = useCallback(() => {
    if (isRunning) {
      if (!confirm('A simulation is currently running. Loading a new config will cancel it and clear all results. Continue?')) return
    } else if (hasRunData) {
      if (!confirm('Loading a new config will clear run logs and results. Continue?')) return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const loaded = JSON.parse(ev.target.result)
          run.clearRunState()
          setConfig(loaded)
          setValidation(null)
        } catch {
          alert('Invalid JSON file')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [setConfig, isRunning, hasRunData, run])

  return (
    <div class="page">
      <div class="flex justify-between items-center" style={{ marginBottom: '24px' }}>
        <div>
          <h1 class="page-title">Configuration</h1>
          <p class="page-subtitle">Configure your river routing simulation</p>
        </div>
        <div class="flex gap-8">
          <button class="btn-secondary" onClick={loadConfig} disabled={isRunning}>Load JSON</button>
          <button class="btn-secondary" onClick={saveConfig}>Save JSON</button>
          <button class="btn-secondary" onClick={validate} disabled={validating || isRunning}>
            {validating ? 'Validating...' : 'Validate'}
          </button>
          <button class="btn-primary" onClick={() => onNavigate('run')}>
            Run Simulation
          </button>
        </div>
      </div>

      {validation && (
        <div class="card" style={{ marginBottom: '16px', borderColor: validation.valid ? 'var(--success)' : 'var(--error)' }}>
          {validation.valid ? (
            <span class="badge badge-success">Configuration is valid</span>
          ) : (
            <div>
              <span class="badge badge-error" style={{ marginBottom: '8px', display: 'inline-block' }}>Validation errors</span>
              <ul style={{ margin: '8px 0 0 20px', color: 'var(--error)', fontSize: '13px' }}>
                {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Configuration is locked while the simulation is running.
        </div>
      )}

      <fieldset disabled={isRunning} style={{ border: 'none', padding: 0, margin: 0, opacity: isRunning ? 0.6 : 1 }}>
        <div class="card">
          <div class="section">
            <div class="section-title">Router Type</div>
            <div class="form-group">
              <select value={router} onChange={(e) => setRouter(e.target.value)}>
                {ROUTERS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          <RouterForm router={router} config={config} onChange={updateField} />
        </div>
      </fieldset>
    </div>
  )
}

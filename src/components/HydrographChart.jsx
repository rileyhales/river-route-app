import { useRef, useEffect, useState } from 'preact/hooks'
import { alignTimeSeries } from '../utils/alignTimeSeries.js'
import { OVERLAY_COLORS } from '../utils/colors.js'

export function HydrographChart({ times, discharge, riverId, overlays = [] }) {
  const containerRef = useRef(null)
  const plotlyRef = useRef(null)
  const [plotlyReady, setPlotlyReady] = useState(false)
  const [plotlyError, setPlotlyError] = useState('')

  useEffect(() => {
    let alive = true
    if (plotlyRef.current) {
      setPlotlyReady(true)
      return () => { alive = false }
    }
    import('plotly.js-dist-min')
      .then((mod) => {
        if (!alive) return
        plotlyRef.current = mod.default || mod
        setPlotlyReady(true)
      })
      .catch((err) => {
        if (!alive) return
        setPlotlyError(err?.message || 'Failed to load chart engine')
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!plotlyReady || !containerRef.current || !times || !discharge || times.length === 0) return

    let timestamps, dataSeries
    if (overlays.length > 0) {
      const aligned = alignTimeSeries({ times, discharge }, overlays)
      timestamps = aligned.timestamps
      dataSeries = aligned.series
    } else {
      timestamps = times.map(t => Math.round(new Date(t).getTime() / 1000))
      dataSeries = [discharge]
    }

    const dates = timestamps.map(ts => new Date(ts * 1000).toISOString())

    const traces = [
      {
        x: dates,
        y: dataSeries[0],
        name: 'Q (m³/s)',
        line: { color: '#38bdf8', width: 2 },
        fill: overlays.length ? undefined : 'tozeroy',
        fillcolor: 'rgba(56,189,248,0.08)',
      },
      ...overlays.map((o, i) => ({
        x: dates,
        y: dataSeries[i + 1],
        name: o.label || `Overlay ${i + 1}`,
        line: {
          color: o.color || OVERLAY_COLORS[i % OVERLAY_COLORS.length],
          width: 2,
        },
      })),
    ]

    const layout = {
      title: `River ${riverId} — Discharge Hydrograph`,
      xaxis: { type: 'date' },
      yaxis: { title: 'Discharge (m³/s)' },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
    }

    const config = {
      scrollZoom: true,
      responsive: true,
      displaylogo: false,
    }

    // Use Plotly.react to update in-place (preserves legend interaction state)
    const Plotly = plotlyRef.current
    Plotly.react(containerRef.current, traces, layout, config)

    return () => {
      if (containerRef.current && plotlyRef.current) {
        plotlyRef.current.purge(containerRef.current)
      }
    }
  }, [plotlyReady, times, discharge, riverId, overlays])

  const downloadCSV = () => {
    if (!times || !discharge) return

    const headers = ['datetime', 'discharge']
    overlays.forEach((o, i) => headers.push(o.label || `overlay_${i + 1}`))

    let aligned
    if (overlays.length > 0) {
      aligned = alignTimeSeries({ times, discharge }, overlays)
    }

    const rows = []
    if (aligned) {
      for (let i = 0; i < aligned.timestamps.length; i++) {
        const dt = new Date(aligned.timestamps[i] * 1000).toISOString()
        const vals = aligned.series.map(s => s[i] ?? '')
        rows.push([dt, ...vals].join(','))
      }
    } else {
      for (let i = 0; i < times.length; i++) {
        rows.push(`${times[i]},${discharge[i]}`)
      }
    }

    const csv = headers.join(',') + '\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `river_${riverId}_hydrograph.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: '8px' }}>
        <button
          class="btn-secondary"
          style={{ fontSize: '13px', padding: '6px 14px' }}
          onClick={downloadCSV}
        >
          Download CSV
        </button>
      </div>
      {!plotlyReady && !plotlyError && (
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
          Loading chart engine...
        </div>
      )}
      {plotlyError && (
        <div style={{ padding: '16px', color: 'var(--error)', fontSize: '14px' }}>
          {plotlyError}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  )
}

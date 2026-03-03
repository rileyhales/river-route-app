/**
 * Merge primary + overlay timeseries onto a shared X axis.
 * Timestamps are rounded to the nearest second to avoid float precision issues.
 *
 * @param {{ times: string[], discharge: number[] }} primary
 * @param {{ times: string[], discharge: number[], label: string, color: string }[]} overlays
 * @returns {{ timestamps: number[], series: (number|null)[][] }}
 */
export function alignTimeSeries(primary, overlays) {
  const round = (t) => Math.round(new Date(t).getTime() / 1000)

  // Build maps: unix timestamp -> value
  const primaryMap = new Map()
  primary.times.forEach((t, i) => primaryMap.set(round(t), primary.discharge[i]))

  const overlayMaps = overlays.map((o) => {
    const m = new Map()
    o.times.forEach((t, i) => m.set(round(t), o.discharge[i]))
    return m
  })

  // Union of all timestamps
  const tsSet = new Set(primaryMap.keys())
  overlayMaps.forEach((m) => m.forEach((_, k) => tsSet.add(k)))
  const timestamps = [...tsSet].sort((a, b) => a - b)

  // Build aligned series arrays (null where missing)
  const primarySeries = timestamps.map((ts) => primaryMap.get(ts) ?? null)
  const overlaySeries = overlayMaps.map((m) =>
    timestamps.map((ts) => m.get(ts) ?? null)
  )

  return { timestamps, series: [primarySeries, ...overlaySeries] }
}

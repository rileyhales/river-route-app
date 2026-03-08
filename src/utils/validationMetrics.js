function toEpochSeconds(value) {
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.round(ms / 1000)
}

function toFiniteNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function mean(values) {
  if (!values.length) return NaN
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  return sum / values.length
}

function std(values, valueMean) {
  if (!values.length) return NaN
  let sumSq = 0
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - valueMean
    sumSq += d * d
  }
  return Math.sqrt(sumSq / values.length)
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

export function alignCommonByTime(simTimes, simDischarge, refTimes, refDischarge) {
  const refMap = new Map()
  for (let i = 0; i < refTimes.length; i++) {
    const ts = toEpochSeconds(refTimes[i])
    if (ts == null) continue
    const q = toFiniteNumber(refDischarge[i])
    if (q == null) continue
    refMap.set(ts, q)
  }

  const sim = []
  const obs = []
  for (let i = 0; i < simTimes.length; i++) {
    const ts = toEpochSeconds(simTimes[i])
    if (ts == null || !refMap.has(ts)) continue
    const sq = toFiniteNumber(simDischarge[i])
    const oq = refMap.get(ts)
    if (sq == null || oq == null) continue
    sim.push(sq)
    obs.push(oq)
  }

  return { sim, obs, nCommon: sim.length }
}

export function computeValidationMetrics(sim, obs) {
  if (!Array.isArray(sim) || !Array.isArray(obs) || sim.length !== obs.length || sim.length < 2) {
    return null
  }

  const meanObs = mean(obs)
  const meanSim = mean(sim)

  let ssRes = 0
  let ssTot = 0
  let sumDiff = 0
  let sumAbsDiff = 0
  let sumObs = 0
  for (let i = 0; i < sim.length; i++) {
    const diff = sim[i] - obs[i]
    ssRes += diff * diff
    const centeredObs = obs[i] - meanObs
    ssTot += centeredObs * centeredObs
    sumDiff += diff
    sumAbsDiff += Math.abs(diff)
    sumObs += obs[i]
  }

  const nse = ssTot > 0 ? 1 - ssRes / ssTot : NaN
  const rmse = Math.sqrt(ssRes / sim.length)
  const mae = sumAbsDiff / sim.length
  const pbias = sumObs !== 0 ? 100 * sumDiff / sumObs : NaN

  const stdSim = std(sim, meanSim)
  const stdObs = std(obs, meanObs)

  let covariance = 0
  for (let i = 0; i < sim.length; i++) {
    covariance += (sim[i] - meanSim) * (obs[i] - meanObs)
  }
  covariance /= sim.length

  const r = (stdSim > 0 && stdObs > 0) ? covariance / (stdSim * stdObs) : NaN
  const beta = meanObs !== 0 ? meanSim / meanObs : NaN
  const cvSim = meanSim !== 0 ? stdSim / meanSim : NaN
  const cvObs = meanObs !== 0 ? stdObs / meanObs : NaN
  const gamma = cvObs !== 0 ? cvSim / cvObs : NaN
  const kge = 1 - Math.sqrt((r - 1) ** 2 + (gamma - 1) ** 2 + (beta - 1) ** 2)

  return {
    kge: finiteOrNull(kge),
    kge_2012: finiteOrNull(kge),
    nse: finiteOrNull(nse),
    rmse: finiteOrNull(rmse),
    mae: finiteOrNull(mae),
    pbias: finiteOrNull(pbias),
    r: finiteOrNull(r),
    mean_sim: finiteOrNull(meanSim),
    mean_obs: finiteOrNull(meanObs),
  }
}

export function validateSeriesAgainstReference(simSeries, refSeries) {
  const aligned = alignCommonByTime(
    simSeries?.times || [],
    simSeries?.discharge || [],
    refSeries?.times || [],
    refSeries?.discharge || [],
  )
  if (aligned.nCommon < 2) {
    return {
      ok: false,
      nCommon: aligned.nCommon,
      error: `Only ${aligned.nCommon} common timesteps`,
    }
  }
  const metrics = computeValidationMetrics(aligned.sim, aligned.obs)
  if (!metrics) {
    return {
      ok: false,
      nCommon: aligned.nCommon,
      error: 'Insufficient data to compute validation metrics',
    }
  }
  return { ok: true, nCommon: aligned.nCommon, metrics }
}

export function isGoodValidationMetric(key, value) {
  if (!Number.isFinite(value)) return undefined
  if (key === 'kge' || key === 'nse') return value > 0.5
  if (key === 'pbias') return Math.abs(value) < 25
  return undefined
}

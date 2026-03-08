import test from 'node:test'
import assert from 'node:assert/strict'
import {
  alignCommonByTime,
  computeValidationMetrics,
  validateSeriesAgainstReference,
  isGoodValidationMetric,
} from './validationMetrics.js'

function approx(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`)
}

test('alignCommonByTime aligns by timestamp intersection', () => {
  const aligned = alignCommonByTime(
    ['2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z', '2020-01-01T02:00:00Z'],
    [10, 11, 12],
    ['2020-01-01T01:00:00Z', '2020-01-01T02:00:00Z', '2020-01-01T03:00:00Z'],
    [20, 21, 22],
  )
  assert.equal(aligned.nCommon, 2)
  assert.deepEqual(aligned.sim, [11, 12])
  assert.deepEqual(aligned.obs, [20, 21])
})

test('computeValidationMetrics matches expected values', () => {
  const metrics = computeValidationMetrics([1, 2, 3], [1, 2, 4])
  assert.ok(metrics)
  approx(metrics.nse, 0.7857142857, 1e-9)
  approx(metrics.rmse, 0.5773502692, 1e-9)
  approx(metrics.pbias, -14.2857142857, 1e-9)
  assert.ok(metrics.r > 0.98 && metrics.r < 1.0)
})

test('validateSeriesAgainstReference fails when fewer than 2 common timesteps', () => {
  const result = validateSeriesAgainstReference(
    {
      times: ['2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z'],
      discharge: [10, 11],
    },
    {
      times: ['2020-01-01T01:00:00Z'],
      discharge: [20],
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.nCommon, 1)
  assert.match(result.error, /Only 1 common timesteps/)
})

test('isGoodValidationMetric uses expected thresholds', () => {
  assert.equal(isGoodValidationMetric('kge', 0.6), true)
  assert.equal(isGoodValidationMetric('kge', 0.1), false)
  assert.equal(isGoodValidationMetric('nse', 0.6), true)
  assert.equal(isGoodValidationMetric('pbias', 10), true)
  assert.equal(isGoodValidationMetric('pbias', 40), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseValidationCsv } from './validationCsv.js'

test('parses two-column CSV using selected river ID', () => {
  const csv = [
    'datetime,observed_q',
    '2020-01-01T00:00:00Z,10.5',
    '2020-01-01T01:00:00Z,11.0',
  ].join('\n')
  const parsed = parseValidationCsv(csv, [780027500])
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.parsed.times, ['2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z'])
  assert.deepEqual(parsed.parsed.seriesByRiverId['780027500'], [10.5, 11.0])
})

test('parses multi-river CSV by extracting river IDs from headers', () => {
  const csv = [
    'time,river_101,river_202',
    '2020-01-01T00:00:00Z,1.0,2.0',
    '2020-01-01T01:00:00Z,1.1,2.2',
  ].join('\n')
  const parsed = parseValidationCsv(csv, [])
  assert.equal(parsed.ok, true)
  assert.deepEqual(Object.keys(parsed.parsed.seriesByRiverId).sort(), ['101', '202'])
  assert.deepEqual(parsed.parsed.seriesByRiverId['101'], [1.0, 1.1])
  assert.deepEqual(parsed.parsed.seriesByRiverId['202'], [2.0, 2.2])
})

test('returns helpful error when two-column CSV has ambiguous target river', () => {
  const csv = [
    'datetime,discharge',
    '2020-01-01T00:00:00Z,10.5',
  ].join('\n')
  const parsed = parseValidationCsv(csv, [101, 202])
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /exactly one selected River ID/i)
})

import test from 'node:test'
import assert from 'node:assert/strict'

import { inferRouter, normalizeLoadedConfig } from './configSchema.js'

test('normalizeLoadedConfig migrates legacy key names to the finalized schema', () => {
  const cfg = normalizeLoadedConfig({
    routing_params_file: 'params.parquet',
    initial_state_file: 'state.parquet',
    catchment_volumes_files: 'runoff.nc',
    weight_table_file: 'weights.nc',
    connectivity_file: 'legacy_connectivity.parquet',
    var_catchment_volume: 'legacy',
  })

  assert.equal(cfg.params_file, 'params.parquet')
  assert.equal(cfg.channel_state_init_file, 'state.parquet')
  assert.deepEqual(cfg.qlateral_files, ['runoff.nc'])
  assert.equal(cfg.grid_weights_file, 'weights.nc')
  assert.equal(cfg._router, 'RapidMuskingum')
  assert.equal('routing_params_file' in cfg, false)
  assert.equal('connectivity_file' in cfg, false)
  assert.equal('var_catchment_volume' in cfg, false)
})

test('normalizeLoadedConfig infers UnitMuskingum from uh kernel configs', () => {
  const cfg = normalizeLoadedConfig({
    params_file: 'params.parquet',
    uh_kernel_file: 'kernel.npz',
    discharge_dir: 'out',
  })

  assert.equal(cfg._router, 'UnitMuskingum')
})

test('normalizeLoadedConfig infers RapidMuskingum from lateral input configs', () => {
  const cfg = normalizeLoadedConfig({
    params_file: 'params.parquet',
    qlateral_files: ['runoff.nc'],
    discharge_dir: 'out',
  })

  assert.equal(cfg._router, 'RapidMuskingum')
})

test('inferRouter keeps explicit supported router names', () => {
  assert.equal(inferRouter({ _router: 'RapidMuskingum' }), 'RapidMuskingum')
})

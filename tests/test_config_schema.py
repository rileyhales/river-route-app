import unittest

from river_route_app.config_schema import clean_config, resolve_router_name


class ConfigSchemaTests(unittest.TestCase):

    def test_clean_config_strips_internal_empty_and_empty_lists(self):
        raw = {
            '_router': 'Muskingum',
            'params_file': 'params.parquet',
            'dt_total': '',
            'discharge_files': [],
            'log': True,
            'qlateral_files': ['a.nc', ''],
        }
        cleaned = clean_config(raw)
        self.assertNotIn('_router', cleaned)
        self.assertNotIn('dt_total', cleaned)
        self.assertNotIn('discharge_files', cleaned)
        self.assertEqual(cleaned['params_file'], 'params.parquet')
        self.assertEqual(cleaned['log'], True)
        self.assertEqual(cleaned['qlateral_files'], ['a.nc'])

    def test_clean_config_migrates_legacy_keys_to_current_schema(self):
        raw = {
            'routing_params_file': 'params.parquet',
            'initial_state_file': 'state.parquet',
            'final_state_file': 'final.parquet',
            'input_type': 'ensemble',
            'runoff_type': 'cumulative',
            'runoff_depths_files': ['grid.nc', ''],
            'weight_table_file': 'weights.nc',
            'connectivity_file': 'connectivity.parquet',
            'var_catchment_volume': 'obsolete',
        }
        cleaned = clean_config(raw)
        self.assertEqual(cleaned['params_file'], 'params.parquet')
        self.assertEqual(cleaned['channel_state_init_file'], 'state.parquet')
        self.assertEqual(cleaned['channel_state_final_file'], 'final.parquet')
        self.assertEqual(cleaned['runoff_processing_mode'], 'ensemble')
        self.assertEqual(cleaned['grid_accumulation_type'], 'cumulative')
        self.assertEqual(cleaned['grid_runoff_files'], ['grid.nc'])
        self.assertEqual(cleaned['grid_weights_file'], 'weights.nc')
        self.assertNotIn('connectivity_file', cleaned)
        self.assertNotIn('var_catchment_volume', cleaned)

    def test_resolve_router_name_requires_known_router(self):
        self.assertEqual(resolve_router_name('Muskingum'), 'Muskingum')
        self.assertEqual(resolve_router_name('RapidMuskingum'), 'RapidMuskingum')
        self.assertEqual(resolve_router_name('UnitMuskingum'), 'UnitMuskingum')
        self.assertEqual(resolve_router_name('rapid'), 'Muskingum')
        self.assertEqual(resolve_router_name(None), 'Muskingum')


if __name__ == '__main__':
    unittest.main()

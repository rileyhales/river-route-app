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

    def test_resolve_router_name_requires_known_router(self):
        self.assertEqual(resolve_router_name('Muskingum'), 'Muskingum')
        self.assertEqual(resolve_router_name('RapidMuskingum'), 'RapidMuskingum')
        self.assertEqual(resolve_router_name('UnitMuskingum'), 'UnitMuskingum')
        self.assertEqual(resolve_router_name('rapid'), 'Muskingum')
        self.assertEqual(resolve_router_name(None), 'Muskingum')


if __name__ == '__main__':
    unittest.main()

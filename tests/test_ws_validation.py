import sys
import types
import unittest


def _install_stubs():
    if 'starlette.websockets' not in sys.modules:
        starlette_mod = types.ModuleType('starlette')
        websockets_mod = types.ModuleType('starlette.websockets')

        class WebSocket:
            pass

        websockets_mod.WebSocket = WebSocket
        starlette_mod.websockets = websockets_mod
        sys.modules['starlette'] = starlette_mod
        sys.modules['starlette.websockets'] = websockets_mod

    if 'river_route_app.results' not in sys.modules:
        results_mod = types.ModuleType('river_route_app.results')
        results_mod.read_result_data = lambda *args, **kwargs: {}
        results_mod.list_river_ids = lambda *args, **kwargs: {}
        results_mod.validate_results = lambda *args, **kwargs: {}
        results_mod.read_ref_csv_data = lambda *args, **kwargs: {}
        sys.modules['river_route_app.results'] = results_mod


_install_stubs()

from river_route_app.ws import _validate_config


class WsValidationTests(unittest.TestCase):

    def tearDown(self):
        sys.modules.pop('river_route', None)

    def test_validate_config_runs_deep_validation_before_router_checks(self):
        call_order = []

        class StubConfigs:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

            def deep_validate(self):
                call_order.append('deep_validate')
                return self

        class StubRouter:
            def __init__(self, **kwargs):
                call_order.append('router_init')

            def _validate_configs(self):
                call_order.append('router_validate')

        river_route_mod = types.ModuleType('river_route')
        river_route_mod.Configs = StubConfigs
        river_route_mod.Muskingum = StubRouter
        river_route_mod.RapidMuskingum = StubRouter
        river_route_mod.UnitMuskingum = StubRouter
        sys.modules['river_route'] = river_route_mod

        out = _validate_config({
            'params_file': 'params.parquet',
            'discharge_dir': 'out',
        }, 'RapidMuskingum')

        self.assertTrue(out['valid'])
        self.assertEqual(call_order, ['deep_validate', 'router_init', 'router_validate'])
        self.assertEqual(out['normalized_config']['params_file'], 'params.parquet')

    def test_validate_config_surfaces_deep_validation_errors(self):
        class StubConfigs:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

            def deep_validate(self):
                raise ValueError('params.parquet is not topologically sorted')

        class StubRouter:
            def __init__(self, **kwargs):
                raise AssertionError('router validation should not run when deep validation fails')

            def _validate_configs(self):
                raise AssertionError('router validation should not run when deep validation fails')

        river_route_mod = types.ModuleType('river_route')
        river_route_mod.Configs = StubConfigs
        river_route_mod.Muskingum = StubRouter
        river_route_mod.RapidMuskingum = StubRouter
        river_route_mod.UnitMuskingum = StubRouter
        sys.modules['river_route'] = river_route_mod

        out = _validate_config({
            'params_file': 'params.parquet',
            'discharge_dir': 'out',
        }, 'Muskingum')

        self.assertFalse(out['valid'])
        self.assertIn('not topologically sorted', out['errors'][0])


if __name__ == '__main__':
    unittest.main()

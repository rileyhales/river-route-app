import os
import sys
import tempfile
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

from river_route_app.ws import _resolve_user_path, _resolve_config_paths


class DummySocket:
    pass


class WsPathTests(unittest.TestCase):

    def test_resolve_user_path_uses_workdir_for_relative(self):
        ws = DummySocket()
        ws._workdir = '/tmp/base'
        out = _resolve_user_path(ws, 'data/out.nc')
        self.assertEqual(out, '/tmp/base/data/out.nc')

    def test_resolve_user_path_passes_absolute(self):
        ws = DummySocket()
        ws._workdir = '/tmp/base'
        out = _resolve_user_path(ws, '/var/data/out.nc')
        self.assertEqual(out, '/var/data/out.nc')

    def test_resolve_config_paths_resolves_file_dir_lists(self):
        with tempfile.TemporaryDirectory() as td:
            ws = DummySocket()
            ws._workdir = td
            cfg = {
                'params_file': 'params.parquet',
                'discharge_dir': 'out',
                'qlateral_files': ['a.nc', '/abs/b.nc'],
                'dt_total': 3600,
            }
            out = _resolve_config_paths(ws, cfg)
            self.assertTrue(out['params_file'].startswith(td + os.sep))
            self.assertTrue(out['discharge_dir'].startswith(td + os.sep))
            self.assertTrue(out['qlateral_files'][0].startswith(td + os.sep))
            self.assertEqual(out['qlateral_files'][1], '/abs/b.nc')
            self.assertEqual(out['dt_total'], 3600)


if __name__ == '__main__':
    unittest.main()

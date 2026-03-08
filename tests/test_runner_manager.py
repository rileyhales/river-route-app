import asyncio
import sys
import types
import unittest


def _install_starlette_stub():
    if 'starlette.websockets' in sys.modules:
        return
    starlette_mod = types.ModuleType('starlette')
    websockets_mod = types.ModuleType('starlette.websockets')

    class WebSocket:
        pass

    websockets_mod.WebSocket = WebSocket
    starlette_mod.websockets = websockets_mod
    sys.modules['starlette'] = starlette_mod
    sys.modules['starlette.websockets'] = websockets_mod


_install_starlette_stub()

from river_route_app.runner import JobManager


class RunnerManagerTests(unittest.TestCase):

    def test_run_queue_updates_max_concurrency(self):
        mgr = JobManager()
        asyncio.run(mgr.run_queue(max_concurrency=3))
        self.assertEqual(mgr.max_concurrency, 3)
        mgr.clear_all()


if __name__ == '__main__':
    unittest.main()

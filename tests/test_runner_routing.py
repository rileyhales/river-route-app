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


class RunnerRoutingTests(unittest.TestCase):

    def test_explicit_job_id_routes_message_to_target_job(self):
        mgr = JobManager()
        ids = mgr.submit_jobs([
            {'id': 'job-a', 'name': 'A', 'router': 'Muskingum', 'config': {}},
            {'id': 'job-b', 'name': 'B', 'router': 'Muskingum', 'config': {}},
        ])
        self.assertEqual(ids, ['job-a', 'job-b'])

        job_a = mgr.jobs['job-a']
        job_b = mgr.jobs['job-b']
        job_a.status = 'running'
        job_b.status = 'running'

        asyncio.run(mgr._handle_worker_message(job_a, {
            'kind': 'progress',
            'job_id': 'job-b',
            'percent': 42,
            'message': '7/12',
        }))

        self.assertEqual(job_a.percent, 0)
        self.assertEqual(job_b.percent, 42)
        self.assertEqual(job_b.progress_message, '7/12')


if __name__ == '__main__':
    unittest.main()

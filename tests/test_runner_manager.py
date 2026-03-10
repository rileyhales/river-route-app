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

    def test_requeue_job_resets_completed_job_and_moves_it_to_queue_tail(self):
        mgr = JobManager()
        mgr.submit_jobs([
            {'id': 'job-a', 'name': 'A', 'router': 'Muskingum', 'config': {}},
            {'id': 'job-b', 'name': 'B', 'router': 'Muskingum', 'config': {}},
        ])

        job = mgr.jobs['job-a']
        job.status = 'complete'
        job.percent = 100
        job.progress_message = 'done'
        job.logs = [{'level': 'INFO', 'message': 'finished'}]
        job.result = {'elapsed': 1.25, 'output_files': ['a.nc'], 'num_rivers': 1, 'num_timesteps': 2}
        job.error_info = {'error': 'old', 'traceback': 'old'}
        job.started_at = 10.0
        job.ended_at = 12.0

        requeued = mgr.requeue_job('job-a')

        self.assertIs(requeued, job)
        self.assertEqual(job.status, 'pending')
        self.assertEqual(job.percent, 0)
        self.assertEqual(job.progress_message, '')
        self.assertEqual(job.logs, [])
        self.assertIsNone(job.result)
        self.assertIsNone(job.error_info)
        self.assertIsNone(job.started_at)
        self.assertIsNone(job.ended_at)
        self.assertEqual(mgr.job_order, ['job-b', 'job-a'])

    def test_requeue_job_ignores_non_terminal_jobs(self):
        mgr = JobManager()
        mgr.submit_jobs([
            {'id': 'job-a', 'name': 'A', 'router': 'Muskingum', 'config': {}},
        ])

        self.assertIsNone(mgr.requeue_job('job-a'))
        self.assertEqual(mgr.jobs['job-a'].status, 'pending')


if __name__ == '__main__':
    unittest.main()

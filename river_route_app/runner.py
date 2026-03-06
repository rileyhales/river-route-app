import asyncio
import datetime
import logging
import queue
import sys
import threading
import time
import uuid

from concurrent.futures import ThreadPoolExecutor
from starlette.websockets import WebSocket


class SimulationCancelled(Exception):
    pass


class StreamingTqdm:
    """Iterator wrapper that emits progress updates to a queue, mimicking tqdm."""

    def __init__(self, iterable, msg_queue: queue.Queue, cancelled: threading.Event, desc: str = '', **kwargs):
        self._iterable = iterable
        self._queue = msg_queue
        self._cancelled = cancelled
        self._desc = desc
        self._total = len(iterable) if hasattr(iterable, '__len__') else kwargs.get('total', 0)
        self._n = 0
        self._last_update = 0.0

    def __iter__(self):
        for item in self._iterable:
            if self._cancelled.is_set():
                raise SimulationCancelled()
            yield item
            self._n += 1
            now = time.monotonic()
            if now - self._last_update >= 0.25 or self._n == self._total:
                pct = (self._n / self._total * 100) if self._total else 0
                self._queue.put(('progress', pct, f'{self._desc}: {self._n}/{self._total}'))
                self._last_update = now

    def __len__(self):
        return self._total


class WebSocketLogHandler(logging.Handler):
    """Captures log records and puts them on a queue for WS streaming."""

    def __init__(self, msg_queue: queue.Queue):
        super().__init__()
        self._queue = msg_queue

    def emit(self, record: logging.LogRecord):
        self._queue.put(('log', record.levelname, self.format(record)))


# ---------------------------------------------------------------------------
# Thread-local tqdm patching — applied once, routes to per-thread queues
# ---------------------------------------------------------------------------
_tqdm_local = threading.local()
_tqdm_patched = False
_original_tqdm = None
_patch_lock = threading.Lock()


def _ensure_tqdm_patched():
    global _tqdm_patched, _original_tqdm
    if _tqdm_patched:
        return
    with _patch_lock:
        if _tqdm_patched:
            return

        import tqdm as tqdm_module
        _original_tqdm = tqdm_module.tqdm

        def thread_aware_tqdm(iterable=None, *args, **kwargs):
            ctx = getattr(_tqdm_local, 'ctx', None)
            if ctx and iterable is not None:
                return StreamingTqdm(iterable, ctx['queue'], ctx['cancelled'], desc=kwargs.get('desc', ''))
            return _original_tqdm(iterable, *args, **kwargs)

        tqdm_module.tqdm = thread_aware_tqdm
        for mod_name, mod in sys.modules.items():
            if mod_name.startswith('river_route') and mod is not None and hasattr(mod, 'tqdm'):
                if getattr(mod, 'tqdm') is _original_tqdm:
                    mod.tqdm = thread_aware_tqdm

        _tqdm_patched = True


# ---------------------------------------------------------------------------
# Per-job execution (runs in a thread)
# ---------------------------------------------------------------------------

def _run_job(router_name: str, config: dict, msg_queue: queue.Queue, cancelled: threading.Event):
    from river_route import Muskingum, RapidMuskingum, UnitMuskingum

    _ensure_tqdm_patched()
    _tqdm_local.ctx = {'queue': msg_queue, 'cancelled': cancelled}

    routers = {
        'Muskingum': Muskingum,
        'RapidMuskingum': RapidMuskingum,
        'UnitMuskingum': UnitMuskingum,
    }

    router_cls = routers.get(router_name)
    if router_cls is None:
        msg_queue.put(('error', f'Unknown router: {router_name}', ''))
        return

    try:
        config['progress_bar'] = True
        config['log'] = True

        router = router_cls(**config)

        handler = WebSocketLogHandler(msg_queue)
        handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        router.logger.addHandler(handler)

        t1 = datetime.datetime.now()
        msg_queue.put(('started', '', ''))

        if cancelled.is_set():
            msg_queue.put(('cancelled', '', ''))
            return

        router.route()

        elapsed = (datetime.datetime.now() - t1).total_seconds()

        num_rivers = len(router.river_ids) if hasattr(router, 'river_ids') else 0
        output_files = [str(f) for f in router.cfg.discharge_files]
        num_timesteps = 0
        if hasattr(router, 'dt_total') and hasattr(router, 'dt_discharge'):
            num_timesteps = int(router.dt_total / router.dt_discharge) if router.dt_discharge else 0
        elif hasattr(router, 'dt_total') and hasattr(router, 'dt_routing'):
            num_timesteps = int(router.dt_total / router.dt_routing) if router.dt_routing else 0

        msg_queue.put(('complete', elapsed, {
            'output_files': output_files,
            'num_rivers': num_rivers,
            'num_timesteps': num_timesteps,
        }))

    except SimulationCancelled:
        msg_queue.put(('cancelled', '', ''))

    except Exception as e:
        import traceback
        msg_queue.put(('error', str(e), traceback.format_exc()))

    finally:
        _tqdm_local.ctx = None


# ---------------------------------------------------------------------------
# Job + JobManager
# ---------------------------------------------------------------------------

class Job:
    MAX_LOGS = 500

    def __init__(self, job_id: str, name: str, router: str, config: dict):
        self.id = job_id
        self.name = name
        self.router = router
        self.config = config
        self.status: str = 'pending'  # pending | running | complete | error | cancelled
        self.percent: float = 0
        self.progress_message: str = ''
        self.logs: list[dict] = []
        self.result: dict | None = None
        self.error_info: dict | None = None
        self._cancelled = threading.Event()
        self._msg_queue: queue.Queue = queue.Queue()
        self._future = None

    def cancel(self):
        self._cancelled.set()

    def add_log(self, level: str, message: str):
        self.logs.append({'level': level, 'message': message})
        if len(self.logs) > self.MAX_LOGS:
            self.logs = self.logs[-self.MAX_LOGS:]

    def snapshot(self) -> dict:
        snap = {
            'id': self.id,
            'name': self.name,
            'router': self.router,
            'status': self.status,
            'percent': self.percent,
        }
        if self.result:
            snap['result'] = self.result
        if self.error_info:
            snap['error_info'] = self.error_info
        return snap


class JobManager:
    MAX_WORKERS_CAP = 5

    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.job_order: list[str] = []
        self.max_workers: int = 1
        self._executor: ThreadPoolExecutor | None = None
        self._polling: bool = False
        self.subscribers: set[WebSocket] = set()

    def set_max_workers(self, n: int):
        self.max_workers = max(1, min(n, self.MAX_WORKERS_CAP))

    def submit_jobs(self, jobs_data: list[dict]) -> list[str]:
        ids = []
        for jd in jobs_data:
            job = Job(jd['id'], jd['name'], jd['router'], jd['config'])
            self.jobs[job.id] = job
            self.job_order.append(job.id)
            ids.append(job.id)
        return ids

    def cancel_job(self, job_id: str):
        job = self.jobs.get(job_id)
        if not job:
            return
        if job.status == 'pending':
            job.status = 'cancelled'
        elif job.status == 'running':
            job.cancel()

    def cancel_all(self):
        for jid in self.job_order:
            job = self.jobs.get(jid)
            if job and job.status == 'pending':
                job.status = 'cancelled'
            elif job and job.status == 'running':
                job.cancel()

    def remove_job(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status == 'running':
            job.cancel()
        del self.jobs[job_id]
        self.job_order = [jid for jid in self.job_order if jid != job_id]
        return True

    def clear_finished(self):
        finished = [jid for jid in self.job_order
                     if self.jobs.get(jid) and self.jobs[jid].status in ('complete', 'error', 'cancelled')]
        for jid in finished:
            del self.jobs[jid]
        self.job_order = [jid for jid in self.job_order if jid in self.jobs]

    def clear_all(self):
        for job in self.jobs.values():
            if job.status == 'running':
                job.cancel()
        self.jobs.clear()
        self.job_order.clear()

    def get_snapshot(self) -> dict:
        return {
            'type': 'queue_status',
            'max_workers': self.max_workers,
            'jobs': [self.jobs[jid].snapshot() for jid in self.job_order if jid in self.jobs],
        }

    async def run_queue(self):
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=self.MAX_WORKERS_CAP)

        self._start_pending_jobs()

        if not self._polling:
            self._polling = True
            asyncio.ensure_future(self._poll_loop())

    def _start_pending_jobs(self):
        running_count = sum(1 for j in self.jobs.values() if j.status == 'running')
        for jid in self.job_order:
            if running_count >= self.max_workers:
                break
            job = self.jobs.get(jid)
            if job and job.status == 'pending':
                job.status = 'running'
                job._future = self._executor.submit(
                    _run_job, job.router, job.config, job._msg_queue, job._cancelled,
                )
                running_count += 1

    async def _poll_loop(self):
        while True:
            for jid in list(self.job_order):
                job = self.jobs.get(jid)
                if not job or job.status != 'running':
                    continue

                # Drain this job's message queue
                while True:
                    try:
                        msg = job._msg_queue.get_nowait()
                    except queue.Empty:
                        break

                    kind = msg[0]
                    if kind == 'log':
                        job.add_log(msg[1], msg[2])
                        await self._broadcast({
                            'type': 'job_log',
                            'job_id': job.id,
                            'level': msg[1],
                            'message': msg[2],
                        })
                    elif kind == 'progress':
                        job.percent = msg[1]
                        job.progress_message = msg[2]
                        await self._broadcast({
                            'type': 'job_progress',
                            'job_id': job.id,
                            'percent': msg[1],
                            'message': msg[2],
                        })
                    elif kind == 'started':
                        await self._broadcast({
                            'type': 'job_started',
                            'job_id': job.id,
                        })
                    elif kind == 'complete':
                        job.status = 'complete'
                        job.percent = 100
                        job.result = {
                            'elapsed': msg[1],
                            'output_files': msg[2]['output_files'],
                            'num_rivers': msg[2]['num_rivers'],
                            'num_timesteps': msg[2]['num_timesteps'],
                        }
                        await self._broadcast({
                            'type': 'job_complete',
                            'job_id': job.id,
                            **job.result,
                        })
                    elif kind == 'error':
                        job.status = 'error'
                        job.error_info = {'error': msg[1], 'traceback': msg[2]}
                        await self._broadcast({
                            'type': 'job_error',
                            'job_id': job.id,
                            'error': msg[1],
                            'traceback': msg[2],
                        })
                    elif kind == 'cancelled':
                        job.status = 'cancelled'
                        await self._broadcast({
                            'type': 'job_cancelled',
                            'job_id': job.id,
                        })

                # Thread finished but no terminal message yet
                if job._future and job._future.done() and job.status == 'running':
                    job.status = 'error'
                    job.error_info = {'error': 'Simulation thread terminated unexpectedly', 'traceback': ''}
                    await self._broadcast({
                        'type': 'job_error',
                        'job_id': job.id,
                        'error': 'Simulation thread terminated unexpectedly',
                        'traceback': '',
                    })

            # Start more pending jobs if slots opened up
            self._start_pending_jobs()

            has_active = any(
                self.jobs[jid].status in ('pending', 'running')
                for jid in self.job_order if jid in self.jobs
            )
            if not has_active:
                self._polling = False
                await self._broadcast({'type': 'queue_idle'})
                break

            await asyncio.sleep(0.05)

    async def _broadcast(self, message: dict):
        dead = set()
        for ws in self.subscribers:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        self.subscribers -= dead


# Module-level singleton
job_manager = JobManager()

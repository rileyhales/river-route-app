import asyncio
import datetime
import io
import logging
import multiprocessing as mp
import os
import queue
import re
import sys
import time

from starlette.websockets import WebSocket

from .config_schema import clean_config, resolve_router_name


class WebSocketLogHandler(logging.Handler):
    """Captures log records and puts them on a queue for WS streaming."""

    def __init__(self, msg_queue, job_id: str):
        super().__init__()
        self._queue = msg_queue
        self._job_id = job_id

    def emit(self, record: logging.LogRecord):
        self._queue.put({
            'kind': 'log',
            'job_id': self._job_id,
            'level': record.levelname,
            'message': self.format(record),
        })


class StderrCapture(io.TextIOBase):
    """Captures stderr writes, parses tqdm output, and forwards progress to a queue."""

    _TQDM_RE = re.compile(r'(\d+)%\|.*\|\s*(\d+)/(\d+)')

    def __init__(self, msg_queue, original_stderr, job_id: str):
        self._queue = msg_queue
        self._original = original_stderr
        self._job_id = job_id
        self._last_update = 0.0

    def write(self, text):
        match = self._TQDM_RE.search(text)
        if match:
            pct = int(match.group(1))
            current = match.group(2)
            total = match.group(3)
            now = time.monotonic()
            if now - self._last_update >= 0.25 or pct >= 100:
                self._queue.put({
                    'kind': 'progress',
                    'job_id': self._job_id,
                    'percent': pct,
                    'message': f'{current}/{total}',
                })
                self._last_update = now
        return len(text)

    def flush(self):
        pass


def _run_job(job_id: str, router_name: str, config: dict, msg_queue, cancelled) -> None:
    from river_route import Muskingum, RapidMuskingum, UnitMuskingum

    routers = {
        'Muskingum': Muskingum,
        'RapidMuskingum': RapidMuskingum,
        'UnitMuskingum': UnitMuskingum,
    }

    config = clean_config(config)
    router_name = resolve_router_name(router_name)
    router_cls = routers.get(router_name)
    if router_cls is None:
        msg_queue.put({
            'kind': 'error',
            'job_id': job_id,
            'error': f'Unknown router: {router_name}',
            'traceback': '',
        })
        return

    original_stderr = sys.stderr
    sys.stderr = StderrCapture(msg_queue, original_stderr, job_id)

    try:
        config.setdefault('progress_bar', True)
        config.setdefault('log', True)
        config.setdefault('log_level', 'PROGRESS')

        router = router_cls(**config)

        handler = WebSocketLogHandler(msg_queue, job_id)
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        router.logger.addHandler(handler)

        t1 = datetime.datetime.now()
        msg_queue.put({
            'kind': 'started',
            'job_id': job_id,
        })

        if cancelled.is_set():
            msg_queue.put({
                'kind': 'cancelled',
                'job_id': job_id,
            })
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

        msg_queue.put({
            'kind': 'complete',
            'job_id': job_id,
            'elapsed': elapsed,
            'result': {
                'output_files': output_files,
                'num_rivers': num_rivers,
                'num_timesteps': num_timesteps,
            },
        })

    except Exception as e:
        import traceback
        msg_queue.put({
            'kind': 'error',
            'job_id': job_id,
            'error': str(e),
            'traceback': traceback.format_exc(),
        })

    finally:
        sys.stderr = original_stderr


class Job:
    MAX_LOGS = 1200

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
        self.started_at: float | None = None
        self.ended_at: float | None = None

        self._cancel_requested: bool = False
        self._worker = None
        self._cancelled = None
        self._msg_queue = None
        self._completion_grace_until: float | None = None

    def cancel(self):
        self._cancel_requested = True
        if self._cancelled is not None:
            self._cancelled.set()

    def reset_for_requeue(self):
        self.status = 'pending'
        self.percent = 0
        self.progress_message = ''
        self.logs = []
        self.result = None
        self.error_info = None
        self.started_at = None
        self.ended_at = None
        self._cancel_requested = False
        self._completion_grace_until = None

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
            'progress_message': self.progress_message,
        }
        if self.result:
            snap['result'] = self.result
        if self.error_info:
            snap['error_info'] = self.error_info
        if self.started_at is not None:
            snap['started_at'] = self.started_at
        if self.ended_at is not None:
            snap['ended_at'] = self.ended_at
        return snap


class JobManager:

    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.job_order: list[str] = []
        self.max_concurrency: int = max(1, int(os.getenv('RR_APP_MAX_WORKERS', '1')))
        self._polling: bool = False
        self.subscribers: set[WebSocket] = set()
        self._mp_context = mp.get_context('spawn')

    def submit_jobs(self, jobs_data: list[dict]) -> list[str]:
        ids = []
        for jd in jobs_data:
            job = Job(jd['id'], jd['name'], jd['router'], jd['config'])
            self.jobs[job.id] = job
            self.job_order.append(job.id)
            ids.append(job.id)
        return ids

    def _cancel_running_job(self, job: Job) -> None:
        job.cancel()
        if isinstance(job._worker, mp.Process):
            if job._worker.is_alive():
                try:
                    job._worker.terminate()
                except Exception:
                    pass

    def cancel_job(self, job_id: str):
        job = self.jobs.get(job_id)
        if not job:
            return
        if job.status == 'pending':
            job.status = 'cancelled'
            job.ended_at = time.time()
        elif job.status == 'running':
            self._cancel_running_job(job)

    def cancel_all(self):
        for jid in self.job_order:
            job = self.jobs.get(jid)
            if job and job.status == 'pending':
                job.status = 'cancelled'
                job.ended_at = time.time()
            elif job and job.status == 'running':
                self._cancel_running_job(job)

    def remove_job(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status == 'running':
            self._cancel_running_job(job)
        self._finalize_worker(job)
        del self.jobs[job_id]
        self.job_order = [jid for jid in self.job_order if jid != job_id]
        return True

    def clear_finished(self):
        finished = [jid for jid in self.job_order
                    if self.jobs.get(jid) and self.jobs[jid].status in ('complete', 'error', 'cancelled')]
        for jid in finished:
            self._finalize_worker(self.jobs[jid])
            del self.jobs[jid]
        self.job_order = [jid for jid in self.job_order if jid in self.jobs]

    def clear_all(self):
        for job in self.jobs.values():
            if job.status == 'running':
                self._cancel_running_job(job)
            self._finalize_worker(job)
        self.jobs.clear()
        self.job_order.clear()

    def requeue_job(self, job_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        if not job or job.status not in ('complete', 'error', 'cancelled'):
            return None
        self._finalize_worker(job)
        job.reset_for_requeue()
        self.job_order = [jid for jid in self.job_order if jid != job_id]
        self.job_order.append(job_id)
        return job

    def get_snapshot(self) -> dict:
        return {
            'type': 'queue_status',
            'jobs': [self.jobs[jid].snapshot() for jid in self.job_order if jid in self.jobs],
            'max_concurrency': self.max_concurrency,
        }

    async def run_queue(self, max_concurrency: int | None = None):
        if max_concurrency is not None:
            self.max_concurrency = max(1, int(max_concurrency))

        self._start_pending_jobs()

        if not self._polling:
            self._polling = True
            asyncio.ensure_future(self._poll_loop())

    def _start_job(self, job: Job) -> None:
        job.status = 'running'
        job.started_at = time.time()
        job.ended_at = None
        job._completion_grace_until = None

        msg_queue = self._mp_context.Queue()
        cancelled = self._mp_context.Event()
        worker = self._mp_context.Process(
            target=_run_job,
            args=(job.id, job.router, job.config, msg_queue, cancelled),
            daemon=True,
        )
        worker.start()

        job._msg_queue = msg_queue
        job._cancelled = cancelled
        job._worker = worker

    def _start_pending_jobs(self):
        running_count = sum(1 for j in self.jobs.values() if j.status == 'running')
        for jid in self.job_order:
            if running_count >= self.max_concurrency:
                break
            job = self.jobs.get(jid)
            if job and job.status == 'pending':
                self._start_job(job)
                running_count += 1

    @staticmethod
    def _is_worker_alive(job: Job) -> bool:
        if job._worker is None:
            return False
        try:
            return job._worker.is_alive()
        except Exception:
            return False

    @staticmethod
    def _drain_messages(job: Job) -> list[object]:
        out = []
        if job._msg_queue is None:
            return out
        while True:
            try:
                out.append(job._msg_queue.get_nowait())
            except queue.Empty:
                break
            except Exception:
                break
        return out

    @staticmethod
    def _normalize_message(message: object, fallback_job_id: str) -> dict | None:
        if isinstance(message, dict):
            out = dict(message)
            out.setdefault('job_id', fallback_job_id)
            return out
        if isinstance(message, tuple) and len(message) >= 1:
            kind = message[0]
            if kind == 'log' and len(message) >= 3:
                return {
                    'kind': 'log',
                    'job_id': fallback_job_id,
                    'level': message[1],
                    'message': message[2],
                }
            if kind == 'progress' and len(message) >= 3:
                return {
                    'kind': 'progress',
                    'job_id': fallback_job_id,
                    'percent': message[1],
                    'message': message[2],
                }
            if kind == 'started':
                return {'kind': 'started', 'job_id': fallback_job_id}
            if kind == 'complete' and len(message) >= 3:
                return {
                    'kind': 'complete',
                    'job_id': fallback_job_id,
                    'elapsed': message[1],
                    'result': message[2],
                }
            if kind == 'error' and len(message) >= 3:
                return {
                    'kind': 'error',
                    'job_id': fallback_job_id,
                    'error': message[1],
                    'traceback': message[2],
                }
            if kind == 'cancelled':
                return {'kind': 'cancelled', 'job_id': fallback_job_id}
        return None

    async def _handle_worker_message(self, fallback_job: Job, message: dict) -> None:
        msg_job_id = str(message.get('job_id') or fallback_job.id)
        job = self.jobs.get(msg_job_id) or fallback_job
        kind = message.get('kind')

        if kind == 'log':
            if job.status != 'running':
                return
            level = str(message.get('level', 'INFO'))
            text = str(message.get('message', ''))
            job.add_log(level, text)
            await self._broadcast({
                'type': 'job_log',
                'job_id': job.id,
                'level': level,
                'message': text,
            })
            return

        if kind == 'progress':
            if job.status != 'running':
                return
            pct = float(message.get('percent', 0))
            msg = str(message.get('message', ''))
            job.percent = pct
            job.progress_message = msg
            await self._broadcast({
                'type': 'job_progress',
                'job_id': job.id,
                'percent': pct,
                'message': msg,
            })
            return

        if kind == 'started':
            await self._broadcast({
                'type': 'job_started',
                'job_id': job.id,
            })
            return

        if kind == 'complete':
            if job.status != 'running':
                return
            result = message.get('result') or {}
            job.status = 'complete'
            job.ended_at = time.time()
            job.percent = 100
            job.result = {
                'elapsed': float(message.get('elapsed', 0)),
                'output_files': result.get('output_files', []),
                'num_rivers': int(result.get('num_rivers', 0)),
                'num_timesteps': int(result.get('num_timesteps', 0)),
            }
            await self._broadcast({
                'type': 'job_complete',
                'job_id': job.id,
                **job.result,
            })
            self._finalize_worker(job)
            return

        if kind == 'error':
            if job.status != 'running':
                return
            err = str(message.get('error', 'Unknown error'))
            tb = str(message.get('traceback', ''))
            job.status = 'error'
            job.ended_at = time.time()
            job.error_info = {'error': err, 'traceback': tb}
            await self._broadcast({
                'type': 'job_error',
                'job_id': job.id,
                'error': err,
                'traceback': tb,
            })
            self._finalize_worker(job)
            return

        if kind == 'cancelled':
            if job.status != 'running':
                return
            job.status = 'cancelled'
            job.ended_at = time.time()
            await self._broadcast({
                'type': 'job_cancelled',
                'job_id': job.id,
            })
            self._finalize_worker(job)
            return

    @staticmethod
    def _finalize_worker(job: Job) -> None:
        worker = job._worker
        if isinstance(worker, mp.Process):
            try:
                worker.join(timeout=0.05)
            except Exception:
                pass

        msg_queue = job._msg_queue
        if msg_queue is not None:
            if hasattr(msg_queue, 'close'):
                try:
                    msg_queue.close()
                except Exception:
                    pass
            if hasattr(msg_queue, 'join_thread'):
                try:
                    msg_queue.join_thread()
                except Exception:
                    pass

        job._worker = None
        job._msg_queue = None
        job._cancelled = None
        job._completion_grace_until = None

    async def _poll_loop(self):
        while True:
            for jid in list(self.job_order):
                job = self.jobs.get(jid)
                if not job or job.status != 'running':
                    continue

                for raw_msg in self._drain_messages(job):
                    msg = self._normalize_message(raw_msg, job.id)
                    if msg is None:
                        continue
                    await self._handle_worker_message(job, msg)

                if job.status != 'running':
                    continue

                worker_alive = self._is_worker_alive(job)
                if worker_alive:
                    continue

                # In process mode, allow a short grace period for queued terminal messages to arrive.
                now = time.monotonic()
                if job._completion_grace_until is None:
                    job._completion_grace_until = now + 0.25
                    continue
                if now < job._completion_grace_until:
                    continue

                for raw_msg in self._drain_messages(job):
                    msg = self._normalize_message(raw_msg, job.id)
                    if msg is None:
                        continue
                    await self._handle_worker_message(job, msg)

                if job.status == 'running':
                    if job._cancel_requested:
                        job.status = 'cancelled'
                        job.ended_at = time.time()
                        await self._broadcast({'type': 'job_cancelled', 'job_id': job.id})
                    else:
                        job.status = 'error'
                        job.ended_at = time.time()
                        job.error_info = {'error': 'Simulation terminated unexpectedly', 'traceback': ''}
                        await self._broadcast({
                            'type': 'job_error',
                            'job_id': job.id,
                            'error': 'Simulation terminated unexpectedly',
                            'traceback': '',
                        })
                self._finalize_worker(job)

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

    async def broadcast(self, message: dict):
        await self._broadcast(message)


job_manager = JobManager()

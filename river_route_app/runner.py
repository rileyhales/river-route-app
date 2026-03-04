import asyncio
import datetime
import logging
import queue
import threading
import time

from starlette.websockets import WebSocket


class SimulationState:
    """Global simulation state shared across all WebSocket connections."""

    MAX_LOGS = 1000

    def __init__(self):
        self._thread: threading.Thread | None = None
        self._cancelled = threading.Event()
        self.status: str = 'idle'  # idle | running | complete | error | cancelled
        self.percent: float = 0
        self.progress_message: str = ''
        self.logs: list[dict] = []
        self.result: dict | None = None
        self.error_info: dict | None = None
        self.subscribers: set[WebSocket] = set()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def cancel(self):
        self._cancelled.set()

    def reset(self):
        """Clear thread references but preserve result/logs/status for reconnecting clients."""
        self._cancelled.clear()
        self._thread = None

    def clear(self):
        """Full reset before starting a new simulation run."""
        self._cancelled.clear()
        self._thread = None
        self.status = 'idle'
        self.percent = 0
        self.progress_message = ''
        self.logs = []
        self.result = None
        self.error_info = None

    def add_log(self, level: str, message: str):
        self.logs.append({'level': level, 'message': message})
        if len(self.logs) > self.MAX_LOGS:
            self.logs = self.logs[-self.MAX_LOGS:]

    def get_snapshot(self) -> dict:
        """Return current state for a reconnecting client."""
        snap = {
            'type': 'sim_status',
            'status': self.status,
            'percent': self.percent,
            'progress_message': self.progress_message,
            'logs': self.logs,
        }
        if self.result is not None:
            snap['result'] = self.result
        if self.error_info is not None:
            snap['error_info'] = self.error_info
        return snap


# Module-level singleton — shared across all connections
sim_state = SimulationState()


async def _broadcast(message: dict):
    """Send a message to all connected subscribers, silently discarding dead connections."""
    dead = set()
    for ws in sim_state.subscribers:
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    sim_state.subscribers -= dead


class WebSocketLogHandler(logging.Handler):
    """Captures log records and puts them on a queue for WS streaming."""

    def __init__(self, msg_queue: queue.Queue):
        super().__init__()
        self._queue = msg_queue

    def emit(self, record: logging.LogRecord):
        self._queue.put(('log', record.levelname, self.format(record)))


class SimulationCancelled(Exception):
    """Raised inside the simulation thread when the user cancels."""
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
            # throttle updates to ~4/sec
            if now - self._last_update >= 0.25 or self._n == self._total:
                pct = (self._n / self._total * 100) if self._total else 0
                self._queue.put(('progress', pct, f'{self._desc}: {self._n}/{self._total}'))
                self._last_update = now

    def __len__(self):
        return self._total


def _run_in_thread(router_name: str, config: dict, msg_queue: queue.Queue, cancelled: threading.Event):
    """Execute the simulation in a background thread, streaming log/progress to the queue."""
    import tqdm as tqdm_module
    from river_route import Muskingum, RapidMuskingum, UnitMuskingum

    routers = {
        'Muskingum': Muskingum,
        'RapidMuskingum': RapidMuskingum,
        'UnitMuskingum': UnitMuskingum,
    }

    router_cls = routers.get(router_name)
    if router_cls is None:
        msg_queue.put(('error', f'Unknown router: {router_name}', ''))
        return

    # Monkey-patch tqdm in this thread's scope so progress goes to the queue
    original_tqdm = tqdm_module.tqdm

    def patched_tqdm(iterable=None, *args, **kwargs):
        if iterable is not None:
            return StreamingTqdm(iterable, msg_queue, cancelled, desc=kwargs.get('desc', ''))
        return original_tqdm(iterable, *args, **kwargs)

    tqdm_module.tqdm = patched_tqdm

    try:
        # Force progress_bar on and log on so we capture output
        config['progress_bar'] = True
        config['log'] = True

        router = router_cls(**config)

        # Attach our custom log handler
        handler = WebSocketLogHandler(msg_queue)
        handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
        router.logger.addHandler(handler)

        t1 = datetime.datetime.now()
        msg_queue.put(('started', 'Simulation started', ''))

        if cancelled.is_set():
            msg_queue.put(('cancelled', '', ''))
            return

        router.route()

        elapsed = (datetime.datetime.now() - t1).total_seconds()

        # Gather summary info
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
        tqdm_module.tqdm = original_tqdm


async def run_simulation(router_name: str, config: dict):
    """Start a simulation in a background thread and broadcast messages to all subscribers."""
    if sim_state.running:
        await _broadcast({'type': 'sim_error', 'error': 'A simulation is already running', 'traceback': ''})
        return

    sim_state.clear()
    sim_state.status = 'running'
    msg_queue: queue.Queue = queue.Queue()

    thread = threading.Thread(
        target=_run_in_thread,
        args=(router_name, config, msg_queue, sim_state._cancelled),
        daemon=True,
    )
    sim_state._thread = thread
    thread.start()

    await _broadcast({'type': 'sim_started', 'message': 'Simulation started'})

    # Poll the queue and broadcast messages to all subscribers
    while thread.is_alive() or not msg_queue.empty():
        try:
            msg = msg_queue.get_nowait()
        except queue.Empty:
            await asyncio.sleep(0.05)
            continue

        kind = msg[0]
        if kind == 'log':
            sim_state.add_log(msg[1], msg[2])
            await _broadcast({
                'type': 'sim_log',
                'level': msg[1],
                'message': msg[2],
            })
        elif kind == 'progress':
            sim_state.percent = msg[1]
            sim_state.progress_message = msg[2]
            await _broadcast({
                'type': 'sim_progress',
                'percent': msg[1],
                'message': msg[2],
            })
        elif kind == 'started':
            # Already broadcast above, just update state
            pass
        elif kind == 'complete':
            info = msg[2]
            sim_state.status = 'complete'
            sim_state.percent = 100
            sim_state.result = {
                'type': 'sim_complete',
                'elapsed': msg[1],
                'output_files': info['output_files'],
                'num_rivers': info['num_rivers'],
                'num_timesteps': info['num_timesteps'],
            }
            await _broadcast(sim_state.result)
        elif kind == 'error':
            sim_state.status = 'error'
            sim_state.error_info = {'error': msg[1], 'traceback': msg[2]}
            await _broadcast({
                'type': 'sim_error',
                'error': msg[1],
                'traceback': msg[2],
            })
        elif kind == 'cancelled':
            sim_state.status = 'cancelled'
            await _broadcast({'type': 'sim_cancelled'})

    sim_state.reset()

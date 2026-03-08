import os
import traceback

from starlette.websockets import WebSocket

from .browser import browse_directory
from .config_schema import clean_config, resolve_router_name
from .results import read_result_data, list_river_ids, validate_results, read_ref_csv_data
from .runner import job_manager


def _resolve_user_path(websocket: WebSocket, path: str | None, default: str = '') -> str:
    base = getattr(websocket, '_workdir', os.getcwd())
    raw = os.path.expanduser((path or default or '').strip())
    if not raw:
        return os.path.abspath(base)
    if os.path.isabs(raw):
        return os.path.abspath(raw)
    return os.path.abspath(os.path.join(base, raw))


def _resolve_path_list(websocket: WebSocket, paths: list[str] | None) -> list[str]:
    out: list[str] = []
    for p in paths or []:
        if not isinstance(p, str):
            continue
        out.append(_resolve_user_path(websocket, p))
    return out


def _resolve_config_paths(websocket: WebSocket, config: dict) -> dict:
    resolved = {}
    for key, value in (config or {}).items():
        if key.endswith('_files') and isinstance(value, list):
            resolved[key] = _resolve_path_list(websocket, value)
        elif key.endswith('_file') and isinstance(value, str):
            resolved[key] = _resolve_user_path(websocket, value)
        elif key.endswith('_dir') and isinstance(value, str):
            resolved[key] = _resolve_user_path(websocket, value)
        else:
            resolved[key] = value
    return resolved


def _read_text_file(path: str, max_bytes: int = 8_000_000) -> dict:
    if not path:
        return {'type': 'text_file', 'error': 'No file path provided'}
    if not os.path.isfile(path):
        return {'type': 'text_file', 'error': f'Not a file: {path}'}
    try:
        size = os.path.getsize(path)
    except OSError:
        size = None
    if size is not None and size > max_bytes:
        return {
            'type': 'text_file',
            'error': f'File too large ({size} bytes). Limit is {max_bytes} bytes.',
        }
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            text = f.read()
        return {'type': 'text_file', 'path': path, 'text': text}
    except Exception as e:
        return {'type': 'text_file', 'error': str(e)}


def _parse_int_list(values) -> list[int]:
    out: list[int] = []
    if not isinstance(values, list):
        return out
    for value in values:
        try:
            num = int(value)
        except Exception:
            continue
        if num > 0:
            out.append(num)
    return out


async def handle_ws_message(websocket: WebSocket, data: dict) -> None:
    msg_type = data.get('type')
    req_id = data.get('_reqId')

    if not hasattr(websocket, '_workdir'):
        websocket._workdir = os.getcwd()

    def _tag(result: dict) -> dict:
        if req_id is not None:
            result['_reqId'] = req_id
        return result

    try:
        if msg_type == 'browse_files':
            path = _resolve_user_path(websocket, data.get('path'), default=websocket._workdir)
            result = browse_directory(path, data.get('mode', 'file'))
            await websocket.send_json(_tag(result))

        elif msg_type == 'read_text_file':
            path = _resolve_user_path(websocket, data.get('path'))
            result = _read_text_file(path)
            await websocket.send_json(_tag(result))

        elif msg_type == 'validate_config':
            config = _resolve_config_paths(websocket, data.get('config', {}))
            result = _validate_config(config, data.get('router'))
            await websocket.send_json(_tag(result))

        # ----- Job queue messages -----

        elif msg_type == 'submit_jobs':
            jobs_data = data.get('jobs', [])
            for jd in jobs_data:
                resolved = _resolve_config_paths(websocket, jd.get('config', {}))
                jd['config'] = clean_config(resolved)
                jd['router'] = resolve_router_name(jd.get('router'))
            ids = job_manager.submit_jobs(jobs_data)
            await websocket.send_json(_tag({
                'type': 'jobs_added',
                'job_ids': ids,
            }))
            if data.get('autostart'):
                await job_manager.run_queue()

        elif msg_type == 'run_queue':
            await job_manager.run_queue(
                max_concurrency=data.get('max_concurrency'),
            )

        elif msg_type == 'cancel_job':
            job_manager.cancel_job(data.get('job_id', ''))

        elif msg_type == 'cancel_all':
            job_manager.cancel_all()

        elif msg_type == 'remove_job':
            job_manager.remove_job(data.get('job_id', ''))
            await websocket.send_json(_tag({
                'type': 'job_removed',
                'job_id': data.get('job_id', ''),
            }))

        elif msg_type == 'clear_finished':
            job_manager.clear_finished()
            await websocket.send_json(_tag(job_manager.get_snapshot()))

        elif msg_type == 'clear_all':
            job_manager.clear_all()
            await websocket.send_json(_tag(job_manager.get_snapshot()))

        elif msg_type == 'get_queue_status':
            await websocket.send_json(_tag(job_manager.get_snapshot()))

        elif msg_type == 'get_job_logs':
            job_id = data.get('job_id', '')
            job = job_manager.jobs.get(job_id)
            if job:
                await websocket.send_json(_tag({
                    'type': 'job_logs',
                    'job_id': job_id,
                    'logs': job.logs,
                }))
            else:
                await websocket.send_json(_tag({
                    'type': 'error',
                    'error': f'Unknown job: {job_id}',
                }))

        # ----- Results & validation (unchanged) -----

        elif msg_type == 'read_results':
            files = _resolve_path_list(websocket, data.get('files', []))
            directory = data.get('directory')
            if directory:
                directory = _resolve_user_path(websocket, directory)
                if os.path.isdir(directory):
                    files = sorted(
                        os.path.join(directory, f)
                        for f in os.listdir(directory)
                        if f.endswith('.nc') and os.path.isfile(os.path.join(directory, f))
                    )
                else:
                    await websocket.send_json(_tag({
                        'type': 'result_data',
                        'error': f'Not a directory: {directory}',
                        'source': data.get('source'),
                    }))
                    return
            result = read_result_data(
                files,
                data.get('river_id', 0),
                var_river_id=data.get('var_river_id'),
                var_discharge=data.get('var_discharge'),
            )
            if 'source' in data:
                result['source'] = data['source']
            if 'label' in data:
                result['label'] = data['label']
            if 'files' not in result:
                result['files'] = files
            if directory:
                result['directory'] = directory
            await websocket.send_json(_tag(result))

        elif msg_type == 'read_ref_csv':
            result = read_ref_csv_data(
                ref_csv=data.get('ref_csv', ''),
                river_id=int(data.get('river_id', 0)),
                csv_river_id=int(data['csv_river_id']) if data.get('csv_river_id') is not None else None,
                csv_river_ids=_parse_int_list(data.get('csv_river_ids')),
            )
            if 'source' in data:
                result['source'] = data['source']
            if 'label' in data:
                result['label'] = data['label']
            await websocket.send_json(_tag(result))

        elif msg_type == 'list_river_ids':
            files = _resolve_path_list(websocket, data.get('files', []))
            result = list_river_ids(files, var_river_id=data.get('var_river_id'))
            await websocket.send_json(_tag(result))

        elif msg_type == 'validate_results':
            sim_files = _resolve_path_list(websocket, data.get('sim_files', []))
            ref_files = _resolve_path_list(websocket, data.get('ref_files', []))
            result = validate_results(
                sim_files=sim_files,
                ref_files=ref_files,
                river_ids=data.get('river_ids'),
                var_river_id=data.get('var_river_id'),
                var_discharge=data.get('var_discharge'),
                ref_csv=data.get('ref_csv'),
                csv_river_id=int(data['csv_river_id']) if data.get('csv_river_id') is not None else None,
                csv_river_ids=_parse_int_list(data.get('csv_river_ids')),
            )
            await websocket.send_json(_tag(result))

        # ----- Workdir -----

        elif msg_type == 'set_workdir':
            path = _resolve_user_path(websocket, data.get('path'), default=os.getcwd())
            if os.path.isdir(path):
                websocket._workdir = path
                await websocket.send_json(_tag({'type': 'workdir_set', 'path': websocket._workdir}))
            else:
                await websocket.send_json(_tag({'type': 'error', 'error': f'Not a directory: {path}'}))

        elif msg_type == 'get_workdir':
            await websocket.send_json(_tag({'type': 'workdir_set', 'path': websocket._workdir}))

        elif msg_type == 'get_homedir':
            await websocket.send_json(_tag({'type': 'homedir', 'path': os.path.expanduser('~')}))

        else:
            await websocket.send_json(_tag({'type': 'error', 'error': f'Unknown message type: {msg_type}'}))

    except Exception as e:
        await websocket.send_json(_tag({
            'type': 'error',
            'error': str(e),
            'traceback': traceback.format_exc(),
        }))


def _clean_config(config: dict) -> dict:
    return clean_config(config)


def _validate_config(config: dict, router_name: str | None = None) -> dict:
    from river_route import Configs, Muskingum, RapidMuskingum, UnitMuskingum

    routers = {
        'Muskingum': Muskingum,
        'RapidMuskingum': RapidMuskingum,
        'UnitMuskingum': UnitMuskingum,
    }

    errors = []
    cleaned = _clean_config(config)
    resolved_router = resolve_router_name(router_name)

    try:
        cfg = Configs(**cleaned)
        if resolved_router in routers:
            # Router-level checks catch required-key and cross-field logic not covered by Configs.
            router = routers[resolved_router](**cleaned)
            router._validate_configs()
    except Exception as e:
        errors.append(str(e))
    return {
        'type': 'validation_result',
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': [],
        'router': resolved_router,
        'normalized_config': cfg.__dict__ if len(errors) == 0 else cleaned,
    }

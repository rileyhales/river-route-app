import os
import traceback

from starlette.websockets import WebSocket

from .browser import browse_directory
from .results import read_result_data, list_river_ids, validate_results
from .runner import job_manager


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
            path = os.path.expanduser(data.get('path', '') or '~')
            result = browse_directory(path, data.get('mode', 'file'))
            await websocket.send_json(_tag(result))

        elif msg_type == 'validate_config':
            result = _validate_config(data.get('config', {}))
            await websocket.send_json(_tag(result))

        # ----- Job queue messages -----

        elif msg_type == 'submit_jobs':
            jobs_data = data.get('jobs', [])
            for jd in jobs_data:
                jd['config'] = _clean_config(jd.get('config', {}))
            ids = job_manager.submit_jobs(jobs_data)
            await websocket.send_json(_tag({
                'type': 'jobs_added',
                'job_ids': ids,
            }))
            if data.get('autostart'):
                await job_manager.run_queue()

        elif msg_type == 'run_queue':
            await job_manager.run_queue()

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

        elif msg_type == 'set_max_workers':
            job_manager.set_max_workers(int(data.get('count', 1)))
            await websocket.send_json(_tag({
                'type': 'max_workers_set',
                'count': job_manager.max_workers,
            }))

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
            files = data.get('files', [])
            directory = data.get('directory')
            if directory:
                directory = os.path.abspath(directory)
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

        elif msg_type == 'list_river_ids':
            files = data.get('files', [])
            result = list_river_ids(files, var_river_id=data.get('var_river_id'))
            await websocket.send_json(_tag(result))

        elif msg_type == 'validate_results':
            sim_files = data.get('sim_files', [])
            ref_files = data.get('ref_files', [])
            result = validate_results(
                sim_files=sim_files,
                ref_files=ref_files,
                river_ids=data.get('river_ids'),
                var_river_id=data.get('var_river_id'),
                var_discharge=data.get('var_discharge'),
                ref_csv=data.get('ref_csv'),
                csv_river_id=int(data['csv_river_id']) if data.get('csv_river_id') is not None else None,
            )
            await websocket.send_json(_tag(result))

        # ----- Workdir -----

        elif msg_type == 'set_workdir':
            path = os.path.abspath(data.get('path', '') or os.getcwd())
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
    cleaned = {}
    for key, val in config.items():
        if val is None or val == '':
            continue
        if isinstance(val, list) and len(val) == 0:
            continue
        cleaned[key] = val
    return cleaned


def _validate_config(config: dict) -> dict:
    from river_route import Configs
    errors = []
    try:
        cleaned = _clean_config(config)
        cfg = Configs(**cleaned)
        cfg.deep_validate()
    except Exception as e:
        errors.append(str(e))
    return {
        'type': 'validation_result',
        'valid': len(errors) == 0,
        'errors': errors,
    }
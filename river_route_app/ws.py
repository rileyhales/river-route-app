import os
import traceback

from starlette.websockets import WebSocket

from .browser import browse_directory
from .results import read_result_data
from .runner import sim_state, run_simulation


async def handle_ws_message(websocket: WebSocket, data: dict) -> None:
    msg_type = data.get('type')
    req_id = data.get('_reqId')

    # Per-session workdir stored on the websocket's state dict
    if not hasattr(websocket, '_workdir'):
        websocket._workdir = os.getcwd()

    def _tag(result: dict) -> dict:
        """Echo _reqId back so the client can correlate responses."""
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

        elif msg_type == 'run_simulation':
            await run_simulation(data.get('router', ''), _clean_config(data.get('config', {})))

        elif msg_type == 'cancel_simulation':
            if sim_state.running:
                sim_state.cancel()
            else:
                await websocket.send_json(_tag({'type': 'sim_cancelled'}))

        elif msg_type == 'get_sim_status':
            await websocket.send_json(_tag(sim_state.get_snapshot()))

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
    """Strip empty/null values so the Configs dataclass gets clean kwargs."""
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

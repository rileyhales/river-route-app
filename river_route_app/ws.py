import os
import traceback

from starlette.websockets import WebSocket

from .browser import browse_directory
from .results import read_result_data
from .runner import sim_state, run_simulation

# Per-session working directory — defaults to cwd where the server was launched
_workdir = os.getcwd()


async def handle_ws_message(websocket: WebSocket, data: dict) -> None:
    global _workdir
    msg_type = data.get('type')

    try:
        if msg_type == 'browse_files':
            path = data.get('path', '') or _workdir
            result = browse_directory(path, data.get('mode', 'file'))
            await websocket.send_json(result)

        elif msg_type == 'validate_config':
            result = _validate_config(data.get('config', {}))
            await websocket.send_json(result)

        elif msg_type == 'run_simulation':
            await run_simulation(data.get('router', ''), _clean_config(data.get('config', {})))

        elif msg_type == 'cancel_simulation':
            if sim_state.running:
                sim_state.cancel()
            else:
                await websocket.send_json({'type': 'sim_cancelled'})

        elif msg_type == 'get_sim_status':
            await websocket.send_json(sim_state.get_snapshot())

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
                    await websocket.send_json({
                        'type': 'result_data',
                        'error': f'Not a directory: {directory}',
                        'source': data.get('source'),
                    })
                    return
            result = read_result_data(
                files,
                data.get('river_id', 0),
                var_river_id=data.get('var_river_id'),
                var_discharge=data.get('var_discharge'),
            )
            if 'source' in data:
                result['source'] = data['source']
            if directory:
                result['directory'] = directory
                result['files'] = files
            await websocket.send_json(result)

        elif msg_type == 'set_workdir':
            path = os.path.abspath(data.get('path', '') or os.getcwd())
            if os.path.isdir(path):
                _workdir = path
                await websocket.send_json({'type': 'workdir_set', 'path': _workdir})
            else:
                await websocket.send_json({'type': 'error', 'error': f'Not a directory: {path}'})

        elif msg_type == 'get_workdir':
            await websocket.send_json({'type': 'workdir_set', 'path': _workdir})

        else:
            await websocket.send_json({'type': 'error', 'error': f'Unknown message type: {msg_type}'})

    except Exception as e:
        await websocket.send_json({
            'type': 'error',
            'error': str(e),
            'traceback': traceback.format_exc(),
        })


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

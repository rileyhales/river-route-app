import logging
import os

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import WebSocketRoute, Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .runner import job_manager
from .ws import handle_ws_message

logger = logging.getLogger(__name__)

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')


async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    job_manager.subscribers.add(websocket)
    try:
        await websocket.send_json(job_manager.get_snapshot())
        while True:
            data = await websocket.receive_json()
            await handle_ws_message(websocket, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug('WebSocket error', exc_info=True)
    finally:
        job_manager.subscribers.discard(websocket)


async def health(request):
    return JSONResponse({'status': 'ok'})


def _build_routes():
    r = [
        WebSocketRoute('/ws', ws_endpoint),
        Route('/health', health),
    ]
    if os.path.isdir(STATIC_DIR) and os.listdir(STATIC_DIR):
        r.append(Mount('/', app=StaticFiles(directory=STATIC_DIR, html=True)))
    return r


app = Starlette(routes=_build_routes())


def main():
    """CLI entry point: ``river-route-app``."""
    import uvicorn
    uvicorn.run('river_route_app.server:app', host='127.0.0.1', port=8000)

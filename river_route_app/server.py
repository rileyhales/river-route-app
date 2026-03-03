import os

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import WebSocketRoute, Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket

from .runner import sim_state
from .ws import handle_ws_message

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')


async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    sim_state.subscribers.add(websocket)
    try:
        # Send current simulation state so reconnecting clients can restore UI
        await websocket.send_json(sim_state.get_snapshot())
        while True:
            data = await websocket.receive_json()
            await handle_ws_message(websocket, data)
    except Exception:
        # client disconnected or protocol error — do NOT cancel the simulation
        pass
    finally:
        sim_state.subscribers.discard(websocket)


async def health(request):
    return JSONResponse({'status': 'ok'})


routes = [
    WebSocketRoute('/ws', ws_endpoint),
    Route('/health', health),
]

# Mount built frontend static files
if os.path.isdir(STATIC_DIR) and os.listdir(STATIC_DIR):
    routes.append(Mount('/', app=StaticFiles(directory=STATIC_DIR, html=True)))

app = Starlette(routes=routes)

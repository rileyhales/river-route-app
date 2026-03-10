import sys
import types
import unittest


def _install_stubs():
    if 'starlette.applications' not in sys.modules:
        starlette_mod = types.ModuleType('starlette')
        applications_mod = types.ModuleType('starlette.applications')
        responses_mod = types.ModuleType('starlette.responses')
        routing_mod = types.ModuleType('starlette.routing')
        staticfiles_mod = types.ModuleType('starlette.staticfiles')
        websockets_mod = types.ModuleType('starlette.websockets')

        class Starlette:
            def __init__(self, routes=None):
                self.routes = routes or []

        class JSONResponse:
            def __init__(self, content):
                self.content = content

        class WebSocketRoute:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

        class Route:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

        class Mount:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

        class StaticFiles:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

        class WebSocket:
            pass

        class WebSocketDisconnect(Exception):
            pass

        applications_mod.Starlette = Starlette
        responses_mod.JSONResponse = JSONResponse
        routing_mod.WebSocketRoute = WebSocketRoute
        routing_mod.Route = Route
        routing_mod.Mount = Mount
        staticfiles_mod.StaticFiles = StaticFiles
        websockets_mod.WebSocket = WebSocket
        websockets_mod.WebSocketDisconnect = WebSocketDisconnect

        starlette_mod.applications = applications_mod
        starlette_mod.responses = responses_mod
        starlette_mod.routing = routing_mod
        starlette_mod.staticfiles = staticfiles_mod
        starlette_mod.websockets = websockets_mod

        sys.modules['starlette'] = starlette_mod
        sys.modules['starlette.applications'] = applications_mod
        sys.modules['starlette.responses'] = responses_mod
        sys.modules['starlette.routing'] = routing_mod
        sys.modules['starlette.staticfiles'] = staticfiles_mod
        sys.modules['starlette.websockets'] = websockets_mod

    if 'river_route_app.results' not in sys.modules:
        results_mod = types.ModuleType('river_route_app.results')
        results_mod.read_result_data = lambda *args, **kwargs: {}
        results_mod.list_river_ids = lambda *args, **kwargs: {}
        results_mod.validate_results = lambda *args, **kwargs: {}
        results_mod.read_ref_csv_data = lambda *args, **kwargs: {}
        sys.modules['river_route_app.results'] = results_mod


_install_stubs()

from river_route_app import server


class ServerCliTests(unittest.TestCase):

    def tearDown(self):
        sys.modules.pop('uvicorn', None)

    def test_main_passes_host_and_port_to_uvicorn(self):
        captured = {}

        uvicorn_mod = types.ModuleType('uvicorn')

        def run(app, host, port):
            captured['app'] = app
            captured['host'] = host
            captured['port'] = port

        uvicorn_mod.run = run
        sys.modules['uvicorn'] = uvicorn_mod

        server.main(['--host', '0.0.0.0', '--port', '9000'])

        self.assertEqual(captured['app'], 'river_route_app.server:app')
        self.assertEqual(captured['host'], '0.0.0.0')
        self.assertEqual(captured['port'], 9000)


if __name__ == '__main__':
    unittest.main()

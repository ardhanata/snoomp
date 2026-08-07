from app.websockets import router

def test_websocket_router_exists():
    assert any(route.path == "/api/ws" for route in router.routes)

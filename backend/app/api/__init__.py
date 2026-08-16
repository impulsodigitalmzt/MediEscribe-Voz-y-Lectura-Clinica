from app.api.auth_routes import router as auth_router
from app.api.encounter_routes import router as encounter_router
from app.api.template_routes import router as template_router
from app.api.ws_routes import router as ws_router

__all__ = ["auth_router", "encounter_router", "template_router", "ws_router"]

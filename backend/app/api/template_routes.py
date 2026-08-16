"""Template API Routes — Specialty template listing and retrieval."""

from fastapi import APIRouter, Depends, HTTPException
from app.services import template_manager
from app.api.dependencies import get_current_user

router = APIRouter(prefix="/templates", tags=["Templates"])


@router.get("")
async def list_templates(current_user: dict = Depends(get_current_user)):
    """List all available specialty templates."""
    return {"templates": template_manager.list_templates()}


@router.get("/{template_id}")
async def get_template(
    template_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get a specific template with full section details."""
    template = template_manager.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    return template

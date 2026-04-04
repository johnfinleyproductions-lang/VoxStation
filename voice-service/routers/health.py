"""Health check endpoint."""

from fastapi import APIRouter
from services.whisper_service import whisper_service
from services.tts_service import tts_service
from services.gpu_monitor import get_gpu_info

router = APIRouter()


@router.get("/health")
async def health_check():
    """Service health with model status and GPU info."""
    return {
        "status": "ok",
        "service": "voxstation-voice",
        "models": {
            "whisper": {
                "loaded": whisper_service.model is not None,
            },
            "xtts": {
                "loaded": tts_service.model is not None,
            },
        },
        "voices": len(tts_service.list_voices()),
        "gpu": get_gpu_info(),
    }

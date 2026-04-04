"""
VoxStation Voice Service
========================
FastAPI service providing GPU-accelerated speech-to-text (Whisper)
and text-to-speech with voice cloning (XTTS v2).

Runs on Framestation 395 with RTX PRO 4500 Blackwell 32GB.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from services.whisper_service import whisper_service
from services.tts_service import tts_service
from routers import transcribe, synthesize, voices, health

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voxstation")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models on startup, release on shutdown."""
    logger.info("Loading Whisper model: %s", settings.whisper_model)
    whisper_service.load_model()
    logger.info("Whisper model loaded")

    logger.info("Loading XTTS v2 model")
    tts_service.load_model()
    logger.info("XTTS v2 model loaded")

    logger.info("VoxStation Voice Service ready on port %d", settings.port)
    yield

    logger.info("Shutting down VoxStation Voice Service")
    whisper_service.unload()
    tts_service.unload()


app = FastAPI(
    title="VoxStation Voice Service",
    description="GPU-accelerated STT + TTS with voice cloning for VoxStation",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(transcribe.router, prefix="/transcribe", tags=["stt"])
app.include_router(synthesize.router, prefix="/synthesize", tags=["tts"])
app.include_router(voices.router, prefix="/voices", tags=["voices"])

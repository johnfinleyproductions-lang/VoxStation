"""
Voices Router — Voice Profile Management
=========================================
List voices, upload reference samples for cloning.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

from services.tts_service import tts_service

router = APIRouter()


@router.get("")
async def list_voices():
    """List all available voice profiles."""
    return {"voices": tts_service.list_voices()}


@router.get("/{voice_id}")
async def get_voice(voice_id: str):
    """Get details for a specific voice profile."""
    voices = tts_service.list_voices()
    voice = next((v for v in voices if v["id"] == voice_id), None)
    if not voice:
        raise HTTPException(404, f"Voice '{voice_id}' not found")
    return voice


@router.post("/clone")
async def clone_voice(
    voice_id: str = Form(..., description="Unique voice identifier (e.g., 'john')"),
    audio: UploadFile = File(..., description="Reference audio sample (WAV, 6-30s, clean speech)"),
    name: Optional[str] = Form(None, description="Display name for the voice"),
    description: Optional[str] = Form(None, description="Voice description"),
):
    """
    Upload a reference audio sample for voice cloning.

    XTTS v2 uses zero-shot cloning — just provide 6-30 seconds of clean
    speech audio and it will match the voice characteristics.

    You can upload multiple samples for the same voice_id to improve quality.

    Requirements:
    - WAV format, 22050Hz mono preferred (will be converted if different)
    - 6-30 seconds of clear speech
    - Quiet background, no music or other speakers
    """
    audio_bytes = await audio.read()

    if len(audio_bytes) == 0:
        raise HTTPException(400, "Empty audio file")
    if len(audio_bytes) > 20 * 1024 * 1024:
        raise HTTPException(413, "Audio too large (max 20MB)")

    try:
        result = await tts_service.clone_voice(
            voice_id=voice_id,
            audio_bytes=audio_bytes,
            filename=audio.filename or "sample.wav",
            name=name,
            description=description,
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Voice clone failed: {str(e)}")

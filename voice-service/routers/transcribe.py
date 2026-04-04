"""
Transcribe Router — Speech-to-Text
===================================
Accepts audio upload, returns transcribed text.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional

from services.whisper_service import whisper_service

router = APIRouter()


@router.post("")
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file (WAV, WebM, MP3, etc.)"),
    language: Optional[str] = Form(None, description="Language code (e.g., 'en'). Auto-detect if omitted."),
):
    """
    Transcribe audio to text using Whisper.

    Accepts any audio format that ffmpeg supports.
    Returns the full transcription plus per-segment timestamps.
    """
    if whisper_service.model is None:
        raise HTTPException(503, "Whisper model not loaded")

    audio_bytes = await audio.read()
    if len(audio_bytes) == 0:
        raise HTTPException(400, "Empty audio file")

    # Limit file size (50MB)
    if len(audio_bytes) > 50 * 1024 * 1024:
        raise HTTPException(413, "Audio file too large (max 50MB)")

    try:
        result = await whisper_service.transcribe(audio_bytes, language=language)
        return result
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {str(e)}")

"""
Synthesize Router — Text-to-Speech
===================================
Accepts text, returns audio in a cloned voice.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.tts_service import tts_service

router = APIRouter()


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    voice_id: str = Field(default="default", description="Voice profile ID")
    language: str = Field(default="en", description="Language code")


@router.post("")
async def synthesize_speech(request: SynthesizeRequest):
    """
    Synthesize text to speech using XTTS v2 with voice cloning.

    Returns WAV audio bytes with the specified cloned voice.
    """
    if tts_service.model is None:
        raise HTTPException(503, "XTTS v2 model not loaded")

    try:
        audio_bytes = await tts_service.synthesize(
            text=request.text,
            voice_id=request.voice_id,
            language=request.language,
        )
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=voxstation_speech.wav",
            },
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Synthesis failed: {str(e)}")

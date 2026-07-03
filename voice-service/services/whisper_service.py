"""
Whisper STT Service
===================
Speech-to-text using faster-whisper (CTranslate2).
GPU-accelerated when CUDA available, falls back to CPU with int8.
"""

import io
import logging
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

from config import settings

logger = logging.getLogger("voxstation.whisper")


class WhisperService:
    """Manages the Whisper model and transcription."""

    def __init__(self):
        self.model: Optional[WhisperModel] = None

    def load_model(self):
        """Load the Whisper model."""
        compute_type = settings.effective_compute_type
        logger.info(
            "Loading Whisper %s on %s (%s)...",
            settings.whisper_model,
            settings.whisper_device,
            compute_type,
        )
        self.model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=compute_type,
            download_root=str(settings.models_dir / "whisper"),
        )
        logger.info(
            "Whisper %s loaded on %s (%s)",
            settings.whisper_model,
            settings.whisper_device,
            compute_type,
        )

    def unload(self):
        """Release model from memory."""
        self.model = None
        logger.info("Whisper model unloaded")

    async def transcribe(
        self,
        audio_bytes: bytes,
        language: Optional[str] = None,
        word_timestamps: bool = False,
    ) -> dict:
        """
        Transcribe audio bytes to text.

        Args:
            audio_bytes: Raw audio file bytes (WAV, MP3, WebM, etc.)
            language: Optional language code (e.g., 'en'). Auto-detect if None.
            word_timestamps: When True, each segment also carries a "words"
                list of {word, start, end} for per-word editing tools.

        Returns:
            dict with keys: text, language, duration, segments
        """
        if self.model is None:
            raise RuntimeError("Whisper model not loaded")

        # Write audio bytes to temp file (faster-whisper needs a file path)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()

            segments_gen, info = self.model.transcribe(
                tmp.name,
                language=language,
                beam_size=5,
                word_timestamps=word_timestamps,
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=200,
                ),
            )

            # Collect segments
            segments = []
            full_text_parts = []
            for segment in segments_gen:
                entry = {
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": segment.text.strip(),
                }
                if word_timestamps:
                    entry["words"] = [
                        {
                            "word": word.word,
                            "start": round(word.start, 3),
                            "end": round(word.end, 3),
                        }
                        for word in (segment.words or [])
                    ]
                segments.append(entry)
                full_text_parts.append(segment.text.strip())

        full_text = " ".join(full_text_parts)

        result = {
            "text": full_text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 2),
            "segments": segments,
        }

        logger.info(
            "Transcribed %.1fs audio \u2192 %d chars (%s, p=%.2f)",
            info.duration,
            len(full_text),
            info.language,
            info.language_probability,
        )

        return result


# Singleton
whisper_service = WhisperService()

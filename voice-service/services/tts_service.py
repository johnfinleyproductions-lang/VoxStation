"""
TTS Service with Voice Cloning
===============================
GPU-accelerated text-to-speech using Chatterbox (Resemble AI).
Zero-shot voice cloning from a short reference audio sample.

Note: On Blackwell GPUs (sm_120), Chatterbox runs on CPU because
PyTorch doesn't ship sm_120 kernels yet. faster-whisper uses CTranslate2
which has its own CUDA backend and works fine on Blackwell.
"""

import io
import logging
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import torch
import torchaudio

from config import settings

logger = logging.getLogger("voxstation.tts")


def convert_to_wav(audio_bytes: bytes) -> bytes:
    """
    Convert any audio format (WebM, MP3, OGG, etc.) to 24kHz mono WAV
    using ffmpeg. This handles browser recordings which are typically
    WebM/opus format that soundfile can't read directly.
    """
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as infile:
        infile.write(audio_bytes)
        infile.flush()

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as outfile:
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", infile.name,
                    "-ar", "24000",
                    "-ac", "1",
                    "-f", "wav",
                    outfile.name,
                ],
                capture_output=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg conversion failed: {result.stderr.decode()}"
                )
            outfile.seek(0)
            return outfile.read()


class TTSService:
    """Manages Chatterbox model, voice profiles, and synthesis."""

    def __init__(self):
        self.model = None
        self.voices_dir = settings.voices_dir
        self.voices_dir.mkdir(parents=True, exist_ok=True)

    def load_model(self):
        """Load Chatterbox TTS onto configured device."""
        from chatterbox.tts import ChatterboxTTS

        device = settings.xtts_device
        logger.info("Loading Chatterbox TTS on %s...", device)
        self.model = ChatterboxTTS.from_pretrained(device=device)
        logger.info("Chatterbox TTS loaded on %s", device)

    def unload(self):
        """Release model from memory."""
        self.model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Chatterbox TTS model unloaded")

    def list_voices(self) -> list[dict]:
        """List all available voice profiles."""
        voices = []
        for voice_dir in sorted(self.voices_dir.iterdir()):
            if not voice_dir.is_dir():
                continue
            meta_file = voice_dir / "meta.json"
            samples = list(voice_dir.glob("*.wav"))
            meta = {}
            if meta_file.exists():
                meta = json.loads(meta_file.read_text())
            voices.append({
                "id": voice_dir.name,
                "name": meta.get("name", voice_dir.name),
                "description": meta.get("description", ""),
                "sample_count": len(samples),
                "samples": [s.name for s in samples],
            })
        return voices

    def get_voice_sample(self, voice_id: str) -> str:
        """Get file path to a voice's reference sample (best one)."""
        voice_dir = self.voices_dir / voice_id
        if not voice_dir.exists():
            raise ValueError(f"Voice '{voice_id}' not found")
        samples = sorted(voice_dir.glob("*.wav"))
        if not samples:
            raise ValueError(f"No WAV samples found for voice '{voice_id}'")
        # Use the first/primary sample
        return str(samples[0])

    async def clone_voice(
        self,
        voice_id: str,
        audio_bytes: bytes,
        filename: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> dict:
        """
        Save a voice reference sample for cloning.
        Accepts any audio format (WebM, WAV, MP3, etc.) and converts
        to 24kHz mono WAV via ffmpeg.
        """
        voice_dir = self.voices_dir / voice_id
        voice_dir.mkdir(parents=True, exist_ok=True)

        # Save the audio sample
        existing = list(voice_dir.glob("*.wav"))
        sample_num = len(existing) + 1
        sample_path = voice_dir / f"sample_{sample_num:02d}.wav"

        # Convert to WAV using ffmpeg (handles WebM, MP3, OGG, etc.)
        try:
            wav_bytes = convert_to_wav(audio_bytes)
        except RuntimeError as e:
            logger.error("Audio conversion failed: %s", e)
            raise ValueError(f"Voice clone failed: {e}")

        # Write the converted WAV
        sample_path.write_bytes(wav_bytes)

        # Update metadata
        meta_file = voice_dir / "meta.json"
        meta = {}
        if meta_file.exists():
            meta = json.loads(meta_file.read_text())
        if name:
            meta["name"] = name
        if description:
            meta["description"] = description
        meta.setdefault("name", voice_id)
        meta_file.write_text(json.dumps(meta, indent=2))

        logger.info("Saved voice sample: %s (%s)", sample_path, voice_id)

        return {
            "id": voice_id,
            "name": meta["name"],
            "sample_saved": sample_path.name,
            "total_samples": len(list(voice_dir.glob("*.wav"))),
        }

    async def synthesize(
        self,
        text: str,
        voice_id: str = "default",
        language: str = "en",
    ) -> bytes:
        """
        Synthesize text to speech using a cloned voice.
        """
        if self.model is None:
            raise RuntimeError("Chatterbox TTS model not loaded")

        # Get reference sample for voice cloning
        speaker_wav = self.get_voice_sample(voice_id)

        logger.info(
            "Synthesizing %d chars with voice '%s' on %s",
            len(text),
            voice_id,
            settings.xtts_device,
        )

        # Generate speech with Chatterbox
        wav_tensor = self.model.generate(
            text=text,
            audio_prompt_path=speaker_wav,
        )

        # Convert tensor to WAV bytes
        buffer = io.BytesIO()
        torchaudio.save(
            buffer,
            wav_tensor.cpu(),
            self.model.sr,
            format="wav",
        )
        buffer.seek(0)

        audio_bytes = buffer.read()
        logger.info("Generated %d bytes of audio", len(audio_bytes))

        return audio_bytes


# Singleton
tts_service = TTSService()

"""
TTS Service with Voice Cloning
===============================
GPU-accelerated text-to-speech using Chatterbox (Resemble AI).
Zero-shot voice cloning from a short reference audio sample.

Supports two model variants via VOXSTATION_MODEL_VARIANT env var:
  - "turbo" (default) — ChatterboxTurboTTS, 350M params, ~75ms latency, 6x realtime
  - "standard" — ChatterboxTTS, the original model

Voice profiles come from two directories:
  - voices_dir (./voices) — voices cloned via /voices/clone endpoint
  - stock_voices_dir (./stock_voices) — bundled reference voices shipped with the repo

Both follow the same on-disk layout:
  <id>/sample_NN.wav  + optional meta.json with name + description.

Runs on CUDA (Blackwell sm_120) using PyTorch nightly cu128.
Audio is saved via soundfile — torchaudio.save() in nightly torch 2.12+
defaults to TorchCodec which is not installed.
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
    """Manages Chatterbox model, voice profiles (cloned + stock), and synthesis."""

    def __init__(self):
        self.model = None
        self.voices_dir = settings.voices_dir
        self.stock_voices_dir = settings.stock_voices_dir
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.stock_voices_dir.mkdir(parents=True, exist_ok=True)

    def load_model(self):
        """Load Chatterbox TTS onto configured device.

        Switches between Turbo and Standard based on settings.model_variant.
        """
        device = settings.xtts_device
        variant = (settings.model_variant or "turbo").lower()

        if variant == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            logger.info("Loading Chatterbox Turbo on %s...", device)
            self.model = ChatterboxTurboTTS.from_pretrained(device=device)
            logger.info("Chatterbox Turbo loaded on %s", device)
        else:
            from chatterbox.tts import ChatterboxTTS
            logger.info("Loading Chatterbox (standard) on %s...", device)
            self.model = ChatterboxTTS.from_pretrained(device=device)
            logger.info("Chatterbox (standard) loaded on %s", device)

    def unload(self):
        """Release model from memory."""
        self.model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Chatterbox TTS model unloaded")

    def _scan_voice_dir(self, root: Path, kind: str) -> list[dict]:
        """Scan one voice root directory and return entries."""
        entries = []
        if not root.exists():
            return entries
        for voice_dir in sorted(root.iterdir()):
            if not voice_dir.is_dir():
                continue
            meta_file = voice_dir / "meta.json"
            samples = list(voice_dir.glob("*.wav"))
            if not samples:
                continue
            meta = {}
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text())
                except json.JSONDecodeError:
                    logger.warning("Bad meta.json for %s", voice_dir.name)
            entries.append({
                "id": voice_dir.name,
                "name": meta.get("name", voice_dir.name),
                "description": meta.get("description", ""),
                "kind": kind,
                "sample_count": len(samples),
                "samples": [s.name for s in samples],
            })
        return entries

    def list_voices(self) -> list[dict]:
        """List all available voice profiles, stock first then cloned.

        Cloned voices override stock voices with the same id.
        """
        stock = self._scan_voice_dir(self.stock_voices_dir, "stock")
        cloned = self._scan_voice_dir(self.voices_dir, "cloned")
        merged = {entry["id"]: entry for entry in stock}
        for entry in cloned:
            merged[entry["id"]] = entry
        return list(merged.values())

    def get_voice_sample(self, voice_id: str) -> str:
        """Get file path to a voice's reference sample.

        Tries cloned voices first (most specific), then stock voices.
        Raises ValueError if voice_id doesn't exist in either directory.
        """
        for root in (self.voices_dir, self.stock_voices_dir):
            voice_dir = root / voice_id
            if voice_dir.exists():
                samples = sorted(voice_dir.glob("*.wav"))
                if samples:
                    return str(samples[0])
        raise ValueError(f"Voice '{voice_id}' not found")

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

        existing = list(voice_dir.glob("*.wav"))
        sample_num = len(existing) + 1
        sample_path = voice_dir / f"sample_{sample_num:02d}.wav"

        try:
            wav_bytes = convert_to_wav(audio_bytes)
        except RuntimeError as e:
            logger.error("Audio conversion failed: %s", e)
            raise ValueError(f"Voice clone failed: {e}")

        sample_path.write_bytes(wav_bytes)

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
        Synthesize text to speech using a cloned or stock voice.

        Uses soundfile to write WAV — avoids torchaudio.save() which
        requires TorchCodec in nightly torch 2.12+.
        """
        if self.model is None:
            raise RuntimeError("Chatterbox TTS model not loaded")

        speaker_wav = self.get_voice_sample(voice_id)

        logger.info(
            "Synthesizing %d chars with voice '%s' on %s",
            len(text),
            voice_id,
            settings.xtts_device,
        )

        wav_tensor = self.model.generate(
            text=text,
            audio_prompt_path=speaker_wav,
        )

        # Convert tensor to numpy and write WAV via soundfile.
        wav_numpy = wav_tensor.cpu().squeeze().numpy()
        buffer = io.BytesIO()
        sf.write(buffer, wav_numpy, self.model.sr, format="WAV", subtype="PCM_16")
        buffer.seek(0)

        audio_bytes = buffer.read()
        logger.info("Generated %d bytes of audio", len(audio_bytes))

        return audio_bytes


# Singleton
tts_service = TTSService()

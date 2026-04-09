"""VoxStation Voice Service Configuration"""

from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8020

    # Whisper STT
    whisper_model: str = "large-v3"
    whisper_device: str = "cuda"
    whisper_compute_type: str = ""  # empty = auto-detect based on device

    # XTTS v2 TTS
    xtts_device: str = "cuda"

    # Paths
    voices_dir: Path = Path("./voices")
    models_dir: Path = Path("./models")

    # Audio defaults
    sample_rate: int = 22050
    max_audio_duration: int = 300  # 5 minutes max recording

    # CORS — allow all VoxStation clients on the LAN.
    # Add your Mac's IP here if accessing from a different machine.
    cors_origins: list[str] = [
        "http://localhost:3050",
        "http://127.0.0.1:3050",
        "http://192.168.4.165:3050",
        "http://192.168.4.176:3050",  # Framestation
    ]

    @property
    def effective_compute_type(self) -> str:
        """Auto-detect compute type if not explicitly set."""
        if self.whisper_compute_type:
            return self.whisper_compute_type
        return "float16" if self.whisper_device == "cuda" else "int8"

    model_config = {"env_file": ".env", "env_prefix": "VOXSTATION_"}


settings = Settings()

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
    whisper_compute_type: str = "float16"

    # XTTS v2 TTS
    xtts_device: str = "cuda"

    # Paths
    voices_dir: Path = Path("./voices")
    models_dir: Path = Path("./models")

    # Audio defaults
    sample_rate: int = 22050
    max_audio_duration: int = 300  # 5 minutes max recording

    # CORS
    cors_origins: list[str] = ["http://localhost:3050", "http://192.168.4.165:3050"]

    model_config = {"env_file": ".env", "env_prefix": "VOXSTATION_"}


settings = Settings()

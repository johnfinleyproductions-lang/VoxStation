FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch nightly cu128 — matches nvidia/cuda:12.8.0 base image exactly.
# The host driver (CUDA 13.2) is backward compatible with cu128.
# cu128 nightly has Blackwell sm_120 support; clock locking via vox script
# ensures GPU stability before the container starts.
# NOTE: If you see CUDA OOM, Ollama may be using too much VRAM.
#       Drop VOXSTATION_WHISPER_MODEL to "medium" (~1.5GB) in the vox script.
COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# Install remaining deps
RUN pip3 install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Create dirs
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

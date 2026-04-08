FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch nightly cu130 — matches nvidia-open-dkms 595.58.03 / CUDA 13.2
# OCuLink + clock locking (done by vox script before Docker starts) makes
# Blackwell sm_120 CUDA stable. CPU-only PyTorch is no longer needed.
# NOTE: If you see CUDA OOM errors, Ollama (LLM) may be using too much VRAM.
#       Drop VOXSTATION_WHISPER_MODEL to "medium" (~1.5GB) in the vox script,
#       or stop Ollama, load voice models, then restart Ollama.
COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu130

# Install remaining deps
RUN pip3 install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Create dirs
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

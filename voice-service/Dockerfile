FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch (no CUDA kernels)
# This prevents PyTorch from crashing on Blackwell sm_120 GPUs.
# faster-whisper uses CTranslate2 which has its own CUDA backend
# that works fine on Blackwell - it doesn't need PyTorch CUDA.
# Chatterbox TTS uses PyTorch but runs on CPU.
COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install remaining deps
RUN pip3 install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Create dirs
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

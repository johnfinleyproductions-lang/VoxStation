FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch with CUDA 12.8 (required for Blackwell sm_120)
COPY requirements.txt .
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu128

# Install remaining deps
RUN pip3 install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Create dirs
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

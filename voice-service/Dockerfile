FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

# PyTorch cu130 nightly — compiled against CUDA 13.0 which natively targets
# Blackwell (sm_120). The host driver (13.2) is forward-compatible and the
# NVIDIA Container Toolkit mounts the driver + CUDA 13.x compat libs at runtime.
#
# If this still shows "sm_120 not compatible", the fallback is to swap the
# FROM line to: nvcr.io/nvidia/pytorch:26.03-py3
# (NVIDIA's own PyTorch image — guaranteed Blackwell support, ~20GB image)
# and remove the torch/torchaudio pip install lines below.
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

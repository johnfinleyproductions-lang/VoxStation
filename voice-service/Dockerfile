FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging

# Step 1: Install PyTorch nightly cu128 — includes Blackwell sm_120 kernels.
RUN pip3 install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128

# Step 2: Install everything except torch, torchaudio, and chatterbox-tts.
# chatterbox-tts (all versions 0.1.0-0.1.7) hard-pins torchaudio==2.6.0.
# Including it here would trigger pip to downgrade our nightly torchaudio.
RUN grep -vE '^torch|^torchaudio|^chatterbox' requirements.txt > /tmp/reqs_base.txt && \
    pip3 install --no-cache-dir -r /tmp/reqs_base.txt

# Step 3: Install chatterbox-tts WITHOUT following its dependencies.
# --no-deps bypasses the torchaudio==2.6.0 hard pin in package metadata.
# chatterbox's runtime code is API-compatible with nightly torchaudio.
RUN pip3 install --no-cache-dir --no-deps chatterbox-tts

# Step 4: Install chatterbox's runtime deps manually (all except torchaudio).
# These are the transitive deps from chatterbox-tts==0.1.7 that are NOT
# torch/torchaudio and do not conflict with the nightly build.
RUN pip3 install --no-cache-dir \
    "resemble-perth>=1.0.0" \
    "pykakasi==2.3.0" \
    "diffusers==0.29.0" \
    omegaconf \
    "librosa==0.11.0" \
    s3tokenizer \
    spacy-pkuseg \
    "transformers==5.2.0" \
    "safetensors==0.5.3" \
    "conformer==0.3.2" \
    pyloudnorm

# App code
COPY . .
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

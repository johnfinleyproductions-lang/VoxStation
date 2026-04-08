FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging

# Step 1: Install PyTorch nightly cu128 FIRST.
# This build includes Blackwell sm_120 compiled kernels (PyTorch 2.7+).
# It must be installed before requirements.txt so it is not overwritten.
RUN pip3 install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128

# Step 2: Install all other requirements, explicitly skipping torch/torchaudio.
# Without this filter, pip downloads the ~530MB stable torch wheel from PyPI
# and overwrites the nightly build above. Filtering prevents that download
# entirely — pip sees nightly torch is already installed and skips it for
# any transitive dependency (e.g. chatterbox-tts) that requires torch.
RUN grep -vE '^torch|^torchaudio' requirements.txt > /tmp/reqs_notorch.txt && \
    pip3 install --no-cache-dir -r /tmp/reqs_notorch.txt

# App code
COPY . .
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

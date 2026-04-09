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

# Step 2: Pin the installed nightly version in a constraints file.
# Without this, chatterbox-tts and resemble-perth resolve torch as a
# transitive dependency and pip downgrades to stable cu124 from PyPI,
# removing Blackwell sm_120 kernels. The constraints file prevents pip
# from changing torch to any other version in subsequent install steps.
RUN pip3 show torch | grep '^Version:' | sed 's/Version: /torch==/' > /tmp/torch_pin.txt && \
    pip3 show torchaudio | grep '^Version:' | sed 's/Version: /torchaudio==/' >> /tmp/torch_pin.txt && \
    echo "Pinned torch constraint:" && cat /tmp/torch_pin.txt

# Step 3: Install all other requirements with the nightly pin enforced.
# pip will see torch is already installed at the pinned version and skip it.
RUN grep -vE '^torch|^torchaudio' requirements.txt > /tmp/reqs_notorch.txt && \
    pip3 install --no-cache-dir -c /tmp/torch_pin.txt -r /tmp/reqs_notorch.txt

# App code
COPY . .
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

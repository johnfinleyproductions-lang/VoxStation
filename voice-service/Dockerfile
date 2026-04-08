FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging

# Install all requirements FIRST — requirements.txt contains torch>=2.5.0
# which pip satisfies from PyPI stable (2.6.x). That is intentional here.
RUN pip3 install --no-cache-dir -r requirements.txt

# Install PyTorch nightly cu128 LAST with --force-reinstall.
# This overwrites the stable torch from requirements.txt with the nightly
# 2.7+ build that includes compiled Blackwell sm_120 kernels.
# cu128 matches the nvidia/cuda:12.8.0 base; host driver 13.2 is compatible.
# MUST be the final pip step — any pip install after this may overwrite it.
RUN pip3 install --no-cache-dir --force-reinstall torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128

# App code
COPY . .
RUN mkdir -p models voices

EXPOSE 8020

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]

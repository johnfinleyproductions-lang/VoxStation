# VoxStation

Voice-enabled AI chat system running entirely on local hardware. Speak to your AI, get responses in your own cloned voice.

**Pipeline:** Speak → Whisper STT → Ollama LLM + Qdrant RAG → Chatterbox TTS (cloned voice) → Audio playback

---

## Architecture

VoxStation runs across three services on a single machine (Framestation 395):

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Mac)                                              │
│  http://192.168.4.176:3050                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Chat UI  │  │ Voice    │  │ Clone    │                  │
│  │ SSE      │  │ Controls │  │ /clone   │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
└───────┼──────────────┼─────────────┼────────────────────┘
        │              │             │
        ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js Frontend (port 3050)                               │
│  /api/chat          → Ollama + RAG → SSE stream             │
│  /api/voice/transcribe → Voice Service /transcribe          │
│  /api/voice/synthesize → Voice Service /synthesize          │
│  /api/voice/clone      → Voice Service /voices/clone        │
│  /api/voice/voices     → Voice Service /voices              │
│  /api/voice/pipeline   → Full voice pipeline                │
└────────┬───────────────────────┬────────────────────────────┘
         │                       │
         ▼                       ▼
┌──────────────────┐   ┌──────────────────────────────────────┐
│  Ollama (11434)  │   │  Voice Service Docker (8020)         │
│  nemotron-3-nano │   │  ├─ Whisper STT → CUDA ✅            │
│  :30b on GPU     │   │  └─ Chatterbox TTS → CUDA ✅         │
│                  │   │     (PyTorch nightly cu128, sm_120)   │
└──────────────────┘   └──────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  Qdrant (6333)   │
│  evergreen_kb    │
│  collection      │
└──────────────────┘
```

---

## Hardware

| Item | Details |
|---|---|
| **GPU** | NVIDIA RTX PRO 4500 Blackwell 32GB (sm_120, compute capability 12.0) |
| **eGPU Connection** | OCuLink dock — 1933 MHz stable clocks (vs 700 MHz max on USB4/Thunderbolt) |
| **Host CUDA** | 13.2 (driver 595.58.03, nvidia-open-dkms) |
| **OS** | CachyOS / Arch Linux |
| **Host** | Framestation 395 (IP: `192.168.4.176`) |
| **Client** | Mac Mini M4 (daily driver / browser) |

**OCuLink vs USB4:** The RTX PRO 4500 is connected via an OCuLink eGPU dock. OCuLink provides the full PCIe bandwidth needed to sustain GPU boost clocks. On USB4/Thunderbolt the GPU is bottlenecked to ~700 MHz — OCuLink removes that ceiling entirely.

---

## Services and Ports

| Service | Port | Host | Notes |
|---|---|---|---|
| Next.js frontend | 3050 | Framestation | Web UI + API proxy |
| Voice service | 8020 | Framestation | Docker container, full CUDA |
| Ollama | 11434 | Framestation | LLM inference on GPU |
| Qdrant | 6333 | Framestation | Vector search for RAG |

---

## The `vox` Script

VoxStation is managed by a single shell script (`vox`) that handles starting, stopping, and managing all services. It is the **only way** you should start VoxStation.

```bash
vox start     # Start all services (locks GPU clocks first)
vox stop      # Stop all containers
vox restart   # Stop + start
vox logs      # Tail voice service logs
vox logs voice  # Tail just the voice service
vox status    # Show container and GPU status
```

### ⚠️ CRITICAL: The System vox vs the Git vox

There are **two copies** of the vox script:
- `~/VoxStation/vox` — the git-tracked source copy
- `/usr/local/bin/vox` — the **system copy** that actually runs when you type `vox`

After any `git pull` that changes the vox script, you **must** manually sync the system copy:

```bash
sudo cp ~/VoxStation/vox /usr/local/bin/vox
```

Forgetting this is a common source of confusion — the system will silently run the old version.

### GPU Clock Locking

`vox start` locks the GPU clocks to 1933 MHz before launching any containers. This ensures stable inference throughput over OCuLink:

```bash
sudo nvidia-smi -lgc 1933,1933
sudo nvidia-smi -pl 186
```

---

## GPU Setup (NVIDIA Container Toolkit)

To enable GPU passthrough into Docker containers, the NVIDIA Container Toolkit must be installed and configured.

### Install

```bash
sudo pacman -S nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Fix for CachyOS / Arch Linux (`no-cgroups` bug)

On CachyOS, the default `config.toml` has `no-cgroups = true`, which causes `--gpus all` to be silently ignored — Docker starts the container without any GPU access and no error is shown.

Edit `/etc/nvidia-container-runtime/config.toml`:
```toml
no-cgroups = false
```

Then restart Docker:
```bash
sudo systemctl restart docker
```

### Verify GPU passthrough works

```bash
docker run --rm --gpus all nvidia/cuda:12.8.0-runtime-ubuntu22.04 nvidia-smi
```

This should show the RTX PRO 4500 with CUDA 13.2. If it shows nothing or errors, the toolkit is not configured correctly.

### Diagnose missing GPU inside a running container

```bash
docker inspect voxstation_voice | grep -A 20 DeviceRequests
```

If `DeviceRequests` is `null`, the container was started without GPU — either the system `/usr/local/bin/vox` is stale, or the toolkit config is wrong.

---

## Project Structure

```
VoxStation/
├── app/
│   ├── page.tsx                    # Main chat + voice UI
│   ├── clone/page.tsx              # Voice cloning UI
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Tailwind + CSS variables
│   └── api/
│       ├── chat/route.ts           # Chat endpoint — streams Ollama via SSE
│       └── voice/
│           ├── transcribe/route.ts # Proxy to voice service STT
│           ├── synthesize/route.ts # Proxy to voice service TTS
│           ├── clone/route.ts      # Proxy to voice service clone
│           ├── voices/route.ts     # List available voice profiles
│           └── pipeline/route.ts   # Full speak→transcribe→LLM→TTS pipeline
├── lib/
│   ├── chat/
│   │   ├── ollama-client.ts        # Streaming Ollama client
│   │   └── rag-client.ts           # Qdrant vector search + context builder
│   ├── voice/
│   │   ├── recorder.ts             # Browser MediaRecorder wrapper
│   │   └── voice-client.ts         # Voice service API client
│   └── utils.ts                    # clsx + tailwind-merge helper
├── components/
│   ├── chat/
│   │   ├── chat-panel.tsx          # Scrolling message list
│   │   └── message-bubble.tsx      # Individual message + audio playback
│   ├── voice/
│   │   └── voice-controls.tsx      # Mic button + text input
│   └── layout/
│       └── status-bar.tsx          # Service health indicators
├── voice-service/                  # Python FastAPI service (Docker)
│   ├── main.py                     # FastAPI app + lifespan (model loading)
│   ├── config.py                   # Pydantic settings (env-driven)
│   ├── Dockerfile                  # CUDA base + nightly PyTorch + --no-deps chatterbox
│   ├── docker-compose.yml          # Compose config (see notes on ghost containers)
│   ├── requirements.txt            # Python deps
│   ├── routers/
│   │   ├── health.py               # GET /health
│   │   ├── transcribe.py           # POST /transcribe
│   │   ├── synthesize.py           # POST /synthesize
│   │   └── voices.py               # GET /voices, POST /voices/clone
│   └── services/
│       ├── whisper_service.py      # faster-whisper STT
│       ├── tts_service.py          # Chatterbox TTS + voice cloning
│       └── gpu_monitor.py          # GPU utilization tracker
├── vox                             # VoxStation management script (git source)
├── .env                            # Runtime config (not committed)
├── .env.example                    # Template
├── package.json                    # Next.js 15 + React 19
├── next.config.ts                  # Minimal config
└── ARCHITECTURE.md                 # Original design doc
```

---

## Environment Variables

Create a `.env` in the project root:

```bash
# IMPORTANT: Use 127.0.0.1, NOT localhost
# Node.js resolves localhost to ::1 (IPv6) but Ollama only listens on IPv4

VOICE_SERVICE_URL=http://127.0.0.1:8020
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=nemotron-3-nano:30b
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=evergreen_kb
EMBEDDING_MODEL=nomic-embed-text
PORT=3050
```

---

## Quick Start

### Prerequisites

On the Framestation:
- Ollama installed with `nemotron-3-nano:30b` pulled
- Qdrant running on port 6333 with `evergreen_kb` collection
- Docker installed with NVIDIA Container Toolkit (see GPU Setup above)
- Node.js 18+ and npm

### 1. Build the voice service image

```bash
cd ~/VoxStation/voice-service
docker build -t voxstation-voice .
```

First build takes ~10-15 minutes (downloads PyTorch nightly and all model deps).

### 2. Start everything with vox

```bash
vox start
```

Wait for the voice service to finish loading models (~60-90s). Check logs:

```bash
vox logs voice
```

**Expected good output:**
```
Loading Whisper large-v2 on cuda (float16)...
Whisper large-v2 loaded on cuda (float16)
Loading Chatterbox TTS on cuda...
Chatterbox TTS loaded on cuda
Application startup complete.
```

### 3. Start the Frontend

```bash
cd ~/VoxStation
npm install
npm run build
npm start
```

### 4. Open in Browser

Navigate to `http://192.168.4.176:3050` from your Mac.

To use the microphone over HTTP (not HTTPS), add the Framestation IP to Chrome's insecure origins:

1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add `http://192.168.4.176:3050`
3. Relaunch Chrome

### 5. Clone Your Voice

1. Click "Clone Voice" in the header (or go to `/clone`)
2. Record a 10-30 second sample of your voice
3. Enter a voice name (e.g., "john")
4. Click "Clone My Voice"

Voice samples are saved to `voice-service/voices/<name>/` as WAV files.

---

## How to Rebuild After Changes

```bash
cd ~/VoxStation && git pull
sudo cp ~/VoxStation/vox /usr/local/bin/vox   # ALWAYS after vox script changes
vox stop
docker rm voxstation_voice
docker rmi voxstation-voice                    # Omit if only the vox script changed
docker build -t voxstation-voice voice-service/
vox start
vox logs voice
```

---

## Blackwell GPU Status (sm_120) — FULLY SOLVED ✅

All VoxStation components run on CUDA on the RTX PRO 4500 Blackwell.

| Component | Status | Notes |
|---|---|---|
| Docker GPU passthrough (`--gpus all`) | ✅ | NVIDIA Container Toolkit + `no-cgroups = false` |
| GPU clocks locked at 1933 MHz via OCuLink | ✅ | `nvidia-smi -lgc 1933,1933` in vox script |
| Ollama LLM on GPU | ✅ | llama.cpp — has its own CUDA kernel path |
| Whisper large-v2 on CUDA (float16) | ✅ | CTranslate2 supports sm_120 natively |
| **Chatterbox TTS on CUDA** | ✅ **SOLVED** | PyTorch nightly 2.12.0.dev20260408+cu128 |

**Solved on:** April 9, 2026  
**PyTorch version confirmed working:** `2.12.0.dev20260408+cu128`  
**Arch list confirmed:** `['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']`

### How it was solved

`chatterbox-tts` versions 0.1.0–0.1.7 all hard-pin `torchaudio==2.6.0`, which forces pip to install `torch==2.6.0+cu124` — a stable build with no sm_120 kernels. The fix is a two-part approach in the Dockerfile:

**1. Install chatterbox with `--no-deps`** to bypass the torchaudio pin:
```dockerfile
RUN pip3 install --no-cache-dir --no-deps chatterbox-tts
```

**2. Install PyTorch nightly cu128 first**, before anything else can overwrite it:
```dockerfile
RUN pip3 install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128
```

PyTorch nightly `2.12.0.dev20260408+cu128` is the first build to include compiled sm_120 kernels.

### Full Dockerfile

```dockerfile
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04
WORKDIR /app
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging
# Install nightly PyTorch FIRST — must happen before any other package touches torch
RUN pip3 install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128
# Install everything except torch/torchaudio/chatterbox
RUN grep -vE '^torch|^torchaudio|^chatterbox' requirements.txt > /tmp/reqs_base.txt && \
    pip3 install --no-cache-dir -r /tmp/reqs_base.txt
# Install chatterbox WITHOUT deps to bypass the torchaudio==2.6.0 hard pin
RUN pip3 install --no-cache-dir --no-deps chatterbox-tts
# Manually supply chatterbox's actual runtime dependencies
RUN pip3 install --no-cache-dir \
    "resemble-perth>=1.0.0" "pykakasi==2.3.0" "diffusers==0.29.0" \
    omegaconf "librosa==0.11.0" s3tokenizer spacy-pkuseg \
    "transformers==5.2.0" "safetensors==0.5.3" "conformer==0.3.2" pyloudnorm
COPY . .
RUN mkdir -p models voices
EXPOSE 8020
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
```

### Verify torch version in the container

```bash
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
# Expected:
# 2.12.0.dev20260408+cu128
# ['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']
```

### Future: Switch to PyTorch 2.7 stable when it ships

When PyTorch 2.7 stable includes sm_120, the Dockerfile can be simplified back to a standard install:
```dockerfile
RUN pip3 install torch torchaudio  # remove --index-url nightly line
```

---

## Chatterbox TTS on Blackwell — Full History

Complete record of everything tried, for reference.

### What was tried and why it failed

**Approach 1 — cu130 nightly:** Same sm_120 error. cu130 nightly as of early April 2026 also only compiled up to sm_90.

**Approach 2 — pip constraints file:** Failed with `ResolutionImpossible`. chatterbox-tts hard-pins `torchaudio==2.6.0` as an exact version pin across all releases 0.1.0–0.1.7. pip cannot satisfy both `torchaudio==2.6.0` (chatterbox) and `torchaudio==2.11.0.dev...+cu128` (nightly) simultaneously. Additionally, `requirements.txt` contains `torch>=2.5.0`, which causes pip to silently downgrade nightly torch to `2.6.0+cu124` from PyPI if chatterbox is installed afterward. The tell-tale sign of this downgrade: `torch.cuda.get_arch_list()` returns `[]`.

**Approach 3 — `--no-deps` + manual deps + nightly cu128:** ✅ **This worked.** PyTorch nightly `2.12.0.dev20260408+cu128` (April 8, 2026) was the first build to ship sm_120 kernels. The `--no-deps` flag bypasses chatterbox's torchaudio pin entirely.

---

## Known Issues and Lessons Learned

### Node.js IPv6 Resolution

Node.js `fetch("http://localhost:...")` resolves to `::1` (IPv6), but Ollama and other services only bind to `127.0.0.1` (IPv4). This causes connections to hang silently with no error.

**Fix:** Always use `127.0.0.1` in `.env`, never `localhost`.

### Browser WebM → WAV Conversion

Browsers record audio as WebM/Opus. Chatterbox requires 24kHz mono WAV. The voice service uses ffmpeg to convert:

```python
subprocess.run([
    "ffmpeg", "-y", "-i", input_path,
    "-ar", "24000", "-ac", "1", "-f", "wav", output_path
])
```

### Docker Compose Ghost Containers

Docker Compose can develop corrupted internal state where it references deleted containers by ID. Symptoms: `docker compose up` fails with "No such container" even after `docker compose down`.

**Workaround:** Use `docker run` directly via the `vox` script.

### Docker Build Cache Surprises

`docker rmi <image>` removes the image tag but does **not** clear the build cache. To force a fresh PyTorch download:

```bash
docker build --no-cache -t voxstation-voice voice-service/
```

### CachyOS Firewall

CachyOS blocks incoming connections by default. Open port 3050 for LAN:

```bash
sudo iptables -I INPUT -p tcp --dport 3050 -j ACCEPT
```

### Next.js Streaming SSE in Production

Next.js production mode can buffer SSE streams. Fix with `TransformStream` plus:

```typescript
export const dynamic = "force-dynamic";

headers: {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
}
```

### Whisper Compute Type

CPU does not support float16. When running Whisper on CPU, set:

```bash
-e VOXSTATION_WHISPER_COMPUTE_TYPE=int8
```

The config auto-detects this when `whisper_compute_type` is left unset.

### HuggingFace 503 Errors

HF Hub has intermittent outages. If model files fail to download at startup, the service crashes with `LocalEntryNotFoundError`. Wait for HF to recover and restart the container. Long-term fix: pre-cache models in a volume and set `HF_HUB_OFFLINE=1`.

### Performance (Full CUDA)

With everything on GPU:
- **Whisper STT (large-v2, CUDA float16):** ~1-3s for a 30s recording
- **Chatterbox TTS (CUDA):** ~5-10s model load (first request), ~2-5s per synthesis
- **Ollama LLM (GPU):** ~1-2s response time

---

## API Endpoints

### Chat

```
POST /api/chat
Body: { messages: [{role, content}], useRAG?: boolean, model?: string }
Returns: text/event-stream (SSE)
  data: {"content": "chunk"}
  data: [DONE]
```

### Voice

```
POST /api/voice/transcribe
Body: FormData with "audio" file
Returns: { text, language, duration }

POST /api/voice/synthesize
Body: { text, voice_id }
Returns: audio/wav binary

POST /api/voice/clone
Body: FormData with "audio" file, "voice_id", optional "name"
Returns: { id, name, sample_saved, total_samples }

GET /api/voice/voices
Returns: [{ id, name, sample_count, samples }]

POST /api/voice/pipeline
Body: FormData with "audio" file, optional "voice_id"
Returns: { transcription, response, audioUrl }
```

### Voice Service Direct (port 8020)

```
GET  /health              → { status, models, voices, gpu }
POST /transcribe          → { text, language, duration, segments }
POST /synthesize          → audio/wav binary
GET  /voices              → [{ id, name, sample_count }]
POST /voices/clone        → { id, name, sample_saved }
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | Next.js + React | 15.5 + 19 |
| Styling | Tailwind CSS | 4.0 |
| LLM | Ollama (nemotron-3-nano:30b) | Latest |
| STT | faster-whisper (CTranslate2) | 1.1+ |
| TTS | Chatterbox (Resemble AI) | 0.1+ |
| PyTorch | Nightly cu128 (sm_120 support) | 2.12.0.dev20260408+ |
| RAG | Qdrant + nomic-embed-text | Latest |
| Voice Service | FastAPI + Uvicorn | 0.115+ |
| Container | Docker (nvidia/cuda:12.8.0-runtime-ubuntu22.04) | — |
| OS | CachyOS (Arch Linux) | — |

---

## Development

```bash
# Dev mode with hot reload
npm run dev

# Full rebuild of voice service after code changes
vox stop
docker rm voxstation_voice
docker rmi voxstation-voice
docker build -t voxstation-voice voice-service/
vox start
vox logs voice

# Quick restart (vox script changes only)
vox stop
sudo cp ~/VoxStation/vox /usr/local/bin/vox
vox start

# Verify torch/CUDA inside the container
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"

# Check voice service health
curl http://127.0.0.1:8020/health

# Test Ollama directly
curl http://127.0.0.1:11434/api/chat -d \
  '{"model":"nemotron-3-nano:30b","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

---

## License

Private — John Finley Productions

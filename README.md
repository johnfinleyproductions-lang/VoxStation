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
│  :30b on GPU     │   │  └─ Chatterbox TTS → CPU (see below) │
│                  │   │     (Blackwell sm_120 blocker)        │
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
| Voice service | 8020 | Framestation | Docker container |
| Ollama | 11434 | Framestation | LLM inference on GPU |
| Qdrant | 6333 | Framestation | Vector search for RAG |

---

## The `vox` Script

VoxStation is managed by a single shell script (`vox`) that handles starting, stopping, and managing all services. It is the **only way** you should start VoxStation.

```bash
vox start     # Start all services (locks GPU clocks first)
vox stop      # Stop all containers
vox restart   # Stop + start
vox logs      # Tail all logs
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

To enable GPU passthrough into Docker containers, the NVIDIA Container Toolkit must be installed and configured. This is **required** for Whisper STT to run on CUDA.

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
# Check if --gpus all is actually applied to the container
docker inspect voxstation_voice | grep -A 20 DeviceRequests
```

If `DeviceRequests` is `null`, the container was started without GPU — this means either the system `/usr/local/bin/vox` is stale (see above), or the toolkit config is wrong.

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
Loading Chatterbox TTS on cpu...
Chatterbox TTS loaded on cpu
Application startup complete.
```

> Note: `cpu` for Chatterbox TTS is correct and expected until PyTorch ships Blackwell (sm_120) support. See the Blackwell TTS section below.

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

If something looks wrong but you just changed the vox script (not the Dockerfile or Python), skip the `docker rmi` and `docker build` steps — just `vox stop`, copy the script, `vox start`.

---

## Blackwell GPU Status (sm_120) — April 2026

This section documents the full picture of GPU support on the RTX PRO 4500, what works, what doesn't, and everything that has been tried.

### What WORKS on CUDA ✅

| Component | Status | Notes |
|---|---|---|
| Docker GPU passthrough (`--gpus all`) | ✅ Working | Requires NVIDIA Container Toolkit + `no-cgroups = false` |
| GPU clocks locked at 1933 MHz via OCuLink | ✅ Working | `nvidia-smi -lgc 1933,1933` in vox script |
| Ollama (nemotron-3-nano:30b) | ✅ Working | Uses llama.cpp — has its own CUDA kernel path |
| **Whisper large-v2 on CUDA (float16)** | ✅ Working | CTranslate2 natively supports sm_120 |

### What DOESN'T work yet ❌

| Component | Status | Error |
|---|---|---|
| **Chatterbox TTS on CUDA** | ❌ Blocked | `RuntimeError: CUDA error: no kernel image is available for execution on the device` |

**Root cause:** Chatterbox TTS uses PyTorch. PyTorch's pre-built pip wheels (including all cu128 and cu130 nightly builds as of April 2026) do not include compiled kernels for sm_120 (Blackwell). The error message is explicit: `The current PyTorch install supports CUDA capabilities sm_50 sm_60 sm_70 sm_75 sm_80 sm_86 sm_90` — sm_120 is absent.

### Current Workaround

Whisper STT runs on CUDA. Chatterbox TTS runs on CPU. Everything works — TTS is just slower.

The `vox` script sets:
```bash
VOXSTATION_WHISPER_DEVICE=cuda
VOXSTATION_XTTS_DEVICE=cpu
```

---

## Chatterbox TTS on Blackwell — Everything We Tried

This section is a complete record of every approach attempted to get Chatterbox TTS running on CUDA on the RTX PRO 4500 (sm_120). Documented here so the next session doesn't repeat dead ends.

### Approach 1: cu130 nightly instead of cu128

**Hypothesis:** cu130 nightly might include sm_120 kernels before cu128 does.

**Dockerfile change:**
```dockerfile
FROM nvidia/cuda:13.2.0-runtime-ubuntu22.04
RUN pip3 install torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu130
```

**Result:** ❌ Same sm_120 error. cu130 nightly as of April 2026 also only compiles up to sm_90.

---

### Approach 2: Constraints file to pin nightly torch while installing chatterbox

**Hypothesis:** Use pip's `-c constraints.txt` to force the nightly torch version even when chatterbox pulls in torchaudio as a dep.

**The real problem discovered here:** `chatterbox-tts` versions 0.1.0 through 0.1.7 ALL hard-pin `torchaudio==2.6.0` in their package metadata. This is not a loose `>=` constraint — it is an exact version pin. When you install chatterbox, pip's dependency resolver sees:
- User wants: `torchaudio==2.11.0.dev20260407+cu128`
- chatterbox-tts 0.1.7 requires: `torchaudio==2.6.0`
- Result: `ResolutionImpossible`

The constraints file approach fails with:
```
ResolutionImpossible: chatterbox-tts 0.1.7 depends on torchaudio==2.6.0, user requested torchaudio==2.11.0.dev20260407+cu128
```

Additionally, if you install nightly torch first and then install chatterbox normally, pip **overwrites** the nightly with `torch==2.6.0+cu124` from PyPI because requirements.txt contains `torch>=2.5.0`. You can verify what torch is actually installed in the container with:
```bash
docker run --rm voxstation-voice python3 -c "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```
If this prints `2.6.0+cu124` and `[]` for arch list, pip silently downgraded you back to stable.

**Result:** ❌ ResolutionImpossible.

---

### Approach 3: Install chatterbox with `--no-deps`, manually supply runtime deps

**Hypothesis:** Bypass chatterbox's torchaudio pin entirely by installing it without dependency resolution, then manually install everything chatterbox actually needs at runtime.

**Dockerfile (current state as of last commit):**
```dockerfile
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04
WORKDIR /app
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip3 install --no-cache-dir packaging
# Step 1: Install nightly PyTorch FIRST (before anything else touches torch)
RUN pip3 install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128
# Step 2: Install all other deps EXCEPT torch/torchaudio/chatterbox
RUN grep -vE '^torch|^torchaudio|^chatterbox' requirements.txt > /tmp/reqs_base.txt && \
    pip3 install --no-cache-dir -r /tmp/reqs_base.txt
# Step 3: Install chatterbox WITHOUT deps (bypasses the torchaudio==2.6.0 hard pin)
RUN pip3 install --no-cache-dir --no-deps chatterbox-tts
# Step 4: Manually supply chatterbox's actual runtime dependencies
RUN pip3 install --no-cache-dir \
    "resemble-perth>=1.0.0" "pykakasi==2.3.0" "diffusers==0.29.0" \
    omegaconf "librosa==0.11.0" s3tokenizer spacy-pkuseg \
    "transformers==5.2.0" "safetensors==0.5.3" "conformer==0.3.2" pyloudnorm
COPY . .
RUN mkdir -p models voices
EXPOSE 8020
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
```

**What happened:** The image built successfully. The container started and began loading Chatterbox TTS on CUDA. However, HuggingFace Hub returned HTTP 503 for `ve.safetensors` (the voice encoder model file) — a transient HF outage. After 5 retries the service threw `LocalEntryNotFoundError` and crashed. The models were not cached in this fresh image build.

**Status: ⚠️ UNVERIFIED** — This approach was interrupted by HF being down before we could see if the sm_120 kernel error still occurs. The nightly torch **was** correctly installed (the `--no-deps` method bypasses the pin). Whether the nightly torch actually resolves the sm_120 error has not been confirmed in a clean run.

---

### Next Steps for Chatterbox CUDA (in priority order)

#### Option A: Re-test the `--no-deps` approach when HuggingFace is up ← DO THIS FIRST

The current Dockerfile (commit d4367be) already implements this. Just rebuild fresh and confirm:

```bash
# Verify nightly torch is actually installed
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

**If you see `2.11.0.dev...+cu128` and `['sm_50', ..., 'sm_90']`** — nightly is in place. If TTS still hits sm_120 error, the nightly doesn't have Blackwell yet and we need to wait for PyTorch 2.7.

**If you see `2.6.0+cu124`** — pip downgraded again. The filtering in the Dockerfile needs more coverage.

Pre-cache the models before running to avoid HF 503 issues:
```bash
# Inside a running container, pre-download all models
docker exec voxstation_voice python3 -c "
from chatterbox.tts import ChatterboxTTS
model = ChatterboxTTS.from_pretrained('cpu')
print('Models cached successfully')
"
```

Or set `HF_HUB_OFFLINE=1` and pre-bake models into the image.

#### Option B: Check monthly if PyTorch 2.7 stable adds sm_120

PyTorch is expected to add Blackwell (sm_120) in PyTorch 2.7. Once it ships:
1. Switch the Dockerfile back to standard torch install
2. Change `VOXSTATION_XTTS_DEVICE=cpu` → `cuda` in the vox script

#### Option C: Try `cu130` nightly with `--no-deps`

Combine the `--no-deps` approach with a cu130 nightly. Host driver 13.2 supports cu130 inside containers:
```dockerfile
FROM nvidia/cuda:13.2.0-runtime-ubuntu22.04
RUN pip3 install torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu130
```

#### Option D: Replace Chatterbox with a Blackwell-safe TTS model

If PyTorch sm_120 support takes too long, replace Chatterbox with a model that uses CTranslate2 or ONNX — both fully support Blackwell:
- **Kokoro** — fast, high quality, CTranslate2 backend
- **StyleTTS2** — excellent quality, can run on CTranslate2

#### Option E: Build PyTorch from source for sm_120

This is the nuclear option. Takes ~4-8 hours on a powerful machine but produces a PyTorch wheel with sm_120 compiled in:
```bash
export TORCH_CUDA_ARCH_LIST="8.0;8.6;9.0;12.0"
python setup.py bdist_wheel
```

---

## Known Issues and Lessons Learned

### Node.js IPv6 Resolution

Node.js `fetch("http://localhost:...")` resolves to `::1` (IPv6), but Ollama and other services only bind to `127.0.0.1` (IPv4). This causes connections to hang silently with no error.

**Fix:** Always use `127.0.0.1` in `.env`, never `localhost`.

### Browser WebM → WAV Conversion

Browsers record audio as WebM/Opus format. Chatterbox requires 24kHz mono WAV. The voice service uses ffmpeg to convert:

```python
subprocess.run([
    "ffmpeg", "-y", "-i", input_path,
    "-ar", "24000", "-ac", "1", "-f", "wav", output_path
])
```

ffmpeg is installed in the Docker image for this purpose.

### Docker Compose Ghost Containers

Docker Compose can develop corrupted internal state where it references deleted containers by ID. Symptoms: `docker compose up` fails with "No such container" errors even after `docker compose down`.

**Workaround:** Use `docker run` directly via the `vox` script instead of `docker compose up`.

### Docker Build Cache Surprises

`docker rmi <image>` removes the image tag but **does NOT clear the build cache**. If you want to force a completely fresh install (e.g., to pull a newer nightly PyTorch), you must use `--no-cache`:

```bash
docker build --no-cache -t voxstation-voice voice-service/
```

Without `--no-cache`, pip install layers are served from cache and you may be running old torch versions without knowing it.

### CachyOS Firewall

CachyOS (Arch-based) blocks incoming connections by default. Open port 3050 for LAN access:

```bash
sudo iptables -I INPUT -p tcp --dport 3050 -j ACCEPT
```

### Next.js Streaming SSE in Production

Next.js production mode (`next start`) can buffer streaming responses when using nested `ReadableStream` objects. The fix uses `TransformStream` with an async background writer, plus these response headers:

```typescript
export const dynamic = "force-dynamic";

headers: {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
}
```

### Whisper Compute Type

CPU does not support float16 compute. When running Whisper on CPU, use `int8`:

```bash
-e VOXSTATION_WHISPER_COMPUTE_TYPE=int8
```

The config auto-detects this when `whisper_compute_type` is left unset.

### HuggingFace 503 Errors

HuggingFace Hub has intermittent outages. If model files fail to download with 503 errors at startup, the service crashes with `LocalEntryNotFoundError`. 

**Short-term fix:** Wait for HF to recover and restart the container.

**Long-term fix:** Pre-cache all models by running a download pass once, then mount the cache as a volume and set `HF_HUB_OFFLINE=1`. Models are stored in `~/.cache/huggingface/` inside the container.

### Performance on CPU (TTS)

With Chatterbox TTS on CPU:
- **Whisper STT (large-v2 on CUDA):** ~1-3s for a 30s recording
- **Chatterbox TTS (on CPU):** ~46s model load (first request), ~10-20s per synthesis
- **Ollama LLM (on GPU):** ~1-2s response time

TTS is the bottleneck. Once Blackwell CUDA support arrives in PyTorch, TTS inference should drop to ~1-3s.

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

# Quick restart (vox script changes only, no Dockerfile changes)
vox stop
sudo cp ~/VoxStation/vox /usr/local/bin/vox
vox start

# Check voice service health
curl http://127.0.0.1:8020/health

# Test Ollama directly
curl http://127.0.0.1:11434/api/chat -d \
  '{"model":"nemotron-3-nano:30b","messages":[{"role":"user","content":"hi"}],"stream":false}'

# View voice service logs
vox logs voice

# Verify what torch version is actually inside the container
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

---

## License

Private — John Finley Productions

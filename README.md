# VoxStation

Voice-enabled AI chat system running entirely on local hardware. Speak to your AI, get responses in your own cloned voice.

**Pipeline:** Speak → Whisper STT → Ollama LLM + Qdrant RAG → Chatterbox TTS (cloned voice) → Audio playback

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Mac)  http://192.168.4.176:3050                   │
└───────┬──────────────────┬──────────────────┬───────────────┘
        ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────┐
│  Next.js Frontend (port 3050)                              │
│  /api/chat → Ollama + RAG → SSE stream                     │
│  /api/voice/* → Voice Service proxy                        │
└────────┬──────────────────────────┬────────────────────────┘
         ▼                          ▼
┌──────────────────┐   ┌────────────────────────────────────┐
│  Ollama (11434)  │   │  Voice Service Docker (8020)       │
│  llama3.2:3b     │   │  ├─ Whisper STT → CUDA ✅          │
│  (or larger)     │   │  └─ Chatterbox TTS → CUDA ✅       │
└──────────────────┘   └────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  Qdrant (6333)   │
│  evergreen_kb    │
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

---

## VRAM Budget — Read This First

The RTX PRO 4500 has 31.37 GiB of VRAM. Every service that uses the GPU competes for this pool. Exceeding it causes CUDA OOM errors that silently kill voice synthesis and transcription.

| Service | VRAM Used | Notes |
|---|---|---|
| Whisper large-v2 (CUDA) | ~3.0 GiB | CTranslate2 |
| Chatterbox TTS (CUDA) | ~4.8 GiB | PyTorch nightly |
| **Voice service total** | **~7.8 GiB** | Both loaded at startup |
| llama3.2:3b | ~2.0 GiB | Recommended LLM |
| llama3.2:8b | ~5.5 GiB | Good quality ceiling |
| nemotron-3-nano:30b | ~24.0 GiB | ⚠️ Fills nearly entire GPU |
| nomic-embed-text | ~0.3 GiB | Required for RAG |
| **Safe headroom target** | **~2 GiB free** | Prevents OOM on large inputs |

**Maximum safe LLM with full voice service active: ~19 GiB** (31.37 - 7.8 - 2 headroom - 0.3 embeddings).

### Why CUDA OOM happens silently

When Ollama loads a model, it stays in VRAM for `KEEP_ALIVE` minutes (default: 5) even after the request finishes. If you tried a large model that failed, it may still occupy VRAM. Symptoms: voice synthesis and transcription both return 500, GPU shows near-zero free VRAM, chat still works.

**Diagnose:**
```bash
nvidia-smi --query-gpu=memory.free,memory.used --format=csv
# Check what Ollama has loaded
curl http://127.0.0.1:11434/api/ps
```

**Fix — evict a specific model:**
```bash
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"nemotron-3-nano:30b","keep_alive":0,"prompt":""}'
```

**Fix — nuclear option:**
```bash
vox stop && vox start
# Ollama starts fresh with nothing in VRAM
```

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

```bash
vox start     # Lock GPU clocks, start all services
vox stop      # Stop everything
vox restart   # Stop + start
vox logs voice  # Tail voice service logs
vox status    # Show service health + GPU clock status
```

### ⚠️ CRITICAL: Two Copies of vox

- `~/VoxStation/vox` — git source
- `/usr/local/bin/vox` — **the one that actually runs**

After any `git pull` that changes `vox`:
```bash
sudo cp ~/VoxStation/vox /usr/local/bin/vox
```

Forgetting this means `vox` silently runs old code. This has caused multiple debugging sessions.

---

## Prerequisites — Pull These Before First Run

```bash
# LLM (required)
ollama pull llama3.2:3b

# Embeddings for RAG (required — without this, every chat logs "Embedding generation failed")
ollama pull nomic-embed-text

# Verify both are present
ollama list
```

---

## Quick Start

### 1. Build the voice service image

```bash
cd ~/VoxStation/voice-service
docker build -t voxstation-voice .
```

First build ~10-15 minutes. Subsequent builds use cache (~2 minutes unless Dockerfile changes).

### 2. Start everything

```bash
vox start
vox logs voice   # Watch until you see "Application startup complete"
```

**Expected startup output (voice service):**
```
Loading Whisper large-v2 on cuda (float16)...
Whisper large-v2 loaded on cuda (float16)
Loading Chatterbox TTS on cuda...
Chatterbox TTS loaded on cuda
VoxStation Voice Service ready on port 8020
Application startup complete.
```

### 3. Build and start the frontend

```bash
cd ~/VoxStation
npm run build
npm start
# OR just: vox start (it handles this too)
```

### 4. Open in browser

`http://192.168.4.176:3050`

For microphone access over HTTP, add the IP to Chrome's insecure origins:
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`

### 5. Clone your voice

Go to `/clone`, record 10-30s of clear speech, name it, click Clone.

---

## Full Rebuild After Code Changes

```bash
cd ~/VoxStation && git pull
sudo cp ~/VoxStation/vox /usr/local/bin/vox   # if vox changed

vox stop
docker rm voxstation_voice
docker rmi voxstation-voice   # skip if only Python files changed, not Dockerfile
docker build -t voxstation-voice voice-service/
npm run build                 # if any Next.js files changed
vox start
vox logs voice
```

---

## GPU Setup (NVIDIA Container Toolkit)

```bash
sudo pacman -S nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### CachyOS `no-cgroups` Bug

The default `/etc/nvidia-container-runtime/config.toml` has `no-cgroups = true` on CachyOS, which silently strips GPU access from containers. `docker inspect` shows `DeviceRequests: null`.

**Fix:**
```toml
# /etc/nvidia-container-runtime/config.toml
no-cgroups = false
```
Then `sudo systemctl restart docker`.

### Verify GPU passthrough

```bash
docker run --rm --gpus all nvidia/cuda:12.8.0-runtime-ubuntu22.04 nvidia-smi
docker inspect voxstation_voice | grep -A 5 DeviceRequests
```

---

## Blackwell (sm_120) GPU — Status FULLY SOLVED ✅

| Component | Status |
|---|---|
| Docker GPU passthrough | ✅ NVIDIA Container Toolkit + no-cgroups fix |
| GPU clocks 1933 MHz via OCuLink | ✅ nvidia-smi lock in vox script |
| Ollama LLM | ✅ llama.cpp has its own CUDA path |
| Whisper STT (CTranslate2) | ✅ CTranslate2 natively supports sm_120 |
| Chatterbox TTS (PyTorch) | ✅ Solved April 9 2026 — nightly 2.12.0.dev20260408+cu128 |

**PyTorch arch list confirmed:** `['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']`

**How TTS was solved:** `chatterbox-tts` 0.1.0–0.1.7 hard-pins `torchaudio==2.6.0`, forcing `torch==2.6.0+cu124` (no sm_120). Fix: install chatterbox with `--no-deps` to bypass the pin, install PyTorch nightly cu128 first. Full Dockerfile in `voice-service/Dockerfile`.

---

## Debugging Log

Chronological record of what worked, what broke, and why. Use this to avoid re-investigating solved problems.

---

### Session 1 — April 2026

**Goal:** Get GPU inference working for all VoxStation components on RTX PRO 4500 Blackwell.

#### ✅ SOLVED: Docker GPU passthrough

**Symptom:** `docker inspect voxstation_voice` showed `DeviceRequests: null`. GPU completely invisible inside container despite `--gpus all` in the run command.

**Root cause 1:** `/usr/local/bin/vox` was an old installed copy of the script that predated the `--gpus all` flag. Running `vox` was running old code silently.
**Fix:** `sudo cp ~/VoxStation/vox /usr/local/bin/vox`

**Root cause 2:** `/etc/nvidia-container-runtime/config.toml` had `no-cgroups = true` (CachyOS default). This silently disables GPU passthrough.
**Fix:** Set `no-cgroups = false`, restart Docker.

---

#### ✅ SOLVED: Whisper STT on CUDA

Whisper large-v2 via CTranslate2 works on sm_120 natively. No modifications needed. Loads on `cuda (float16)` cleanly.

---

#### ✅ SOLVED: Chatterbox TTS on CUDA

**Symptom:** `RuntimeError: CUDA error: no kernel image is available for execution on the device`

**Root cause:** PyTorch stable and early nightly builds did not include sm_120 kernels. chatterbox-tts pins `torchaudio==2.6.0` exactly, forcing `torch==2.6.0+cu124` which only goes up to sm_90.

**What failed:**
- cu130 nightly — still no sm_120
- pip constraints file — `ResolutionImpossible` (chatterbox's exact pin defeats constraints)
- Standard install order — pip silently downgrades nightly back to stable

**What worked:** `--no-deps` install of chatterbox + nightly cu128 installed first. PyTorch `2.12.0.dev20260408+cu128` (April 8, 2026) was first build with sm_120.

---

#### ✅ SOLVED: TTS saving audio (TorchCodec error)

**Symptom:** TTS generated audio successfully on CUDA (~100 it/s visible in logs) but crashed on save with: `TorchCodec is required for save_with_torchcodec`.

**Root cause:** PyTorch nightly 2.12.0 changed `torchaudio.save()` default backend to TorchCodec, which is not installed.

**Fix:** Replaced `torchaudio.save()` with `soundfile.write()` in `tts_service.py`. soundfile is already installed.

---

#### ✅ SOLVED: Next.js voice API returning 500

**Symptom:** Direct curl to port 8020 worked. All `/api/voice/*` routes at port 3050 returned 500.

**Root cause 1:** `voice-client.ts` had wrong fallback URL `http://192.168.4.240:8020` (wrong IP). If `VOICE_SERVICE_URL` env var wasn't loaded, all voice calls hit a nonexistent machine.
**Fix:** Changed fallback to `http://127.0.0.1:8020`.

**Root cause 2:** Next.js API routes default to 10s timeout in production. TTS takes 8-40s depending on warm/cold state. Routes were timing out silently.
**Fix:** Added `export const maxDuration = 60` to `/api/voice/synthesize/route.ts` and `/api/voice/clone/route.ts`.

**Root cause 3:** Very long LLM responses sent to TTS caused slow synthesis and degraded audio quality.
**Fix:** Added 500-character truncation at sentence boundary in synthesize route.

---

#### ✅ SOLVED: Ollama model not loading

**Symptom:** `{"error":"llama runner process has terminated: exit status 2"}`

**Root cause 1:** `nemotron-3-nano:30b` download was corrupted. The runner crashed on both GPU and CPU mode.
**Diagnostic:** `ollama pull tinyllama && ollama run tinyllama "hi"` — tinyllama worked, proving the runner itself was fine.
**Fix:** `ollama rm nemotron-mini && ollama pull nemotron-mini` (re-download). Alternatively switch to `llama3.2:3b` which has no known corruption issues.

**Root cause 2:** `nomic-embed-text` was never pulled. Every chat request logged `Embedding generation failed` and continued without RAG context.
**Fix:** `ollama pull nomic-embed-text`

---

#### ⚠️ KNOWN ISSUE: CUDA OOM when large model left in VRAM

**Symptom:** Voice synthesis and transcription both return 500. Frontend log shows `CUDA out of memory`. GPU has <100 MiB free despite voice service only needing ~7.8 GiB.

**Root cause:** A previously attempted large model (e.g. `nemotron-3-nano:30b` at 24 GiB) occupies VRAM even after its runner crashes. Ollama's `KEEP_ALIVE=5m` keeps models loaded. The crashed model never releases VRAM.

**Diagnosis:**
```bash
nvidia-smi --query-gpu=memory.free,memory.used --format=csv
curl http://127.0.0.1:11434/api/ps
```

**Fix — evict without restart:**
```bash
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"nemotron-3-nano:30b","keep_alive":0,"prompt":""}'
```

**Fix — full restart:**
```bash
vox stop && vox start
```

**Prevention:** Stick to models under 19 GiB when voice service is running. `llama3.2:3b` (2 GiB) is the recommended default. `llama3.2:8b` (5.5 GiB) is the quality ceiling with comfortable headroom.

---

## Known Issues and Lessons Learned

### Node.js IPv6 Resolution

`fetch("http://localhost:...")` resolves to `::1` (IPv6). Ollama and other services only bind `127.0.0.1`. Connections hang silently.

**Fix:** Always use `127.0.0.1` in `.env`, never `localhost`.

### Docker Build Cache Hides Stale Packages

`docker rmi` removes the image tag but not the build cache. `pip install` layers serve from cache. You can be running old torch versions without knowing it.

**Fix:** Use `--no-cache` when you need a fresh install:
```bash
docker build --no-cache -t voxstation-voice voice-service/
```

**Verify torch in the container:**
```bash
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

### Docker Compose Ghost Containers

`docker compose up` can fail with "No such container" after `docker compose down`. Corrupted internal state.

**Fix:** Use `docker run` directly via the vox script.

### CachyOS Firewall

Blocks LAN connections by default:
```bash
sudo iptables -I INPUT -p tcp --dport 3050 -j ACCEPT
```

### Whisper CPU Compute Type

CPU does not support float16. Set `VOXSTATION_WHISPER_COMPUTE_TYPE=int8` when running Whisper on CPU. The config auto-detects this.

### HuggingFace 503 Outages

Model downloads fail with `LocalEntryNotFoundError` during HF outages. Restart the container once HF recovers. Long-term: pre-cache models and set `HF_HUB_OFFLINE=1`.

### Coil Whine from GPU

A faint screeching sound from the GPU under varying load is **normal** — electromagnetic vibration from inductors on the PCB. Not harmful.

---

## API Reference

```
POST /api/chat              → SSE stream of LLM response (with RAG)
POST /api/voice/transcribe  → Whisper STT → { text, language, duration }
POST /api/voice/synthesize  → Chatterbox TTS → audio/wav
POST /api/voice/clone       → Save voice sample → { id, name, total_samples }
GET  /api/voice/voices      → List voice profiles
POST /api/voice/pipeline    → Full voice→voice pipeline
```

Direct voice service (port 8020):
```
GET  /health     → { status, models, voices, gpu }
POST /transcribe → { text, language, duration, segments }
POST /synthesize → audio/wav
GET  /voices     → [{ id, name, sample_count }]
POST /voices/clone → { id, name, sample_saved }
```

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 15.5 + React 19 | Tailwind 4.0 |
| LLM | Ollama — llama3.2:3b | ~2 GiB VRAM |
| STT | faster-whisper (CTranslate2) | sm_120 native |
| TTS | Chatterbox (Resemble AI) | sm_120 via nightly PyTorch |
| PyTorch | Nightly cu128 | 2.12.0.dev20260408+ |
| RAG | Qdrant + nomic-embed-text | evergreen_kb collection |
| Voice Service | FastAPI + Uvicorn | Docker, nvidia/cuda:12.8.0-runtime |
| OS | CachyOS (Arch Linux) | nvidia-open-dkms |

---

## Development Commands

```bash
# Full system health check
vox status
curl http://127.0.0.1:8020/health
curl http://127.0.0.1:11434/api/ps          # what's loaded in Ollama VRAM
nvidia-smi --query-gpu=memory.free,memory.used --format=csv

# Test TTS directly (bypasses Next.js)
curl -X POST http://127.0.0.1:8020/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","voice_id":"john"}' \
  --output /tmp/test.wav -w "\nTime: %{time_total}s\n"
aplay -f cd /tmp/test.wav

# Test TTS through Next.js proxy
curl -X POST http://127.0.0.1:3050/api/voice/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","voice_id":"john"}' \
  --output /tmp/test.wav -w "\nHTTP: %{http_code} | Time: %{time_total}s\n"

# View frontend error log
tail -50 ~/VoxStation/.vox-frontend.log

# View voice service logs
vox logs voice

# Evict a model from Ollama VRAM
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"MODEL_NAME","keep_alive":0,"prompt":""}'

# Verify torch inside container
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

---

## License

Private — John Finley Productions

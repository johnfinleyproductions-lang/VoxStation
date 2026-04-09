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

## ⚠️ The Framestation Runs Multiple GPU Services

This machine runs VoxStation alongside other services that **also use the GPU**:

| Service | Port | GPU | Notes |
|---|---|---|---|
| VoxStation Voice | 8020 | ~7.8 GiB | Whisper + Chatterbox |
| Open WebUI (business) | 3000 | Up to 24+ GiB | Can load local models |
| Open WebUI (family) | 3002 | Up to 24+ GiB | Can load local models |
| Evergreen Vault | 5432/9000 | None | Postgres + MinIO |
| n8n | 5678 | None | Automation |
| Qdrant | 6333 | None | Vector DB |

**Before debugging any VoxStation GPU issue, always run:**
```bash
nvidia-smi pmon -c 1 -s m
```
This shows EVERY process using GPU memory on the whole machine. If you see a `python` process holding 20+ GiB that isn't yours, that's your problem — not VoxStation.

---

## VRAM Budget — Read This First

The RTX PRO 4500 has 31.37 GiB of VRAM. Every service that uses the GPU competes for this pool.

| Service | VRAM Used | Notes |
|---|---|---|
| Whisper large-v2 (CUDA) | ~3.0 GiB | CTranslate2 |
| Chatterbox TTS (CUDA) | ~4.8 GiB | PyTorch nightly |
| **Voice service total** | **~7.8 GiB** | Both loaded at startup |
| llama3.2:3b | ~2.0 GiB | ✅ Recommended LLM |
| llama3.2:8b | ~5.5 GiB | Good quality ceiling |
| nemotron-3-nano:30b | ~24.0 GiB | ❌ Never fits alongside voice service |
| nomic-embed-text | ~0.3 GiB | Required for RAG |
| **Safe headroom target** | **~2 GiB free** | Prevents OOM on large inputs |

**Rule:** Model VRAM + 8 GiB (voice) + 2 GiB (headroom) must stay under 31 GiB. Max safe LLM: ~21 GiB.

**`nemotron-3-nano:30b` will never work on this machine with the voice service running.** It's 24 GiB — too large by design.

### VRAM Diagnostic Commands

```bash
# Quick free/used snapshot
nvidia-smi --query-gpu=memory.free,memory.used --format=csv

# ALL processes using GPU on the whole machine (most important command)
nvidia-smi pmon -c 1 -s m

# What Ollama specifically has loaded
curl -sf http://127.0.0.1:11434/api/ps | python3 -c \
  "import sys,json; [print(m['name'], round(m.get('size_vram',0)/1e9,2),'GB') for m in json.load(sys.stdin).get('models',[])] or print('nothing loaded')"

# Evict a specific model from Ollama VRAM
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"MODEL_NAME","keep_alive":0,"prompt":""}'

# Kill an external process holding VRAM
sudo kill -9 <PID>   # get PID from nvidia-smi pmon
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

Forgetting this means `vox` silently runs old code.

---

## Prerequisites — Do This Before First Run

```bash
# 1. LLM (required)
ollama pull llama3.2:3b

# 2. Embeddings for RAG (required — without this, every chat logs "Embedding generation failed" silently)
ollama pull nomic-embed-text

# 3. Create .env.local (required — without it, chat defaults to nemotron-3-nano:30b which causes OOM)
echo "OLLAMA_MODEL=llama3.2:3b" > ~/VoxStation/.env.local

# 4. Verify
ollama list
cat ~/VoxStation/.env.local
```

---

## Route Timeout Reference

Every API route that calls a model **must** have `export const maxDuration`. Next.js defaults to 10 seconds in production — not enough for any model inference.

| Route | maxDuration | Why |
|---|---|---|
| `app/api/chat/route.ts` | 120 | LLM first-load can take 10-30s |
| `app/api/voice/synthesize/route.ts` | 60 | TTS takes 1-40s depending on text |
| `app/api/voice/clone/route.ts` | 60 | Upload + ffmpeg conversion |
| `app/api/transcribe/route.ts` | 60 | Whisper on long audio |

If chat or voice returns a 500 after almost exactly 10 seconds, the route is missing `maxDuration`.

---

## Quick Start

### 1. Build the voice service image

```bash
cd ~/VoxStation/voice-service
docker build -t voxstation-voice .
```

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
Application startup complete.
```

### 3. Open in browser

`http://192.168.4.176:3050`

For microphone access over HTTP, add to Chrome's insecure origins:
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`

### 4. Clone your voice

Go to `/clone`, record 10-30s of clear speech, name it, click Clone.

---

## Full Rebuild After Code Changes

```bash
cd ~/VoxStation && git pull
sudo cp ~/VoxStation/vox /usr/local/bin/vox   # if vox changed

vox stop
docker rm voxstation_voice
docker rmi voxstation-voice   # skip if only Python files changed
docker build -t voxstation-voice voice-service/
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

Default `/etc/nvidia-container-runtime/config.toml` has `no-cgroups = true` on CachyOS — silently strips GPU from containers.

```toml
# /etc/nvidia-container-runtime/config.toml
no-cgroups = false
```
Then `sudo systemctl restart docker`.

---

## Blackwell (sm_120) — FULLY SOLVED ✅

| Component | Status |
|---|---|
| Docker GPU passthrough | ✅ |
| GPU clocks 1933 MHz via OCuLink | ✅ |
| Ollama LLM inference | ✅ |
| Whisper STT (CTranslate2) | ✅ Native sm_120 |
| Chatterbox TTS (PyTorch) | ✅ Nightly 2.12.0.dev20260408+cu128 |

**PyTorch arch list confirmed:** `['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']`

**How TTS was solved:** `chatterbox-tts` hard-pins `torchaudio==2.6.0`, forcing `torch==2.6.0+cu124` (no sm_120). Fix: install with `--no-deps` to bypass the pin, with PyTorch nightly cu128 installed first.

---

## Debugging Log

Chronological record of every issue, its root cause, and fix. Read this before re-investigating anything.

---

### Session 1 — April 7-8, 2026

#### ✅ SOLVED: Docker GPU passthrough

**Symptom:** `docker inspect voxstation_voice` showed `DeviceRequests: null`. GPU invisible inside container.

**Root cause 1:** `/usr/local/bin/vox` was an old copy without `--gpus all`. Running `vox` ran old code silently.
**Fix:** `sudo cp ~/VoxStation/vox /usr/local/bin/vox`

**Root cause 2:** `no-cgroups = true` in CachyOS container toolkit config silently disables GPU passthrough.
**Fix:** Set `no-cgroups = false`, restart Docker.

---

#### ✅ SOLVED: Chatterbox TTS on Blackwell CUDA

**Symptom:** `RuntimeError: CUDA error: no kernel image is available for execution on the device`

**Root cause:** chatterbox-tts pins `torchaudio==2.6.0` exactly, forcing `torch==2.6.0+cu124` which has no sm_120 kernels. PyTorch nightly `2.12.0.dev20260408+cu128` was first build with sm_120.

**Fix:** Install chatterbox with `--no-deps`, install PyTorch nightly cu128 first in Dockerfile.

**Key learning:** Docker build cache serves stale pip layers silently. Always use `--no-cache` when changing PyTorch versions.

---

#### ✅ SOLVED: TTS crashes on save (TorchCodec)

**Symptom:** TTS generated audio successfully on CUDA (~100 it/s) then crashed: `TorchCodec is required for save_with_torchcodec`.

**Root cause:** PyTorch nightly 2.12.0 changed `torchaudio.save()` default backend to TorchCodec (not installed).

**Fix:** Replaced `torchaudio.save()` with `soundfile.write()` in `tts_service.py`.
```python
# Before (crashes):
torchaudio.save(buffer, wav_tensor.cpu(), self.model.sr, format="wav")
# After (works always):
import soundfile as sf
wav_numpy = wav_tensor.cpu().squeeze().numpy()
sf.write(buffer, wav_numpy, self.model.sr, format="WAV", subtype="PCM_16")
```

---

#### ✅ SOLVED: All /api/voice/* routes returned 500

**Symptom:** Direct curl to port 8020 worked. Every Next.js voice route returned 500.

**Root cause 1:** `voice-client.ts` fallback URL was `http://192.168.4.240:8020` (wrong IP). `VOICE_SERVICE_URL` env var wasn't loading, routing all calls to a nonexistent machine.
**Fix:** Changed fallback to `http://127.0.0.1:8020`.

**Root cause 2:** No `maxDuration` on synthesize/clone routes. Next.js killed them at 10s default. TTS takes 8-40s.
**Fix:** Added `export const maxDuration = 60` to both routes.

**Key learning:** Never use `localhost` — use `127.0.0.1`. Node.js resolves `localhost` to `::1` (IPv6); most services only bind `127.0.0.1`.

---

#### ✅ SOLVED: Ollama model corruption

**Symptom:** `exit status 2` when loading nemotron-mini. Appeared on both GPU and CPU.

**Diagnostic:** `ollama run tinyllama "hi"` — tinyllama worked, proving runner was fine. Model download was corrupted.

**Fix:** `ollama rm nemotron-mini && ollama pull nemotron-mini` OR switch to `llama3.2:3b`.

**Key learning:** When Ollama fails, always test tinyllama first. If tinyllama works, the runner is healthy — the model file is the problem.

---

#### ✅ SOLVED: CUDA OOM from nemotron-3-nano:30b stuck in VRAM

**Symptom:** TTS and transcribe returned 500. GPU showed ~15 MiB free. Voice service never loaded.

**Root cause:** nemotron-3-nano:30b (24 GiB) left in VRAM by a failed load attempt. Ollama's KEEP_ALIVE held it. Voice service needs 7.8 GiB — no room.

**Fix:**
```bash
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"nemotron-3-nano:30b","keep_alive":0,"prompt":""}'
```

---

#### ✅ SOLVED: RAG silently disabled

**Symptom:** Every chat logged `Embedding generation failed` but returned a response. RAG context was always empty.

**Root cause:** `nomic-embed-text` was never pulled.

**Fix:** `ollama pull nomic-embed-text`

**Key learning:** Add `nomic-embed-text` to setup prerequisites. The app should surface this as a visible warning, not a silent log.

---

### Session 2 — April 9, 2026

**Starting state:** TTS confirmed working at service level (0.921s, valid WAV). Chat returning 500. Voice API routes returning 500. Goal: get end-to-end working.

---

#### ✅ SOLVED: Chat route missing maxDuration

**Symptom:** Chat returned "Sorry, something went wrong" after exactly ~10 seconds every time.

**Root cause:** `app/api/chat/route.ts` had no `export const maxDuration`. Same class of bug that killed synthesize/clone in Session 1, just missed during that fix.

**Fix:**
```bash
sed -i '1s/^/export const maxDuration = 120;\n/' ~/VoxStation/app/api/chat/route.ts
```

**Key learning:** Every single route that touches a model needs maxDuration. Make it a checklist item after adding any new API route.

---

#### ✅ SOLVED: .env.local missing — chat defaulted to nemotron-3-nano:30b

**Symptom:** After fixing maxDuration, chat still failed with `llama runner process has terminated: exit status 2`.

**Root cause:** `.env.local` didn't exist on this machine. `chat/route.ts` line 6:
```typescript
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "nemotron-3-nano:30b";
```
With no `.env.local`, every chat attempt tried to load the 24 GiB model — immediate OOM.

**Fix:**
```bash
echo "OLLAMA_MODEL=llama3.2:3b" > ~/VoxStation/.env.local
vox stop && vox start
```

**Key learning:** The hardcoded fallback `|| "nemotron-3-nano:30b"` is a trap. It should be changed to `|| "llama3.2:3b"` in the source so a missing `.env.local` doesn't cause OOM. Also: always verify `.env.local` exists as a setup step.

---

#### ✅ SOLVED: External Python process holding 23 GiB VRAM — the real OOM culprit

**Symptom:** After `vox stop`, `docker rm voxstation_voice`, `sudo pkill -9 ollama` — VRAM still showed 23,160 MiB used. `ollama run llama3.2:3b` failed with exit status 2 even though it only needs 2 GiB.

**Diagnosis:**
```bash
nvidia-smi pmon -c 1 -s m
# Output:
# gpu   pid   type   fb    command
#   0   360938   C   23150   python
```
A Python process (PID 360938) outside VoxStation was holding 23 GiB. Identified as likely **Open WebUI** (`webui_business` or `webui_family` container on :3000/:3002) running a local model.

**Fix:**
```bash
sudo kill -9 360938
nvidia-smi --query-gpu=memory.free,memory.used --format=csv
# → 23+ GiB freed immediately
vox start
ollama run llama3.2:3b "say hello"  # works
```

**Key lesson — most important one in this log:**
`nvidia-smi pmon -c 1 -s m` shows every process using GPU memory on the whole machine. When VRAM looks full after killing all your own services, run this command first. Don't restart VoxStation repeatedly — find the external process.

**Permanent fix:** Stop competing GPU services before running VoxStation:
```bash
docker stop webui_business webui_family
vox start
```
Or configure Open WebUI instances to not use local GPU models.

---

#### ✅ SOLVED: llama3.2:3b not pulled

**Symptom:** After fixing .env.local, chat failed with `model 'llama3.2:3b' not found`.

**Root cause:** The model was referenced but never downloaded.

**Fix:** `ollama pull llama3.2:3b` (~2 GB, ~3 minutes)

---

#### ✅ CONFIRMED WORKING: End-to-end chat — April 9, 2026

With external process killed, llama3.2:3b pulled, .env.local set, and maxDuration added:
- Chat API responds correctly ✅
- TTS synthesizes at 0.921s via curl ✅  
- John voice profile with 4 samples exists ✅
- nomic-embed-text loaded for RAG ✅

---

#### ⚠️ IN PROGRESS: Voice audio not playing in browser

**Symptom:** TTS confirmed working at service level. Browser receives audio bytes but nothing plays.

**Likely cause:** Browser autoplay policy. Chrome blocks `audio.play()` called outside a user gesture. Error: `NotAllowedError: play() failed because the user didn't interact with the document first` — appears silently in DevTools console, not in the app UI.

**Fix options:**
1. Add a speaker button (🔊) per assistant message — play() inside click handler is always allowed
2. Queue audio, flush on next user click/keypress

**Test in DevTools console:**
```javascript
new Audio().play().then(() => console.log('autoplay OK')).catch(e => console.log('BLOCKED:', e.message))
```

---

## Known Issues and Lessons Learned

### The VRAM Check Order of Operations

When anything GPU-related breaks, check in this exact order:
1. `nvidia-smi pmon -c 1 -s m` — is something external eating VRAM?
2. `nvidia-smi --query-gpu=memory.free,memory.used --format=csv` — how much is free?
3. `curl -sf http://127.0.0.1:11434/api/ps` — what does Ollama have loaded?
4. `docker logs voxstation_voice --tail 30` — what is the voice service saying?

Skipping step 1 has cost multiple debugging sessions.

### pnpm Not in PATH via SSH

`pnpm` is installed but not in the PATH of non-interactive SSH shells. `pnpm build` will fail. `vox start` runs Next.js from the pre-built `.next` directory — changes to `.env.local` and API routes take effect on `vox stop && vox start` without a full rebuild in many cases.

To find pnpm for a manual rebuild:
```bash
find / -name pnpm -type f 2>/dev/null | grep -v proc | head -5
```

### Node.js IPv6 Resolution

`fetch("http://localhost:...")` resolves to `::1` (IPv6). Use `127.0.0.1` in `.env` and all hardcoded URLs.

### Docker Build Cache Hides Stale Packages

`docker rmi` removes the image tag but not the build cache. Use `--no-cache` when changing PyTorch versions:
```bash
docker build --no-cache -t voxstation-voice voice-service/
```

### Verify torch inside the container:
```bash
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

### Coil Whine from GPU

Faint screeching under varying load is normal — electromagnetic vibration from PCB inductors. Not harmful.

### HuggingFace 503 Outages

Model downloads fail with `LocalEntryNotFoundError` during HF outages. Restart container once HF recovers.

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
# Full VRAM picture — run this first when anything breaks
nvidia-smi pmon -c 1 -s m
nvidia-smi --query-gpu=memory.free,memory.used --format=csv

# What Ollama has loaded in VRAM
curl -sf http://127.0.0.1:11434/api/ps | python3 -c \
  "import sys,json; [print(m['name'], round(m.get('size_vram',0)/1e9,2),'GB') for m in json.load(sys.stdin).get('models',[])] or print('nothing loaded')"

# Evict a model from Ollama VRAM immediately
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"MODEL_NAME","keep_alive":0,"prompt":""}'

# Kill an external VRAM hog
sudo kill -9 <PID>   # get PID from nvidia-smi pmon

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

# Voice service health
curl http://127.0.0.1:8020/health

# View logs
vox logs voice
tail -50 ~/VoxStation/.vox-frontend.log

# Verify torch inside container
docker run --rm --gpus all voxstation-voice python3 -c \
  "import torch; print(torch.__version__); print(torch.cuda.get_arch_list())"
```

---

## License

Private — John Finley Productions

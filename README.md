# VoxStation

Voice-enabled AI chat system running entirely on local hardware. Speak to your AI, get responses in your own cloned voice.

**Pipeline:** Speak → Whisper STT → Ollama LLM + Qdrant RAG → Chatterbox TTS (cloned voice, streaming) → Audio playback

> **Starting a new session?** Read `SESSION_BRIEF.md` first, then refer to `ARCHITECTURE.md` for system details. These two files give Claude (or any developer) full context without re-investigating anything.

---

## Architecture

See `ARCHITECTURE.md` for the full system diagram, data flows, file structure, and implementation details.

Quick overview:
```
Browser → Next.js :3050 → Ollama :11434 (LLM)
                         → Voice Service Docker :8020 (Whisper STT + Chatterbox TTS)
                         → Qdrant :6333 (RAG)
```

**Standalone TTS:** `http://192.168.4.176:3050/tts.html` — bookmark this. Uses your cloned voice for any text, sentence-by-sentence streaming playback.

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

This machine runs VoxStation alongside Open WebUI, Evergreen Vault, and n8n. Open WebUI on ports `:3000` and `:3002` can hold 20+ GiB of VRAM when a local model is loaded.

**Before debugging any GPU issue, always run first:**
```bash
nvidia-smi pmon -c 1 -s m   # shows every process using VRAM on the whole machine
```
If you see a `python` PID holding 20+ GiB that isn't VoxStation: `sudo kill -9 <PID>`

---

## VRAM Budget

| Service | VRAM | Notes |
|---|---|---|
| Whisper large-v2 (CUDA) | ~3.0 GiB | Always loaded |
| Chatterbox TTS (CUDA) | ~4.8 GiB | Always loaded |
| **Voice service total** | **~7.8 GiB** | |
| llama3.2:3b | ~2.0 GiB | ✅ Recommended |
| llama3.1:8b | ~5.5 GiB | Good quality ceiling |
| nemotron-3-nano:30b | ~24.0 GiB | ❌ Never fits alongside voice service |
| nomic-embed-text | ~0.3 GiB | Required for RAG |

**Rule:** Model VRAM + 8 GiB (voice) must stay under 31 GiB.

---

## Prerequisites — Do This Before First Run

```bash
# Pull required Ollama models
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# Create .env.local (not in git)
echo "OLLAMA_MODEL=llama3.2:3b" > ~/VoxStation/.env.local
```

---

## The `vox` Script

```bash
vox start     # Lock GPU clocks, start all services
vox stop      # Stop everything
vox logs voice  # Tail voice service logs
vox status    # Service health + GPU status
```

### ⚠️ CRITICAL: Two Copies
- `~/VoxStation/vox` — git source
- `/usr/local/bin/vox` — **what actually runs**

After any `git pull` that changes `vox`:
```bash
sudo cp ~/VoxStation/vox /usr/local/bin/vox
```

---

## Route Timeout Reference

Every API route that touches a model **must** have `export const maxDuration`. Default is 10 seconds — not enough for any inference.

| Route | maxDuration | Why |
|---|---|---|
| `app/api/chat/route.ts` | 120 | LLM first-load can take 10-30s |
| `app/api/voice/synthesize/route.ts` | 60 | TTS takes 1-40s |
| `app/api/voice/clone/route.ts` | 60 | Upload + ffmpeg conversion |
| `app/api/voice/transcribe/route.ts` | 60 | Whisper on long audio |

If a route returns 500 after exactly 10 seconds: it's missing `maxDuration`.

---

## Streaming TTS

TTS is sentence-by-sentence, starting as soon as the first sentence of the LLM response is complete.

**How it works:**
1. `StreamingTTS` is created synchronously in the click handler — creates `AudioContext` immediately (satisfies browser autoplay policy)
2. `extractCompleteSentences()` watches the LLM SSE token stream for complete sentences
3. Each complete sentence fires a TTS fetch immediately
4. Web Audio API schedules each audio buffer to play seamlessly after the previous one
5. Result: first audio plays ~1s after the LLM starts, not 10-40s after it finishes

**Key files:**
- `lib/voice/streaming-tts.ts` — `StreamingTTS` class + `extractCompleteSentences`
- `app/page.tsx` — integration in `sendMessage()`

---

## Standalone TTS Page

Available at `http://192.168.4.176:3050/tts.html` — bookmark it.

- Loads your cloned voices automatically
- Type or paste any text, click Speak
- Sentence-by-sentence playback with progress indicator
- `⌘ Enter` or `Ctrl+Enter` to speak, `Esc` to stop
- Works from any browser on your LAN, no login required
- Source: `public/tts.html` (static file served by Next.js)

---

## Quick Start

```bash
# 1. Clone and set up
git clone https://github.com/johnfinleyproductions-lang/VoxStation.git ~/VoxStation
cd ~/VoxStation

# 2. Create required env file
echo "OLLAMA_MODEL=llama3.2:3b" > .env.local

# 3. Pull required models
ollama pull llama3.2:3b && ollama pull nomic-embed-text

# 4. Build voice service
docker build -t voxstation-voice ./voice-service

# 5. Start everything
vox start && vox logs voice
# Wait for: "Application startup complete."

# 6. Open browser
open http://192.168.4.176:3050
```

---

## Deploy After Code Changes

```bash
cd ~/VoxStation && git pull
sudo cp ~/VoxStation/vox /usr/local/bin/vox   # if vox changed

# For Next.js / TypeScript changes (no Docker rebuild needed):
vox stop && vox start

# For voice-service/ Python or Dockerfile changes:
vox stop
docker rm voxstation_voice && docker rmi voxstation-voice
docker build --no-cache -t voxstation-voice voice-service/
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

Default `/etc/nvidia-container-runtime/config.toml` has `no-cgroups = true` — silently strips GPU from containers.

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

---

## Common Problems

### Chat says “Sorry, something went wrong”
1. `nvidia-smi pmon -c 1 -s m` — is something external holding VRAM?
2. `grep maxDuration ~/VoxStation/app/api/chat/route.ts` — should show 120
3. `cat ~/VoxStation/.env.local` — should have `OLLAMA_MODEL=llama3.2:3b`
4. `ollama run tinyllama "hi"` — does Ollama work at all?

### No audio plays in browser
Check DevTools console for `NotAllowedError`. The `StreamingTTS` class handles this correctly — if it appears, the AudioContext is being created after an async gap rather than synchronously in the click handler.

### Voice service /health not responding
```bash
docker ps | grep voxstation
docker logs voxstation_voice --tail 30
```

### VRAM full after killing VoxStation
```bash
nvidia-smi pmon -c 1 -s m   # find the PID
sudo kill -9 <PID>          # kill it
```

---

## Development Commands

```bash
# VRAM check — run first when anything GPU-related breaks
nvidia-smi pmon -c 1 -s m
nvidia-smi --query-gpu=memory.free,memory.used --format=csv

# What Ollama has loaded
curl -sf http://127.0.0.1:11434/api/ps | python3 -c \
  "import sys,json; [print(m['name'], round(m.get('size_vram',0)/1e9,2),'GB') for m in json.load(sys.stdin).get('models',[])] or print('nothing')"

# Evict a model from VRAM
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"MODEL_NAME","keep_alive":0,"prompt":""}'

# Test TTS at service level
curl -X POST http://127.0.0.1:8020/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","voice_id":"john"}' \
  --output /tmp/test.wav -w "\nTime: %{time_total}s\n" && aplay /tmp/test.wav

# Test chat
curl -X POST http://127.0.0.1:3050/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"say hello"}]}' --max-time 45

# View voice service logs
vox logs voice
tail -50 ~/VoxStation/.vox-frontend.log
```

---

## Debugging Log

Chronological record of every issue, root cause, and fix. Read this before re-investigating anything.

### Session 1 — April 7-8, 2026

#### ✅ Docker GPU passthrough
**Root cause 1:** `/usr/local/bin/vox` was stale (no `--gpus all`). Fix: `sudo cp ~/VoxStation/vox /usr/local/bin/vox`
**Root cause 2:** `no-cgroups = true` in CachyOS container config. Fix: set `no-cgroups = false`.

#### ✅ Chatterbox TTS on Blackwell CUDA
**Root cause:** chatterbox-tts pins `torchaudio==2.6.0` forcing torch 2.6.0+cu124 (no sm_120). Fix: `--no-deps` + PyTorch nightly 2.12.0.dev20260408+cu128.

#### ✅ TTS crashes on save (TorchCodec)
**Root cause:** nightly 2.12.0 changed `torchaudio.save()` default backend to TorchCodec (not installed). Fix: replaced with `soundfile.write()`.

#### ✅ All /api/voice/* returned 500
**Root cause 1:** `voice-client.ts` fallback was `http://192.168.4.240:8020` (wrong IP). Fix: changed to `http://127.0.0.1:8020`.
**Root cause 2:** No `maxDuration` on synthesize/clone routes. Fix: added `export const maxDuration = 60`.

#### ✅ Ollama model corruption
**Root cause:** nemotron-mini download corrupted. Confirmed by tinyllama working fine. Fix: `ollama rm nemotron-mini && ollama pull nemotron-mini`.

#### ✅ CUDA OOM from nemotron-3-nano:30b in VRAM
**Root cause:** 24 GiB model left in VRAM after failed load. Voice service needs 7.8 GiB — no room.
Fix: `curl -X POST http://127.0.0.1:11434/api/generate -d '{"model":"nemotron-3-nano:30b","keep_alive":0,"prompt":""}'`

#### ✅ RAG silently disabled
**Root cause:** `nomic-embed-text` never pulled. Fix: `ollama pull nomic-embed-text`.

---

### Session 2 — April 9, 2026

#### ✅ Chat route missing maxDuration
**Root cause:** `app/api/chat/route.ts` had no `maxDuration` — killed at 10s default.
Fix: `sed -i '1s/^/export const maxDuration = 120;\n/' ~/VoxStation/app/api/chat/route.ts`

#### ✅ .env.local missing — defaulted to nemotron-3-nano:30b
**Root cause:** `.env.local` never created. Code line: `const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "nemotron-3-nano:30b"` — every chat tried to load 24 GiB model.
Fix: `echo "OLLAMA_MODEL=llama3.2:3b" > ~/VoxStation/.env.local`

#### ✅ External Python process holding 23 GiB VRAM
**Symptom:** VRAM showed 23 GiB used even after `vox stop` + `docker rm` + `pkill ollama`.
**Diagnosis:** `nvidia-smi pmon -c 1 -s m` showed PID 360938 (python, 23 GiB) — Open WebUI container with a loaded local model.
Fix: `sudo kill -9 360938`
**Key lesson:** Always run `nvidia-smi pmon` first. Don't restart VoxStation repeatedly — find the external process.

#### ✅ llama3.2:3b not pulled
Fix: `ollama pull llama3.2:3b`

#### ✅ TTS only read ~500 chars
**Root cause:** `TTS_MAX_CHARS = 500` hard limit in `synthesize/route.ts` was truncating all responses.
Fix: removed truncation entirely. Streaming TTS now sends short sentences individually anyway.

#### ✅ Streaming TTS implemented
First sentence now plays ~1s after LLM starts responding instead of 10-40s after it finishes.
Key: `AudioContext` created synchronously in click handler for browser autoplay policy compliance.
Files: `lib/voice/streaming-tts.ts`, updated `app/page.tsx`.

#### ✅ Standalone TTS page built
Available at `/tts.html`. Sentence-by-sentence streaming, voice selector, progress bar, keyboard shortcut.
Source: `public/tts.html`.

---

## API Reference

```
POST /api/chat              → SSE stream of LLM response (with RAG)
POST /api/voice/transcribe  → Whisper STT → { text, language, duration }
POST /api/voice/synthesize  → Chatterbox TTS → audio/wav
POST /api/voice/clone       → Save voice sample → { id, name, total_samples }
GET  /api/voice/voices      → List voice profiles

Direct voice service (port 8020):
  GET  /health     → { status, models, voices, gpu }
  POST /transcribe → { text, language, duration }
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
| Streaming TTS | Web Audio API + sentence splitting | `lib/voice/streaming-tts.ts` |
| RAG | Qdrant + nomic-embed-text | evergreen_kb collection |
| Voice Service | FastAPI + Uvicorn | Docker, nvidia/cuda:12.8.0-runtime |
| OS | CachyOS (Arch Linux) | nvidia-open-dkms |

---

## License

Private — John Finley Productions

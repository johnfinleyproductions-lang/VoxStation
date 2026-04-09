# VoxStation — Architecture
*Last updated: April 9, 2026*

For setup issues and debugging history, see `README.md`.
For a quick session context summary, see `SESSION_BRIEF.md`.

---

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│  BROWSER  (Mac Mini M4)                                        │
│  http://192.168.4.176:3050     /tts.html (bookmarkable)       │
└──────────────────┬───────────────────────────────────────────┘
                  │ HTTP (LAN)
                  ▼
┌────────────────────────────────────────────────────────────────┐
│  FRAMESTATION 395  (192.168.4.176 / CachyOS)                   │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Next.js Frontend  :3050                                  │ │
│  │  ├─ /api/chat          → Ollama :11434                  │ │
│  │  ├─ /api/voice/synthesize → Voice Service :8020          │ │
│  │  ├─ /api/voice/transcribe → Voice Service :8020          │ │
│  │  ├─ /api/voice/clone   → Voice Service :8020             │ │
│  │  ├─ /api/voice/voices  → Voice Service :8020             │ │
│  │  └─ /tts.html          → (static, served from public/)   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                    │                      │                    │
│                    ▼                      ▼                    │
│  ┌─────────────────┐  ┌───────────────────────────────┐ │
│  │ Ollama  :11434  │  │ Voice Service Docker  :8020          │ │
│  │ llama3.2:3b     │  │ Whisper large-v2  → CUDA ✅          │ │
│  │ nomic-embed     │  │ Chatterbox TTS    → CUDA ✅          │ │
│  └────────┬───────┘  └───────────────────────────────┘ │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────┐                                            │
│  │ Qdrant   :6333 │  ← vector DB for RAG memory                 │
│  └─────────────────┘                                            │
│                                                                │
│  eGPU: RTX PRO 4500 Blackwell 32GB (sm_120) via OCuLink        │
└────────────────────────────────────────────────────────────────┘
```

---

## Data Flows

### Chat with Streaming TTS
```
User types message
  → sendMessage() in page.tsx
  → new StreamingTTS(voiceId)  ←── SYNC in click handler (autoplay policy)
  → POST /api/chat  (maxDuration=120)
  → Ollama /api/chat  (SSE stream)
    → tokens arrive one by one
    → extractCompleteSentences() detects complete sentence
    → tts.speak(sentence)  → POST /api/voice/synthesize  (maxDuration=60)
      → Voice Service /synthesize
      → Chatterbox TTS generates WAV on CUDA
      → soundfile.write() → WAV bytes returned
    → AudioContext.decodeAudioData()
    → source.start(nextStartTime)  ←── scheduled seamlessly after previous
  → LLM stream ends
  → Any remaining sentence buffer spoken

Result: First sentence plays ~1s after LLM starts responding
```

### Voice Input Pipeline
```
User presses mic, speaks
  → Browser MediaRecorder → WebM blob
  → handleVoiceInput() in page.tsx
  → POST /api/voice/transcribe  (maxDuration=60)
  → Voice Service /transcribe
  → Whisper large-v2 on CUDA → { text, language, duration }
  → sendMessage(text)  ←── full chat + TTS pipeline above
```

### Voice Clone
```
User records audio on /clone page
  → POST /api/voice/clone  (maxDuration=60)
  → Voice Service /voices/clone
  → ffmpeg: WebM → 24kHz mono WAV
  → Saved to voices/john/sample_NN.wav
  → meta.json updated
  → { id, name, total_samples } returned
```

### Standalone TTS Page (/tts.html)
```
User opens http://192.168.4.176:3050/tts.html
  → Fetches GET /api/voice/voices → populates voice selector
  → User types text, clicks Speak
  → new AudioContext()  ←── SYNC in click handler
  → splitSentences(text)
  → For each sentence:
    → POST /api/voice/synthesize
    → ctx.decodeAudioData()
    → source.start(nextStartTime)
    → Wait until 0.4s before sentence ends
    → Fetch next sentence (overlap)
```

---

## File Structure

```
VoxStation/
│
├── SESSION_BRIEF.md          ← START HERE every new session
├── ARCHITECTURE.md           ← this file
├── README.md                 ← full docs + debugging log
├── vox                       ← git source (sync to /usr/local/bin/vox!)
├── .env.local                ← NOT in git — must create manually
│    OLLAMA_MODEL=llama3.2:3b
│    VOICE_SERVICE_URL=http://127.0.0.1:8020
│
├── app/
│   ├── page.tsx               ← main chat UI, streaming TTS integrated
│   ├── layout.tsx
│   ├── globals.css
│   ├── clone/                 ← voice cloning page
│   └── api/
│       ├── chat/route.ts       maxDuration=120
│       └── voice/
│           ├── synthesize/route.ts   maxDuration=60, no char limit
│           ├── clone/route.ts        maxDuration=60
│           ├── transcribe/route.ts   maxDuration=60
│           ├── voices/route.ts
│           └── pipeline/route.ts
│
├── lib/
│   ├── voice/
│   │   ├── voice-client.ts     ← all voice service API calls, fallback 127.0.0.1
│   │   └── streaming-tts.ts    ← StreamingTTS class + extractCompleteSentences
│   └── chat/
│       ├── ollama-client.ts
│       └── rag-client.ts
│
├── components/
│   ├── chat/chat-panel.tsx
│   ├── voice/voice-controls.tsx
│   └── layout/status-bar.tsx
│
├── public/
│   └── tts.html              ← standalone TTS page — http://IP:3050/tts.html
│
└── voice-service/            ← Docker container, port 8020
    ├── Dockerfile
    ├── main.py
    ├── config.py             CORS origins, device env vars
    ├── requirements.txt
    ├── services/
    │   ├── tts_service.py     Chatterbox — soundfile.write() NOT torchaudio
    │   └── whisper_service.py Whisper — CTranslate2
    └── routers/
        ├── synthesize.py      POST /synthesize
        ├── transcribe.py      POST /transcribe
        ├── voices.py          GET /voices, POST /voices/clone
        └── health.py          GET /health
```

---

## Service Map

| Service | Port | How Started | Restart |
|---|---|---|---|
| Next.js | 3050 | `vox start` | `vox stop && vox start` |
| Voice Service | 8020 | Docker via `vox start` | `vox stop && vox start` |
| Ollama | 11434 | `vox start` | `vox stop && vox start` |
| Qdrant | 6333 | Docker, persistent | `docker restart qdrant` |
| Open WebUI (business) | 3000 | Docker, auto-start | `docker stop/start webui_business` |
| Open WebUI (family) | 3002 | Docker, auto-start | `docker stop/start webui_family` |
| Evergreen Vault DB | 5432 | Docker, auto-start | `docker stop/start evergreen-vault-db` |
| MinIO | 9000/9001 | Docker, auto-start | `docker stop/start evergreen-vault-minio` |
| n8n | 5678 | Docker, auto-start | `docker stop/start evergreen_n8n` |

---

## Environment Variables

### Next.js (`.env.local`, not in git — must create manually)

```bash
OLLAMA_MODEL=llama3.2:3b           # Which model to use for chat
VOICE_SERVICE_URL=http://127.0.0.1:8020  # Voice service URL
OLLAMA_BASE_URL=http://127.0.0.1:11434   # Ollama URL
```

### Voice Service (`.env` in `voice-service/`, or prefix with `VOXSTATION_`)

```bash
VOXSTATION_WHISPER_DEVICE=cuda      # cuda or cpu
VOXSTATION_XTTS_DEVICE=cuda         # cuda or cpu
VOXSTATION_WHISPER_MODEL=large-v2   # whisper model size
```

---

## Docker Voice Container

```dockerfile
# Base image
nvidia/cuda:12.8.0-runtime-ubuntu22.04

# PyTorch install (--no-deps bypasses chatterbox pin on torchaudio==2.6.0)
RUN pip install torch torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu128
RUN pip install chatterbox-tts --no-deps

# Why --no-deps:
# chatterbox-tts pins torchaudio==2.6.0 exactly, forcing torch==2.6.0+cu124
# which has no sm_120 kernels. --no-deps lets us use nightly 2.12.0+ with sm_120.
```

**Rebuild command** (needed only after voice-service/ changes):
```bash
vox stop
docker rm voxstation_voice && docker rmi voxstation-voice
docker build --no-cache -t voxstation-voice ~/VoxStation/voice-service
vox start
```

---

## VRAM Budget

```
RTX PRO 4500 total:    31,457 MiB

Always loaded (voice service):
  Whisper large-v2:     ~3,072 MiB
  Chatterbox TTS:       ~4,864 MiB
  Voice total:          ~7,936 MiB

Remaining for LLM:    ~23,521 MiB

Recommended models:
  llama3.2:3b           ~2,048 MiB  ✅ recommended default
  llama3.1:8b           ~5,632 MiB  ✅ higher quality
  nemotron-mini         ~8,192 MiB  ✅ voice-optimised
  nemotron-3-nano:30b  ~24,576 MiB  ❌ NEVER fits (OOM)

Other GPU consumers on this machine:
  Open WebUI (loaded)  up to ~23 GB  ⚠️ stop before VoxStation if VRAM tight
```

---

## Streaming TTS Architecture

```
LLM SSE stream                      Audio playback
──────────────────────────────  ──────────────────────────────
 t=0   User sends message         AudioContext created (click handler)
 t=0.5 LLM starts streaming
 t=1   "Hello, I can help".►      → TTS fetch for sentence 1
 t=1.2 "Here are three"            sentence 1 synthesizing...
 t=1.4 "things to consider."►      → TTS fetch for sentence 2 (queued)
 t=2.0                             sentence 1 audio arrives
 t=2.0                             ► PLAYING sentence 1
 t=2.2 "First, make sure"►         → TTS fetch for sentence 3 (queued)
 t=2.8                             sentence 2 audio arrives, scheduled
 t=4.0                             ► PLAYING sentence 2 (seamless)
 ...

Key: sentences are fetched and synthesized in parallel with playback.
First audio starts ~1s after LLM begins, not 10-40s after it finishes.
```

**Implementation:** `lib/voice/streaming-tts.ts`
- `StreamingTTS` class manages AudioContext + scheduling
- `extractCompleteSentences()` detects complete sentences in the SSE token stream
- Promise chain ensures sentences never play out of order
- AudioContext created synchronously in click handler (satisfies browser autoplay policy)

---

## Browser Autoplay Policy

Browsers block `audio.play()` unless called in a user gesture handler.

**How VoxStation handles it:** `new AudioContext()` is created synchronously at the top of `sendMessage()`, which is called directly from a button click. All subsequent `source.start()` calls use this AudioContext — they are allowed because the context was created in the gesture.

**The wrong way** (what broke before):
```typescript
// ❌ Wrong — AudioContext created after async gaps, gesture expired
const res = await fetch('/api/chat', ...)
const audio = new Audio(url);
await audio.play(); // NotAllowedError
```

**The right way:**
```typescript
// ✅ Correct — AudioContext created synchronously in click handler
const tts = new StreamingTTS(voiceId); // AudioContext created here
const res = await fetch('/api/chat', ...); // async gaps OK now
tts.speak(sentence); // schedules via the already-created AudioContext
```

---

## Ollama Integration

```
Next.js /api/chat  →  Ollama /api/chat  (SSE)
                       model: from OLLAMA_MODEL env var
                       fallback: llama3.2:3b (changed from nemotron-3-nano:30b)

Embeddings for RAG:
  lib/chat/rag-client.ts  →  Ollama /api/embeddings
  model: nomic-embed-text  (must be pulled)

Models directory: managed by Ollama (~/.ollama/models/)
```

---

## Voice Service Internal Architecture

```
FastAPI app (main.py)
  ├─ /health           → routers/health.py
  ├─ /transcribe       → routers/transcribe.py
  │                         → services/whisper_service.py
  │                             faster-whisper (CTranslate2)
  │                             Model: large-v2 on CUDA float16
  ├─ /synthesize       → routers/synthesize.py
  │                         → services/tts_service.py
  │                             ChatterboxTTS.from_pretrained(device="cuda")
  │                             model.generate(text, audio_prompt_path)
  │                             soundfile.write() ← NOT torchaudio.save()
  └─ /voices, /voices/clone  → routers/voices.py
                               → services/tts_service.py.clone_voice()
                                   ffmpeg: any format → 24kHz mono WAV
                                   saved to voices/{id}/sample_NN.wav

Voice profiles stored at: voice-service/voices/{voice_id}/
  sample_01.wav, sample_02.wav, ...  (reference audio for cloning)
  meta.json  { name, description }
```

**Critical:** `soundfile.write()` is used instead of `torchaudio.save()` because PyTorch nightly 2.12.0+ changed `torchaudio.save()` to default to TorchCodec backend, which is not installed.

---

## GPU / CUDA Stack

```
Host:  CachyOS │ driver 595.58.03 │ CUDA 13.2 │ nvidia-open-dkms
         │
         │ OCuLink (1933 MHz, locked by vox start)
         │
       RTX PRO 4500 Blackwell (sm_120 / compute 12.0)
         │
         ├─ NVIDIA Container Toolkit (/etc/nvidia-container-runtime/config.toml)
         │    no-cgroups = false  ← MUST be set on CachyOS
         │
         ├─ Docker: voxstation_voice container
         │    nvidia/cuda:12.8.0-runtime-ubuntu22.04
         │    PyTorch nightly 2.12.0.dev20260408+cu128
         │    Arch list: sm_75, sm_80, sm_86, sm_90, sm_100, sm_120 ✅
         │    Chatterbox TTS → CUDA
         │    Whisper (CTranslate2) → CUDA
         │
         └─ Ollama (host process)
              llama.cpp has its own CUDA path, sm_120 native
```

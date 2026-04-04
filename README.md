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
│  nemotron-3-nano │   │  ├─ Whisper STT (faster-whisper)     │
│  :30b on GPU     │   │  └─ Chatterbox TTS (Resemble AI)    │
│                  │   │     CPU-only (see GPU notes below)   │
└──────────────────┘   └──────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│  Qdrant (6333)   │
│  evergreen_kb    │
│  collection      │
└──────────────────┘
```

## Hardware

| Machine | Role | Specs |
|---|---|---|
| **Framestation 395** | AI / GPU box | NVIDIA RTX PRO 4500 Blackwell 32GB, CachyOS (Arch Linux), IP: `192.168.4.176` |
| Mac Mini M4 | Daily driver / browser client | macOS |
| Mac Mini M2 | Backend services (Evergreen Vault, etc.) | macOS |

## Services and Ports

| Service | Port | Host | Notes |
|---|---|---|---|
| Next.js frontend | 3050 | Framestation | Web UI + API proxy |
| Voice service | 8020 | Framestation | Docker container, CPU-only PyTorch |
| Ollama | 11434 | Framestation | LLM inference on GPU |
| Qdrant | 6333 | Framestation | Vector search for RAG |

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
│   ├── Dockerfile                  # CPU-only PyTorch build
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
├── .env                            # Runtime config (not committed)
├── .env.example                    # Template
├── package.json                    # Next.js 15 + React 19
├── next.config.ts                  # Minimal config
└── ARCHITECTURE.md                 # Original design doc
```

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

## Quick Start

### Prerequisites

On the Framestation:
- Ollama installed with `nemotron-3-nano:30b` pulled
- Qdrant running on port 6333 with `evergreen_kb` collection
- Docker installed with NVIDIA Container Toolkit
- Node.js 18+ and npm

### 1. Start the Voice Service

```bash
cd ~/VoxStation/voice-service

# Build the Docker image (first time takes ~10 minutes)
docker build -t voxstation-voice .

# Run the container (CPU-only mode — see GPU notes)
docker run -d \
  --name voxstation_voice \
  -p 8020:8020 \
  -v ./models:/app/models \
  -v ./voices:/app/voices \
  -e VOXSTATION_WHISPER_MODEL=base \
  -e VOXSTATION_WHISPER_DEVICE=cpu \
  -e VOXSTATION_XTTS_DEVICE=cpu \
  -e CUDA_VISIBLE_DEVICES= \
  voxstation-voice

# Verify it's running (takes ~60s for models to load)
docker logs -f voxstation_voice
```

Wait for: `VoxStation Voice Service ready on port 8020`

### 2. Start the Frontend

```bash
cd ~/VoxStation
npm install
npm run build
npm start
```

### 3. Open in Browser

Navigate to `http://192.168.4.176:3050` from your Mac.

To use the microphone over HTTP (not HTTPS), add the Framestation IP to Chrome's insecure origins:

1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add `http://192.168.4.176:3050`
3. Relaunch Chrome

### 4. Clone Your Voice

1. Click "Clone Voice" in the header (or go to `/clone`)
2. Record a 10-30 second sample of your voice
3. Enter a voice name (e.g., "john")
4. Click "Clone My Voice"

Voice samples are saved to `voice-service/voices/<name>/` as WAV files.

### 5. Chat

Type a message or hold the mic button to speak. VoxStation will:
1. Transcribe your speech (Whisper)
2. Search the knowledge base for context (Qdrant RAG)
3. Generate a response (Ollama nemotron-3-nano:30b)
4. Speak the response in your cloned voice (Chatterbox TTS)

---

## Known Issues and Lessons Learned

### NVIDIA Blackwell (sm_120) — No PyTorch CUDA Support Yet

The RTX PRO 4500 uses the Blackwell architecture (compute capability sm_120). As of April 2026:

- **PyTorch** does not ship stable CUDA binaries for sm_120. Nightly cu128 builds include partial support but crash on import when the GPU is visible.
- **CTranslate2** (used by faster-whisper) crashes the entire machine — not just the container, the whole OS — when it attempts CUDA initialization on Blackwell.
- **Ollama** works perfectly on Blackwell GPU because it uses llama.cpp which has its own CUDA kernels.

**The fix:** Run the voice service with CPU-only PyTorch and hide the GPU entirely:

```bash
# In Docker run command or docker-compose.yml:
-e CUDA_VISIBLE_DEVICES=       # Empty string hides GPU from all CUDA libs
-e VOXSTATION_WHISPER_DEVICE=cpu
-e VOXSTATION_XTTS_DEVICE=cpu
```

The Dockerfile must install CPU-only PyTorch:
```dockerfile
RUN pip3 install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

**Do NOT** use the CUDA PyTorch wheels or pass GPU devices to Docker — this will crash the machine and cause a reboot loop.

**Future:** When PyTorch ships stable sm_120 support, re-enable GPU for massive speed improvements on Whisper and Chatterbox.

### Node.js IPv6 Resolution

Node.js `fetch("http://localhost:...")` resolves to `::1` (IPv6), but Ollama and other services only bind to `127.0.0.1` (IPv4). This causes connections to hang silently with no error — the request just never completes.

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

**Workaround:** Use `docker run` directly instead of `docker compose up`. See the Quick Start commands above.

### CachyOS Firewall

CachyOS (Arch-based) blocks incoming connections by default. Open port 3050 for LAN access:

```bash
sudo iptables -I INPUT -p tcp --dport 3050 -j ACCEPT
```

### Next.js Streaming SSE in Production

Next.js production mode (`next start`) can buffer streaming responses when using nested `ReadableStream` objects, causing the SSE stream to appear frozen. The fix uses `TransformStream` with an async background writer, plus these response headers:

```typescript
export const dynamic = "force-dynamic";

// In the response:
headers: {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
}
```

### Whisper Compute Type

CPU does not support float16 compute. When running Whisper on CPU, the compute type must be set to `int8`:

```bash
-e VOXSTATION_WHISPER_COMPUTE_TYPE=int8
```

The config auto-detects this when `whisper_compute_type` is left empty — it uses float16 for CUDA and int8 for CPU.

### Performance on CPU

With GPU disabled, expect these latencies:
- **Whisper STT (base model):** ~5-10s for a 30s recording
- **Chatterbox TTS:** ~46s model load (first request), ~10-20s per synthesis
- **Ollama LLM (on GPU via llama.cpp):** ~1-2s response time

TTS is the bottleneck. This will improve dramatically once Blackwell CUDA support lands in PyTorch.

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
| Container | Docker (Ubuntu 22.04 base) | — |
| OS | CachyOS (Arch Linux) | — |

---

## Development

```bash
# Dev mode with hot reload
npm run dev

# Rebuild voice service after code changes
docker stop voxstation_voice && docker rm voxstation_voice
cd voice-service && docker build -t voxstation-voice . && cd ..
docker run -d --name voxstation_voice \
  -p 8020:8020 \
  -v ./voice-service/models:/app/models \
  -v ./voice-service/voices:/app/voices \
  -e VOXSTATION_WHISPER_MODEL=base \
  -e VOXSTATION_WHISPER_DEVICE=cpu \
  -e VOXSTATION_XTTS_DEVICE=cpu \
  -e CUDA_VISIBLE_DEVICES= \
  voxstation-voice

# Check voice service health
curl http://127.0.0.1:8020/health

# Test Ollama directly
curl http://127.0.0.1:11434/api/chat -d \
  '{"model":"nemotron-3-nano:30b","messages":[{"role":"user","content":"hi"}],"stream":false}'

# View voice service logs
docker logs -f voxstation_voice
```

---

## License

Private — John Finley Productions

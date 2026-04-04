# VoxStation

Voice-enabled AI chat powered by local GPU. Speak to your AI assistant and hear it respond in your own cloned voice.

**Stack:** Whisper STT → Ollama LLM + Qdrant RAG → XTTS v2 Voice-Cloned TTS

All processing runs locally on the Framestation 395 with NVIDIA RTX PRO 4500 Blackwell (32GB VRAM). No cloud APIs for the voice pipeline.

## Features

- **Speech-to-text** — faster-whisper (large-v3) on GPU, ~170ms latency
- **Local LLM** — Ollama with qwen2.5:32b or any loaded model
- **RAG knowledge base** — Qdrant vector search across course library
- **Voice cloning** — XTTS v2 zero-shot cloning from 6-30s audio sample
- **Streaming chat** — Real-time token streaming with SSE
- **Full voice loop** — Speak → Transcribe → Think → Respond in your voice

## Quick Start

### 1. Voice Service (on Framestation)

```bash
cd voice-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8020
```

### 2. Frontend (any machine)

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local with your Framestation IP
pnpm dev
```

Open http://localhost:3050

### 3. Clone Your Voice

Record a 10-30 second WAV of yourself speaking, then:

```bash
curl -X POST http://192.168.4.240:8020/voices/clone \
  -F "voice_id=john" \
  -F "name=John" \
  -F "audio=@my_voice.wav"
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system diagrams and VRAM budget.

## License

Private — John Finley Productions

# VoxStation — Session Brief
*Paste this file at the start of every new Claude/Cowork session.*
*Last updated: April 9, 2026*

---

## Start Here

This file gives Claude full context to pick up VoxStation work without re-investigating anything. Always read this file AND `ARCHITECTURE.md` before making any changes.

**Repo:** `github.com/johnfinleyproductions-lang/VoxStation`
**Framestation IP:** `192.168.4.176` (also accessible at `192.168.4.240` from some contexts)
**User on Framestation:** `lynf`
**SSH into Framestation:** `ssh lynf@192.168.4.176`

---

## What VoxStation Is

Fully local AI voice assistant running on a Framestation (CachyOS/Arch Linux desktop) with an NVIDIA RTX PRO 4500 Blackwell GPU via OCuLink eGPU dock.

**Full pipeline:** Speak → Whisper STT (CUDA) → Ollama LLM + Qdrant RAG → Chatterbox TTS (CUDA, cloned voice) → Audio playback

**Web UI:** `http://192.168.4.176:3050`
**Standalone TTS:** `http://192.168.4.176:3050/tts.html` *(bookmark this)*

---

## Hardware

| | |
|---|---|
| GPU | NVIDIA RTX PRO 4500 Blackwell, 32 GB VRAM, sm_120 (compute 12.0) |
| eGPU | OCuLink dock, GPU locked at 1933 MHz / 186W via `vox start` |
| CUDA | 13.2 (driver 595.58.03, nvidia-open-dkms) |
| OS | CachyOS / Arch Linux |

---

## Current Status (April 9, 2026)

| Feature | Status | Notes |
|---|---|---|
| Whisper STT on CUDA | ✅ Working | large-v2, float16 |
| Chatterbox TTS on CUDA | ✅ Working | PyTorch nightly 2.12.0.dev20260408+cu128 |
| Chat (llama3.2:3b) | ✅ Working | `.env.local` must exist with `OLLAMA_MODEL=llama3.2:3b` |
| Voice clone (john, 4 samples) | ✅ Working | |
| RAG (nomic-embed-text) | ✅ Working | Must be pulled: `ollama pull nomic-embed-text` |
| Streaming TTS | ✅ Working | Speaks sentence-by-sentence as LLM streams |
| Standalone TTS page | ✅ Working | `/tts.html` — bookmarkable |
| Audio autoplay in browser | ✅ Fixed | AudioContext created in click handler |

---

## VRAM Budget — Critical

**Total: 31,457 MiB. Hard constraint: model + voice service (7.8 GB) must stay under 31 GB.**

| Service | VRAM |
|---|---|
| Whisper large-v2 | ~3.0 GiB |
| Chatterbox TTS | ~4.8 GiB |
| **Voice service total** | **~7.8 GiB** |
| llama3.2:3b (recommended) | ~2.0 GiB |
| nemotron-3-nano:30b | 24 GiB ❌ NEVER fits |

**This machine also runs Open WebUI (`:3000`, `:3002`) which can hold 20+ GB of VRAM.** Before debugging any GPU issue:
```bash
nvidia-smi pmon -c 1 -s m   # shows EVERY process using VRAM on the whole machine
```
If you see a `python` PID with 20+ GB that isn’t VoxStation: `sudo kill -9 <PID>`

---

## The `vox` Script — Critical Warning

There are TWO copies:
- `~/VoxStation/vox` — git source (changes here do nothing until synced)
- `/usr/local/bin/vox` — **the one the system actually uses**

After any `git pull` that touches `vox`:
```bash
sudo cp ~/VoxStation/vox /usr/local/bin/vox
```

---

## Essential Commands

```bash
# Start / stop / logs
vox start
vox stop
vox logs voice

# VRAM check (run this FIRST when anything GPU breaks)
nvidia-smi pmon -c 1 -s m
nvidia-smi --query-gpu=memory.free,memory.used --format=csv

# Evict a stuck Ollama model
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"MODEL_NAME","keep_alive":0,"prompt":""}'

# Test TTS at service level
curl -X POST http://127.0.0.1:8020/synthesize \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello","voice_id":"john"}' \
  --output /tmp/test.wav -w "\nTime: %{time_total}s\n" && aplay /tmp/test.wav

# Test chat
curl -X POST http://127.0.0.1:3050/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"say hello"}]}' \
  --max-time 45

# Deploy after code changes (no Docker rebuild needed for TS/Next.js changes)
cd ~/VoxStation && git pull && vox stop && vox start

# Full rebuild (only needed after voice-service/ Python or Dockerfile changes)
vox stop && docker rm voxstation_voice && docker rmi voxstation-voice
docker build -t voxstation-voice ~/VoxStation/voice-service
vox start
```

---

## Key Files

| File | Purpose |
|---|---|
| `app/page.tsx` | Main chat UI — streaming TTS integrated here |
| `app/api/chat/route.ts` | Chat endpoint, `maxDuration=120` |
| `app/api/voice/synthesize/route.ts` | TTS proxy, `maxDuration=60`, no char limit |
| `app/api/voice/clone/route.ts` | Voice clone upload, `maxDuration=60` |
| `lib/voice/voice-client.ts` | All voice service API calls, fallback `127.0.0.1:8020` |
| `lib/voice/streaming-tts.ts` | StreamingTTS class + extractCompleteSentences |
| `public/tts.html` | Standalone bookmarkable TTS page |
| `voice-service/services/tts_service.py` | Chatterbox TTS — uses soundfile.write() not torchaudio |
| `voice-service/config.py` | CORS origins, device settings |
| `.env.local` | `OLLAMA_MODEL=llama3.2:3b` — must exist, not in git |
| `/usr/local/bin/vox` | System vox script — sync from repo after changes |

---

## Route Timeout Reference

Every route touching a model needs `export const maxDuration`. Default is 10s — kills all inference.

| Route | maxDuration |
|---|---|
| `/api/chat` | 120 |
| `/api/voice/synthesize` | 60 |
| `/api/voice/clone` | 60 |
| `/api/voice/transcribe` (if exists) | 60 |

---

## Other Services on This Machine

The Framestation runs more than VoxStation. These all share VRAM/resources:

| Service | Port | Notes |
|---|---|---|
| VoxStation | 3050 | This project |
| Open WebUI (business) | 3000 | Can hold 20+ GB VRAM — stop before VoxStation if VRAM issues |
| Open WebUI (family) | 3002 | Same |
| Evergreen Vault (Postgres) | 5432 | Always running |
| MinIO | 9000 | Always running |
| n8n | 5678 | Always running |
| Qdrant | 6333 | Shared with VoxStation RAG |

---

## Common Failure Modes (Quick Reference)

| Symptom | Most likely cause | First thing to check |
|---|---|---|
| Chat “Sorry, something went wrong” | VRAM full, wrong model, no maxDuration | `nvidia-smi pmon -c 1 -s m` |
| TTS 500 | VRAM full, voice service down | `curl http://127.0.0.1:8020/health` |
| No audio in browser | Autoplay policy | DevTools console for `NotAllowedError` |
| VRAM full after vox stop | External process (Open WebUI etc) | `nvidia-smi pmon -c 1 -s m` |
| `exit status 2` from Ollama | Model OOM or corrupted | Test with `ollama run tinyllama "hi"` |
| `nomic-embed-text` not found | Never pulled | `ollama pull nomic-embed-text` |
| `.env.local` missing | First-time setup | `echo "OLLAMA_MODEL=llama3.2:3b" > ~/VoxStation/.env.local` |

---

## Full Debugging Log

See `README.md` → **Debugging Log** section for every issue ever encountered with root cause, date, and fix. Read before re-investigating anything.

---

*For full architecture details see `ARCHITECTURE.md`.*
*For full debugging history see `README.md`.*

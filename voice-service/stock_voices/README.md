# Stock voices

This directory holds reference WAV samples for stock voices that ship with VoxStation. They show up alongside cloned voices in `GET /voices` and can be passed as `voice_id` to `POST /synthesize`.

## On-disk layout

Same as `voices/`. One subdirectory per voice:

```
stock_voices/
├── narrator_neutral/
│   ├── sample_01.wav      ← 6-30s clean speech, 24kHz mono preferred
│   └── meta.json          ← {"name": "Narrator (Neutral)", "description": "..."}
├── narrator_warm/
│   ├── sample_01.wav
│   └── meta.json
└── README.md              ← this file
```

The TTS service scans this directory at request time. Drop a folder here, restart the service, and the voice appears.

## How to add a stock voice

### Option A: Record your own

1. Open QuickTime → New Audio Recording
2. Read 10-20 seconds of clean, neutral text in the voice/style you want
3. Export as WAV (or any format — VoxStation converts via ffmpeg on clone, but stock voices skip that path so WAV is preferred)
4. Save to `stock_voices/<voice_id>/sample_01.wav`
5. Optionally create `stock_voices/<voice_id>/meta.json`:
   ```json
   {
     "name": "Display Name Here",
     "description": "Brief description of the voice"
   }
   ```
6. Restart the voice-service container

### Option B: Use CC-licensed corpus samples

LibriTTS and VCTK both publish CC-BY-licensed speech samples. To pull one:

- Browse https://huggingface.co/datasets/openslr/librittsr (reading-paced narrators)
- Or https://huggingface.co/datasets/CSTR-Edinburgh/vctk (broader speaker variety)
- Pick a single `.wav` per voice you want to add
- Convert to 24kHz mono if needed: `ffmpeg -i input.wav -ar 24000 -ac 1 sample_01.wav`
- Drop into `stock_voices/<voice_id>/sample_01.wav`

Attribution lives in each dataset's README — keep that link in `meta.json` description if you ship publicly.

### Option C: Resemble's demo samples

If Resemble's chatterbox-turbo demo provides downloadable reference clips, those are also fair game. Check https://huggingface.co/spaces/ResembleAI/chatterbox-turbo-demo.

## What makes a good reference sample

- **6-30 seconds** of clean speech
- **One speaker** only (no overlapping voices)
- **Quiet background** — no music, traffic, fans
- **Natural pacing** — not whispered, not shouted
- **Wide phoneme coverage** — read varied sentences rather than repeating one phrase
- **24kHz mono WAV** preferred — Chatterbox uses this internally

The cleaner the reference, the better the cloned output. Bad reference audio is the #1 cause of robotic-sounding generations.

## Suggested starter set

If you want a small useful palette of stock voices, try:

- `narrator_neutral` — calm, even-paced, audiobook-style male or female
- `narrator_warm` — warmer, friendlier, conversational
- `narrator_pro` — newscaster / corporate / authoritative
- `narrator_quick` — energetic, fast-paced, podcast-style

Four covers most reading use cases without overwhelming the picker UI.

## Stock vs cloned voices

In `GET /voices` responses, each entry has a `kind` field:

- `"kind": "stock"` — lives in this directory
- `"kind": "cloned"` — lives in the `voices/` directory (uploaded via `POST /voices/clone`)

If the same voice ID exists in both directories, the cloned version wins. So you can override a stock voice by cloning a custom version with the same id.

"""
Voice Client
=============
API client for the VoxStation voice service (Whisper STT + XTTS v2 TTS).
Used by Next.js API routes to proxy requests to the Framestation.
"""

const VOICE_SERVICE_URL =
  process.env.VOICE_SERVICE_URL || "http://192.168.4.240:8020";

export interface TranscribeResult {
  text: string;
  language: string;
  language_probability: number;
  duration: number;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface Voice {
  id: string;
  name: string;
  description: string;
  sample_count: number;
  samples: string[];
}

/**
 * Transcribe audio using Whisper STT.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  language?: string
): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  if (language) {
    formData.append("language", language);
  }

  const res = await fetch(`${VOICE_SERVICE_URL}/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription failed: ${err}`);
  }

  return res.json();
}

/**
 * Synthesize text to speech using XTTS v2.
 * Returns WAV audio as an ArrayBuffer.
 */
export async function synthesizeSpeech(
  text: string,
  voiceId: string = "default",
  language: string = "en"
): Promise<ArrayBuffer> {
  const res = await fetch(`${VOICE_SERVICE_URL}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId, language }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Synthesis failed: ${err}`);
  }

  return res.arrayBuffer();
}

/**
 * List available voice profiles.
 */
export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${VOICE_SERVICE_URL}/voices`);
  if (!res.ok) throw new Error("Failed to list voices");
  const data = await res.json();
  return data.voices;
}

/**
 * Upload a voice sample for cloning.
 */
export async function cloneVoice(
  voiceId: string,
  audioBlob: Blob,
  name?: string,
  description?: string
): Promise<{ id: string; name: string; sample_saved: string; total_samples: number }> {
  const formData = new FormData();
  formData.append("voice_id", voiceId);
  formData.append("audio", audioBlob, "voice_sample.wav");
  if (name) formData.append("name", name);
  if (description) formData.append("description", description);

  const res = await fetch(`${VOICE_SERVICE_URL}/voices/clone`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voice clone failed: ${err}`);
  }

  return res.json();
}

/**
 * Health check for the voice service.
 */
export async function checkVoiceHealth(): Promise<{
  status: string;
  models: { whisper: { loaded: boolean }; xtts: { loaded: boolean } };
  gpu: any;
}> {
  const res = await fetch(`${VOICE_SERVICE_URL}/health`);
  if (!res.ok) throw new Error("Voice service unreachable");
  return res.json();
}

import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/voice/voice-client";

// TTS on CUDA Blackwell takes 5-10s warm, up to 40s cold (first request).
// Next.js defaults to 10s for API routes — we need 60s to be safe.
export const maxDuration = 60;

// Hard cap on text length sent to TTS. Chatterbox handles short-medium text
// best; very long responses (200+ words) cause slow synthesis and degraded
// quality. The UI streams the full text for reading — we just speak a summary.
const TTS_MAX_CHARS = 500;

function truncateForSpeech(text: string): string {
  if (text.length <= TTS_MAX_CHARS) return text;
  // Cut at the last sentence boundary before the limit
  const truncated = text.slice(0, TTS_MAX_CHARS);
  const lastPeriod = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! ")
  );
  return lastPeriod > 200 ? truncated.slice(0, lastPeriod + 1) : truncated + "...";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice_id = "default", language = "en" } = body;

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const speakText = truncateForSpeech(text.trim());
    const audioBuffer = await synthesizeSpeech(speakText, voice_id, language);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": "inline; filename=voxstation_speech.wav",
      },
    });
  } catch (error: any) {
    console.error("Synthesize error:", error);
    return NextResponse.json(
      { error: error.message || "Synthesis failed" },
      { status: 500 }
    );
  }
}

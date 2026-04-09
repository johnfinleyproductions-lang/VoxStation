import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/voice/voice-client";

// TTS on CUDA Blackwell takes 5-10s warm, up to 40s cold.
// Streaming TTS sends short sentences so synthesis is fast.
// Long-form standalone TTS still needs the full timeout.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice_id = "default", language = "en" } = body;

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // No truncation — streaming TTS sends short sentences individually.
    // Standalone TTS page may send larger blocks; voice service handles up to 5000 chars.
    const audioBuffer = await synthesizeSpeech(text.trim(), voice_id, language);

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

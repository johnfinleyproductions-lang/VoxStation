import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/voice/voice-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice_id = "default", language = "en" } = body;

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const audioBuffer = await synthesizeSpeech(text, voice_id, language);

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

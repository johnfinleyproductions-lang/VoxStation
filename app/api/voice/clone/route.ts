import { NextRequest, NextResponse } from "next/server";
import { cloneVoice } from "@/lib/voice/voice-client";

// Audio upload + ffmpeg WebM→WAV conversion can take 10-20s for long recordings.
// Next.js defaults to 10s for API routes — set 60s to be safe.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const voiceId = formData.get("voice_id") as string;
    const audioFile = formData.get("audio") as File | null;
    const name = formData.get("name") as string | null;
    const description = formData.get("description") as string | null;

    if (!voiceId) {
      return NextResponse.json({ error: "voice_id is required" }, { status: 400 });
    }
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const blob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });
    const result = await cloneVoice(voiceId, blob, name || undefined, description || undefined);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Clone error:", error);
    return NextResponse.json(
      { error: error.message || "Voice cloning failed" },
      { status: 500 }
    );
  }
}

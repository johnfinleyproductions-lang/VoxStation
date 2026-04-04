import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/voice/voice-client";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const language = formData.get("language") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const result = await transcribeAudio(
      new Blob([await audioFile.arrayBuffer()], { type: audioFile.type }),
      language || undefined
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Transcribe error:", error);
    return NextResponse.json(
      { error: error.message || "Transcription failed" },
      { status: 500 }
    );
  }
}

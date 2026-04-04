import { NextResponse } from "next/server";
import { listVoices } from "@/lib/voice/voice-client";

export async function GET() {
  try {
    const voices = await listVoices();
    return NextResponse.json({ voices });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to list voices" },
      { status: 500 }
    );
  }
}

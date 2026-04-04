import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio, synthesizeSpeech } from "@/lib/voice/voice-client";
import { streamOllamaChat, type OllamaMessage } from "@/lib/chat/ollama-client";
import { searchRAG, buildRAGContext } from "@/lib/chat/rag-client";

const SYSTEM_PROMPT = `You are VoxStation, a helpful AI assistant. Your responses will be spoken aloud, so keep them conversational, clear, and concise. Avoid markdown, bullet points, or code blocks. Speak naturally as if having a conversation.`;

/**
 * Full voice pipeline endpoint:
 * Audio in → Whisper STT → Ollama + RAG → XTTS v2 TTS → Audio out
 *
 * This is the "one-shot" endpoint for voice-to-voice conversation.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const voiceId = (formData.get("voice_id") as string) || "default";
    const historyJson = formData.get("history") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file" }, { status: 400 });
    }

    // Step 1: Transcribe audio → text
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type,
    });
    const transcription = await transcribeAudio(audioBlob);

    if (!transcription.text.trim()) {
      return NextResponse.json(
        { error: "Could not understand audio", transcription },
        { status: 400 }
      );
    }

    // Step 2: RAG retrieval
    let systemPrompt = SYSTEM_PROMPT;
    try {
      const chunks = await searchRAG(transcription.text, { topK: 3 });
      if (chunks.length > 0) {
        systemPrompt += `\n\n${buildRAGContext(chunks)}`;
      }
    } catch {
      // Continue without RAG
    }

    // Step 3: Build conversation and get LLM response
    const history: OllamaMessage[] = historyJson
      ? JSON.parse(historyJson)
      : [];
    const messages: OllamaMessage[] = [
      ...history,
      { role: "user", content: transcription.text },
    ];

    const stream = await streamOllamaChat(messages, { system: systemPrompt });
    const reader = stream.getReader();
    let fullResponse = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullResponse += value;
    }

    // Step 4: Synthesize response → audio
    const audioBuffer = await synthesizeSpeech(fullResponse, voiceId);

    // Return everything
    return NextResponse.json({
      transcription: transcription.text,
      response: fullResponse,
      audio: Buffer.from(audioBuffer).toString("base64"),
      audio_format: "wav",
    });
  } catch (error: any) {
    console.error("Pipeline error:", error);
    return NextResponse.json(
      { error: error.message || "Pipeline failed" },
      { status: 500 }
    );
  }
}

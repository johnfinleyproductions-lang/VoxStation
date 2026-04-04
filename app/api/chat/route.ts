import { NextRequest } from "next/server";
import { streamOllamaChat, type OllamaMessage } from "@/lib/chat/ollama-client";
import { searchRAG, buildRAGContext } from "@/lib/chat/rag-client";

const SYSTEM_PROMPT = `You are VoxStation, a helpful AI assistant running locally on the user's Framestation GPU. You have access to a knowledge base of educational course materials via RAG. Be concise but thorough — your responses will be spoken aloud via text-to-speech, so keep them conversational and clear. Avoid markdown formatting, bullet points, and code blocks unless specifically asked. Speak naturally.`;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    console.log("[chat] Request received");
    const body = await req.json();
    const {
      messages,
      model,
      useRAG = true,
    }: {
      messages: OllamaMessage[];
      model?: string;
      useRAG?: boolean;
    } = body;

    console.log("[chat] Messages:", messages.length, "useRAG:", useRAG, "model:", model || "default");

    if (!messages || messages.length === 0) {
      return new Response("No messages provided", { status: 400 });
    }

    // Get the latest user message for RAG
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");

    let systemPrompt = SYSTEM_PROMPT;

    // RAG retrieval if enabled
    if (useRAG && lastUserMessage) {
      try {
        console.log("[chat] Starting RAG search...");
        const chunks = await searchRAG(lastUserMessage.content, { topK: 3 });
        console.log("[chat] RAG returned", chunks.length, "chunks");
        if (chunks.length > 0) {
          const context = buildRAGContext(chunks);
          systemPrompt += `\n\n${context}\n\nUse this context to inform your answer when relevant. Cite sources naturally (e.g., "According to the storytelling course...").`;
        }
      } catch (ragError) {
        console.warn("[chat] RAG search failed, continuing without context:", ragError);
      }
    }

    // Stream from Ollama
    console.log("[chat] Calling Ollama at", process.env.OLLAMA_BASE_URL || "FALLBACK: http://192.168.4.240:11434");
    const stream = await streamOllamaChat(messages, {
      model,
      system: systemPrompt,
    });
    console.log("[chat] Ollama stream created, returning SSE response");

    // Convert to SSE format for the frontend
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              break;
            }
            const sseData = `data: ${JSON.stringify({ content: value })}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          }
        } catch (error) {
          console.error("[chat] Stream read error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("[chat] Fatal error:", error);
    return new Response(error.message || "Chat failed", { status: 500 });
  }
}

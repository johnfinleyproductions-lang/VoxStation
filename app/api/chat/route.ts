import { NextRequest } from "next/server";
import { streamOllamaChat, type OllamaMessage } from "@/lib/chat/ollama-client";
import { searchRAG, buildRAGContext } from "@/lib/chat/rag-client";

const SYSTEM_PROMPT = `You are VoxStation, a helpful AI assistant running locally on the user's Framestation GPU. You have access to a knowledge base of educational course materials via RAG. Be concise but thorough — your responses will be spoken aloud via text-to-speech, so keep them conversational and clear. Avoid markdown formatting, bullet points, and code blocks unless specifically asked. Speak naturally.`;

export async function POST(req: NextRequest) {
  try {
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
        const chunks = await searchRAG(lastUserMessage.content, { topK: 3 });
        if (chunks.length > 0) {
          const context = buildRAGContext(chunks);
          systemPrompt += `\n\n${context}\n\nUse this context to inform your answer when relevant. Cite sources naturally (e.g., "According to the storytelling course...").`;
        }
      } catch (ragError) {
        console.warn("RAG search failed, continuing without context:", ragError);
      }
    }

    // Stream from Ollama
    const stream = await streamOllamaChat(messages, {
      model,
      system: systemPrompt,
    });

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
          controller.error(error);
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return new Response(error.message || "Chat failed", { status: 500 });
  }
}

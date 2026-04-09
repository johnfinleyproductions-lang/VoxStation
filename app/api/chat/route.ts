import { NextRequest } from "next/server";
import { searchRAG, buildRAGContext } from "@/lib/chat/rag-client";
import type { OllamaMessage } from "@/lib/chat/ollama-client";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
// Fallback to llama3.2:3b — NOT nemotron-3-nano:30b (24 GB — instant OOM)
// Set OLLAMA_MODEL in .env.local to override
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

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

    console.log("[chat] Messages:", messages.length, "useRAG:", useRAG);

    if (!messages || messages.length === 0) {
      return new Response("No messages provided", { status: 400 });
    }

    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");

    let systemPrompt = SYSTEM_PROMPT;

    // RAG retrieval
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
        console.warn("[chat] RAG failed, continuing without context:", ragError);
      }
    }

    // Build messages with system prompt
    const allMessages: OllamaMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const selectedModel = model || OLLAMA_MODEL;
    const ollamaUrl = `${OLLAMA_BASE_URL}/api/chat`;
    console.log("[chat] Fetching Ollama:", ollamaUrl, "model:", selectedModel);

    // Fetch Ollama directly — no intermediate ReadableStream
    const ollamaRes = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        model: selectedModel,
        messages: allMessages,
        stream: true,
        options: { temperature: 0.7 },
      }),
    });

    console.log("[chat] Ollama status:", ollamaRes.status);

    if (!ollamaRes.ok) {
      const err = await ollamaRes.text();
      console.error("[chat] Ollama error:", err);
      return new Response(`Ollama error: ${err}`, { status: 502 });
    }

    // Use TransformStream to convert Ollama NDJSON -> SSE
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Pipe in background — don't await
    const ollamaReader = ollamaRes.body!.getReader();
    (async () => {
      try {
        let buffer = "";
        while (true) {
          const { done, value } = await ollamaReader.read();
          if (done) {
            console.log("[chat] Ollama stream finished");
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            await writer.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              if (chunk.message?.content) {
                const sseData = `data: ${JSON.stringify({ content: chunk.message.content })}\n\n`;
                await writer.write(encoder.encode(sseData));
              }
              if (chunk.done) {
                console.log("[chat] Ollama done signal received");
                await writer.write(encoder.encode("data: [DONE]\n\n"));
                await writer.close();
                return;
              }
            } catch {
              // skip malformed JSON lines
            }
          }
        }
      } catch (error) {
        console.error("[chat] Stream pipe error:", error);
        try { await writer.abort(error as Error); } catch {}
      }
    })();

    console.log("[chat] Returning SSE response");
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("[chat] Fatal error:", error);
    return new Response(error.message || "Chat failed", { status: 500 });
  }
}

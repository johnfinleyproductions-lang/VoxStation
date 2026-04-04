"""
Ollama Client
==============
Streaming chat client for Ollama running on the Framestation.
Supports conversation history and system prompts.
"""

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://192.168.4.240:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:32b";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/**
 * Stream a chat completion from Ollama.
 * Returns a ReadableStream of text chunks.
 */
export async function streamOllamaChat(
  messages: OllamaMessage[],
  options?: {
    model?: string;
    temperature?: number;
    system?: string;
  }
): Promise<ReadableStream<string>> {
  const model = options?.model || OLLAMA_MODEL;

  // Prepend system message if provided and not already in messages
  const allMessages = [...messages];
  if (options?.system && allMessages[0]?.role !== "system") {
    allMessages.unshift({ role: "system", content: options.system });
  }

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: allMessages,
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama request failed: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const chunk: OllamaStreamChunk = JSON.parse(line);
          if (chunk.message?.content) {
            controller.enqueue(chunk.message.content);
          }
          if (chunk.done) {
            controller.close();
            return;
          }
        } catch {
          // Skip malformed lines
        }
      }
    },
  });
}

/**
 * Generate embeddings using Ollama.
 */
export async function generateEmbedding(
  text: string,
  model: string = "nomic-embed-text"
): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) throw new Error("Embedding generation failed");
  const data = await res.json();
  return data.embeddings[0];
}

/**
 * List available Ollama models.
 */
export async function listOllamaModels(): Promise<
  Array<{ name: string; size: number; modified_at: string }>
> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error("Failed to list Ollama models");
  const data = await res.json();
  return data.models;
}

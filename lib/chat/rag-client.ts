"""
RAG Client
===========
Query the Qdrant vector database for relevant course content.
Uses Ollama embeddings (nomic-embed-text) for query vectorization.
"""

import { generateEmbedding } from "./ollama-client";

const QDRANT_URL = process.env.QDRANT_URL || "http://192.168.4.240:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "evergreen_kb";

export interface RAGChunk {
  id: string;
  score: number;
  text: string;
  source: string;
  metadata: Record<string, any>;
}

/**
 * Search Qdrant for chunks relevant to the query.
 */
export async function searchRAG(
  query: string,
  options?: {
    collection?: string;
    topK?: number;
    scoreThreshold?: number;
  }
): Promise<RAGChunk[]> {
  const collection = options?.collection || QDRANT_COLLECTION;
  const topK = options?.topK || 5;
  const scoreThreshold = options?.scoreThreshold || 0.3;

  // Generate query embedding
  const queryVector = await generateEmbedding(query);

  // Search Qdrant
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vector: queryVector,
      limit: topK,
      score_threshold: scoreThreshold,
      with_payload: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant search failed: ${err}`);
  }

  const data = await res.json();

  return (data.result || []).map((point: any) => ({
    id: String(point.id),
    score: point.score,
    text: point.payload?.text || point.payload?.content || "",
    source: point.payload?.source || point.payload?.course || "unknown",
    metadata: point.payload || {},
  }));
}

/**
 * Build a context string from RAG results for the LLM prompt.
 */
export function buildRAGContext(chunks: RAGChunk[]): string {
  if (chunks.length === 0) return "";

  const contextParts = chunks.map((chunk, i) => {
    return `[Source ${i + 1}: ${chunk.source} (relevance: ${(chunk.score * 100).toFixed(0)}%)]\n${chunk.text}`;
  });

  return `Here is relevant context from the knowledge base:\n\n${contextParts.join("\n\n---\n\n")}`;
}

/**
 * Check if Qdrant is healthy and the collection exists.
 */
export async function checkRAGHealth(): Promise<{
  healthy: boolean;
  collection: string;
  points: number;
}> {
  try {
    const res = await fetch(
      `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`
    );
    if (!res.ok) return { healthy: false, collection: QDRANT_COLLECTION, points: 0 };
    const data = await res.json();
    return {
      healthy: true,
      collection: QDRANT_COLLECTION,
      points: data.result?.points_count || 0,
    };
  } catch {
    return { healthy: false, collection: QDRANT_COLLECTION, points: 0 };
  }
}

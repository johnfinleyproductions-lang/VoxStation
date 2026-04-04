"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { VoiceControls } from "@/components/voice/voice-controls";
import { StatusBar } from "@/components/layout/status-bar";
import { Mic, Settings, Zap } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioUrl?: string;
  timestamp: Date;
}

export default function VoxStationPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceId, setVoiceId] = useState("default");
  const [useRAG, setUseRAG] = useState(true);
  const [serviceStatus, setServiceStatus] = useState<{
    voice: boolean;
    ollama: boolean;
    rag: boolean;
  }>({ voice: false, ollama: false, rag: false });

  // Check service health on mount
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/voice/voices");
        setServiceStatus((s) => ({ ...s, voice: res.ok }));
      } catch {
        setServiceStatus((s) => ({ ...s, voice: false }));
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Send a text message and stream the response.
   */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Build history for Ollama
      const history = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      history.push({ role: "user", content: text });

      // Create placeholder for assistant response
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        },
      ]);

      try {
        // Stream chat response
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, useRAG }),
        });

        if (!res.ok) throw new Error("Chat request failed");

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n").filter(Boolean);

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullResponse += parsed.content;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: fullResponse }
                        : m
                    )
                  );
                }
              } catch {}
            }
          }
        }

        // TTS: Synthesize response with cloned voice
        if (voiceEnabled && fullResponse.trim()) {
          try {
            const ttsRes = await fetch("/api/voice/synthesize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: fullResponse,
                voice_id: voiceId,
              }),
            });

            if (ttsRes.ok) {
              const audioBlob = await ttsRes.blob();
              const audioUrl = URL.createObjectURL(audioBlob);

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, audioUrl } : m
                )
              );

              // Auto-play
              const audio = new Audio(audioUrl);
              audio.play().catch(() => {});
            }
          } catch (ttsError) {
            console.warn("TTS failed:", ttsError);
          }
        }
      } catch (error) {
        console.error("Chat error:", error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong. Check that the Framestation services are running." }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, isStreaming, voiceEnabled, voiceId, useRAG]
  );

  /**
   * Handle voice input from the mic button.
   */
  const handleVoiceInput = useCallback(
    async (audioBlob: Blob) => {
      setIsStreaming(true);
      try {
        // Transcribe
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");

        const transcribeRes = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!transcribeRes.ok) throw new Error("Transcription failed");
        const { text } = await transcribeRes.json();

        if (!text.trim()) {
          setIsStreaming(false);
          return;
        }

        // Send as chat message
        setIsStreaming(false);
        await sendMessage(text);
      } catch (error) {
        console.error("Voice input error:", error);
        setIsStreaming(false);
      }
    },
    [sendMessage]
  );

  return (
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--accent)]" />
            <h1 className="text-lg font-semibold">VoxStation</h1>
          </div>
          <span className="text-xs text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded">
            Local GPU
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* RAG toggle */}
          <button
            onClick={() => setUseRAG(!useRAG)}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              useRAG
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            RAG {useRAG ? "ON" : "OFF"}
          </button>

          {/* Voice toggle */}
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded transition-colors ${
              voiceEnabled
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            <Mic className="w-3 h-3" />
            Voice {voiceEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      {/* Chat area */}
      <ChatPanel
        messages={messages}
        isStreaming={isStreaming}
      />

      {/* Input area */}
      <VoiceControls
        onSendText={sendMessage}
        onVoiceInput={handleVoiceInput}
        voiceEnabled={voiceEnabled}
        isStreaming={isStreaming}
      />

      {/* Status bar */}
      <StatusBar status={serviceStatus} />
    </div>
  );
}

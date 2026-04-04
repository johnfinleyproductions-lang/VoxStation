"use client";

import { useRef, useEffect } from "react";
import type { Message } from "@/app/page";
import { MessageBubble } from "./message-bubble";

interface ChatPanelProps {
  messages: Message[];
  isStreaming: boolean;
}

export function ChatPanel({ messages, isStreaming }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mb-4">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--accent)]"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">VoxStation</h2>
            <p className="text-[var(--muted)] text-sm max-w-md">
              Speak or type to chat with your local AI. Responses are powered by
              Ollama + RAG on your Framestation GPU, and spoken back in your
              cloned voice.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-[var(--muted)] text-sm pl-2">
            <div className="flex gap-0.5 items-end h-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="voice-bar w-0.5 h-full bg-[var(--accent)] rounded-full origin-bottom"
                />
              ))}
            </div>
            <span>Thinking...</span>
          </div>
        )}
      </div>
    </div>
  );
}

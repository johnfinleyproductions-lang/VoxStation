"use client";

import { useState, useRef } from "react";
import type { Message } from "@/app/page";
import { Play, Pause, Volume2, User, Zap } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isUser = message.role === "user";

  const toggleAudio = () => {
    if (!message.audioUrl) return;

    if (!audioRef.current) {
      audioRef.current = new Audio(message.audioUrl);
      audioRef.current.onended = () => setIsPlaying(false);
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isUser
            ? "bg-[var(--surface)]"
            : "bg-[var(--accent)]/10"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-[var(--muted)]" />
        ) : (
          <Zap className="w-4 h-4 text-[var(--accent)]" />
        )}
      </div>

      {/* Content */}
      <div
        className={`flex-1 max-w-[80%] ${isUser ? "text-right" : ""}`}
      >
        <div
          className={`inline-block px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-[var(--accent)] text-white rounded-tr-md"
              : "bg-[var(--surface)] text-[var(--foreground)] rounded-tl-md"
          }`}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Audio playback */}
        {message.audioUrl && (
          <button
            onClick={toggleAudio}
            className="flex items-center gap-1.5 mt-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <Volume2 className="w-3 h-3" />
            <span>{isPlaying ? "Pause" : "Play"} audio</span>
          </button>
        )}
      </div>
    </div>
  );
}

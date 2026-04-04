"use client";

import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
import { VoiceRecorder } from "@/lib/voice/recorder";

interface VoiceControlsProps {
  onSendText: (text: string) => void;
  onVoiceInput: (audioBlob: Blob) => void;
  voiceEnabled: boolean;
  isStreaming: boolean;
}

export function VoiceControls({
  onSendText,
  onVoiceInput,
  voiceEnabled,
  isStreaming,
}: VoiceControlsProps) {
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSend = () => {
    if (inputText.trim() && !isStreaming) {
      onSendText(inputText.trim());
      setInputText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const recorder = new VoiceRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Microphone access denied. Please allow mic access in your browser.");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const { blob } = await recorderRef.current.stop();
      setIsRecording(false);
      setRecordingDuration(0);
      onVoiceInput(blob);
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setIsRecording(false);
    }

    recorderRef.current = null;
  }, [onVoiceInput]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="border-t border-[var(--border)] px-4 py-3">
      <div className="max-w-3xl mx-auto">
        {/* Recording indicator */}
        {isRecording && (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-red-500/10 rounded-lg">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-400">
              Recording... {formatDuration(recordingDuration)}
            </span>
            <button
              onClick={stopRecording}
              className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium"
            >
              Stop & Send
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Mic button */}
          {voiceEnabled && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isStreaming && !isRecording}
              className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                isRecording
                  ? "bg-red-500 text-white shadow-lg shadow-red-500/25 scale-110"
                  : isStreaming
                  ? "bg-[var(--surface)] text-[var(--muted)] cursor-not-allowed"
                  : "bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              {isRecording ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isRecording
                  ? "Recording..."
                  : voiceEnabled
                  ? "Type or hold mic to speak..."
                  : "Type your message..."
              }
              disabled={isRecording || isStreaming}
              rows={1}
              className="w-full bg-[var(--surface)] text-[var(--foreground)] placeholder-[var(--muted)] rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50"
              style={{ minHeight: "40px", maxHeight: "120px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isStreaming || isRecording}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              inputText.trim() && !isStreaming
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "bg-[var(--surface)] text-[var(--muted)] cursor-not-allowed"
            }`}
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        <p className="text-[10px] text-[var(--muted)] mt-2 text-center">
          VoxStation — Local AI on Framestation GPU. All processing happens on your hardware.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useCallback } from "react";
import { Mic, MicOff, Upload, Check, ArrowLeft, Loader2 } from "lucide-react";
import { VoiceRecorder } from "@/lib/voice/recorder";
import Link from "next/link";

export default function CloneVoicePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState("john");
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      setAudioUrl(null);
      setCloneResult(null);
      const recorder = new VoiceRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      setError("Microphone access denied. Please allow mic access in your browser settings.");
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
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError("Failed to stop recording.");
      setIsRecording(false);
    }
    recorderRef.current = null;
  }, []);

  const cloneVoice = useCallback(async () => {
    if (!audioBlob) return;
    setIsCloning(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("voice_id", voiceName.toLowerCase().replace(/\s+/g, "-"));
      formData.append("audio", audioBlob, "voice_sample.wav");
      formData.append("name", voiceName);
      formData.append("description", "Cloned from VoxStation web UI");

      const res = await fetch("/api/voice/clone", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Clone failed");
      }

      const result = await res.json();
      setCloneResult(result);
    } catch (err: any) {
      setError(err.message || "Voice cloning failed.");
    } finally {
      setIsCloning(false);
    }
  }, [audioBlob, voiceName]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Back link */}
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to VoxStation
        </Link>

        <h1 className="text-2xl font-bold mb-2">Clone Your Voice</h1>
        <p className="text-sm text-[var(--muted)] mb-8">
          Record 10-15 seconds of yourself speaking naturally. Read a paragraph,
          tell a story, or just talk. Chatterbox will use this sample to generate
          speech in your voice.
        </p>

        {/* Voice name input */}
        <div className="mb-6">
          <label className="text-xs text-[var(--muted)] mb-1 block">Voice Profile Name</label>
          <input
            type="text"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            className="w-full bg-[var(--surface)] text-[var(--foreground)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            placeholder="e.g. john"
          />
        </div>

        {/* Recording area */}
        <div className="bg-[var(--surface)] rounded-2xl p-8 flex flex-col items-center gap-6">
          {/* Big mic button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isCloning}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? "bg-red-500 text-white shadow-lg shadow-red-500/30 scale-110 animate-pulse"
                : "bg-[var(--accent)] text-white hover:scale-105 hover:shadow-lg hover:shadow-[var(--accent)]/30"
            }`}
          >
            {isRecording ? (
              <MicOff className="w-10 h-10" />
            ) : (
              <Mic className="w-10 h-10" />
            )}
          </button>

          {/* Status text */}
          {isRecording ? (
            <div className="text-center">
              <div className="flex items-center gap-2 justify-center mb-1">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-medium">
                  Recording {formatDuration(recordingDuration)}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">Click to stop when done</p>
            </div>
          ) : audioBlob ? (
            <div className="text-center">
              <p className="text-sm text-green-400 font-medium mb-2">Recording captured!</p>
              {audioUrl && (
                <audio controls src={audioUrl} className="mb-2" />
              )}
              <p className="text-xs text-[var(--muted)]">Listen back, then clone or re-record</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Tap to start recording</p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Clone button */}
        {audioBlob && !cloneResult && (
          <div className="mt-6 flex gap-3">
            <button
              onClick={startRecording}
              disabled={isCloning}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--surface)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--surface-hover)] transition-colors"
            >
              Re-record
            </button>
            <button
              onClick={cloneVoice}
              disabled={isCloning}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center gap-2"
            >
              {isCloning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Clone My Voice
                </>
              )}
            </button>
          </div>
        )}

        {/* Success */}
        {cloneResult && (
          <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-5 h-5 text-green-400" />
              <span className="text-green-400 font-medium">Voice cloned!</span>
            </div>
            <p className="text-sm text-[var(--muted)] mb-4">
              Profile "{cloneResult.name}" saved with {cloneResult.total_samples} sample(s).
              VoxStation will now respond in your voice.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setCloneResult(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--surface)] text-sm hover:bg-[var(--surface-hover)] transition-colors"
              >
                Add Another Sample
              </button>
              <Link
                href="/"
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm text-center hover:bg-[var(--accent-hover)] transition-colors"
              >
                Start Talking
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

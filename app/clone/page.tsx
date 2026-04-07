"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Upload, Check, ArrowLeft, Loader2, UserCircle, Trash2, Plus } from "lucide-react";
import { VoiceRecorder } from "@/lib/voice/recorder";
import Link from "next/link";

interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  sample_count: number;
  samples: string[];
}

export default function CloneVoicePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch existing voice profiles
  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/voices");
      if (res.ok) {
        const data = await res.json();
        setVoices(data.voices || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

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

    const targetId = selectedProfile || voiceName.toLowerCase().replace(/\s+/g, "-");
    const targetName = selectedProfile
      ? voices.find((v) => v.id === selectedProfile)?.name || selectedProfile
      : voiceName;

    if (!targetId.trim()) {
      setError("Please enter a voice profile name.");
      return;
    }

    setIsCloning(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("voice_id", targetId);
      formData.append("audio", audioBlob, "voice_sample.wav");
      formData.append("name", targetName);
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
      // Refresh voice list
      await fetchVoices();
    } catch (err: any) {
      setError(err.message || "Voice cloning failed.");
    } finally {
      setIsCloning(false);
    }
  }, [audioBlob, voiceName, selectedProfile, voices, fetchVoices]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const resetForNew = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setCloneResult(null);
    setError(null);
  };

  const startNewProfile = () => {
    setSelectedProfile(null);
    setIsCreatingNew(true);
    setVoiceName("");
    resetForNew();
  };

  const selectExistingProfile = (id: string) => {
    setSelectedProfile(id);
    setIsCreatingNew(false);
    resetForNew();
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col items-center p-6">
      <div className="w-full max-w-lg">
        {/* Back link */}
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to VoxStation
        </Link>

        <h1 className="text-2xl font-bold mb-2">Voice Profiles</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Create multiple voice profiles or add samples to improve an existing one.
          Each profile needs at least one 10-30 second recording of clear speech.
        </p>

        {/* Existing Profiles */}
        {voices.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium mb-3">Your Voices</h2>
            <div className="space-y-2">
              {voices.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => selectExistingProfile(voice.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all ${
                    selectedProfile === voice.id
                      ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30 ring-1 ring-[var(--accent)]/20"
                      : "bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <UserCircle className={`w-8 h-8 ${
                      selectedProfile === voice.id ? "text-[var(--accent)]" : "text-[var(--muted)]"
                    }`} />
                    <div>
                      <div className="font-medium text-sm">{voice.name}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {voice.sample_count} sample{voice.sample_count !== 1 ? "s" : ""}
                        {voice.description ? ` — ${voice.description}` : ""}
                      </div>
                    </div>
                  </div>
                  {selectedProfile === voice.id && (
                    <span className="text-xs text-[var(--accent)] font-medium">Add sample</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* New Profile Button */}
        <button
          onClick={startNewProfile}
          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all mb-6 ${
            isCreatingNew
              ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30 ring-1 ring-[var(--accent)]/20"
              : "bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-dashed border-[var(--border)]"
          }`}
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isCreatingNew ? "bg-[var(--accent)]/20" : "bg-[var(--surface-hover)]"
          }`}>
            <Plus className={`w-4 h-4 ${
              isCreatingNew ? "text-[var(--accent)]" : "text-[var(--muted)]"
            }`} />
          </div>
          <div>
            <div className="font-medium text-sm">New Voice Profile</div>
            <div className="text-xs text-[var(--muted)]">Clone a different person's voice</div>
          </div>
        </button>

        {/* New Profile Name Input */}
        {isCreatingNew && (
          <div className="mb-6">
            <label className="text-xs text-[var(--muted)] mb-1 block">Voice Profile Name</label>
            <input
              type="text"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              className="w-full bg-[var(--surface)] text-[var(--foreground)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              placeholder="e.g. john, sarah, morgan-freeman"
              autoFocus
            />
          </div>
        )}

        {/* Recording Area — only show when a profile is selected or creating new */}
        {(selectedProfile || isCreatingNew) && (
          <>
            <div className="bg-[var(--surface)] rounded-2xl p-8 flex flex-col items-center gap-6">
              <p className="text-xs text-[var(--muted)] text-center">
                {selectedProfile
                  ? `Adding a sample to "${voices.find((v) => v.id === selectedProfile)?.name || selectedProfile}"`
                  : `Recording for new profile "${voiceName || "..."}"` }
              </p>

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
                  disabled={isCloning || (!selectedProfile && !voiceName.trim())}
                  className="flex-1 px-4 py-3 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isCloning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      {selectedProfile ? "Add Sample" : "Clone Voice"}
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
                  <span className="text-green-400 font-medium">
                    {selectedProfile ? "Sample added!" : "Voice cloned!"}
                  </span>
                </div>
                <p className="text-sm text-[var(--muted)] mb-4">
                  Profile "{cloneResult.name}" now has {cloneResult.total_samples} sample(s).
                  {!selectedProfile && " VoxStation can now speak in this voice."}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={resetForNew}
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
          </>
        )}
      </div>
    </div>
  );
}

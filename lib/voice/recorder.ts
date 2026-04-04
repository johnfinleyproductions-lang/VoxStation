/**
 * Voice Recorder
 * ==============
 * WebAudio-based recording utilities for capturing mic input.
 * Returns audio as a Blob ready to send to the Whisper STT service.
 */

export type RecorderState = "idle" | "recording" | "processing";

export interface RecordingResult {
  blob: Blob;
  duration: number;
}

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime: number = 0;

  /**
   * Request mic permission and start recording.
   */
  async start(): Promise<void> {
    this.chunks = [];

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    });

    // Prefer webm/opus (smaller files, Whisper supports it)
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.start(100); // Collect data every 100ms
    this.startTime = Date.now();
  }

  /**
   * Stop recording and return the audio blob.
   */
  async stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("No active recording"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const duration = (Date.now() - this.startTime) / 1000;
        const blob = new Blob(this.chunks, {
          type: this.mediaRecorder?.mimeType || "audio/webm",
        });

        // Release mic
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.mediaRecorder = null;

        resolve({ blob, duration });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording without returning data.
   */
  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }

  /**
   * Check if currently recording.
   */
  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }
}

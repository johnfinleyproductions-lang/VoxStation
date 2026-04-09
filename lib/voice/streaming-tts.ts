/**
 * Streaming TTS
 * ==============
 * Plays audio sentence-by-sentence using the Web Audio API.
 *
 * How it works:
 *   1. As the LLM streams text, accumulate tokens into sentences.
 *   2. When a sentence is complete, immediately fire a TTS fetch for it.
 *   3. Use Web Audio API to schedule each audio chunk to play right after
 *      the previous one ends — seamless playback with no gaps.
 *
 * Why Web Audio API instead of new Audio():
 *   - Lets us precisely schedule buffers back-to-back (no gaps/overlaps).
 *   - Created synchronously inside the click handler → autoplay always allowed.
 *   - Works even if sentence 2 finishes before sentence 1 is done playing.
 *
 * Usage:
 *   // MUST be called synchronously inside a user gesture (click/keydown)
 *   const tts = new StreamingTTS("john");
 *
 *   // Called as each sentence arrives from the LLM stream:
 *   tts.speak("Hello there.");
 *   tts.speak("How can I help you today?");
 *
 *   // Stop and clean up:
 *   tts.stop();
 */

export class StreamingTTS {
  private ctx: AudioContext;
  private nextStartTime: number;
  private voiceId: string;
  private stopped = false;
  // Chain fetches in promise sequence so sentences never play out of order
  private chain: Promise<void> = Promise.resolve();

  constructor(voiceId: string) {
    this.voiceId = voiceId;
    // Create AudioContext synchronously — must happen inside user gesture
    // for browser autoplay policy to allow play() calls later.
    this.ctx = new AudioContext();
    this.nextStartTime = this.ctx.currentTime;
  }

  /** Queue a sentence for synthesis and playback. Non-blocking. */
  speak(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.stopped) return;
    // Chain onto previous fetch so order is preserved
    this.chain = this.chain.then(() => this._fetchAndSchedule(trimmed));
  }

  private async _fetchAndSchedule(text: string): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice_id: this.voiceId }),
      });

      if (!res.ok || this.stopped) return;

      const arrayBuffer = await res.arrayBuffer();
      if (this.stopped) return;

      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      if (this.stopped) return;

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.ctx.destination);

      // Schedule to start right after the previous sentence ends.
      // Add a tiny 30ms overlap buffer so there's never a gap.
      const startTime = Math.max(
        this.nextStartTime,
        this.ctx.currentTime + 0.03
      );
      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;
    } catch (err) {
      // Don't let one failed sentence kill the whole queue
      console.warn("[VoxStation TTS] Sentence failed:", err);
    }
  }

  /** Stop playback immediately and release audio resources. */
  stop(): void {
    this.stopped = true;
    try {
      this.ctx.close();
    } catch {}
  }

  /** Reset so the same instance can be reused for a new message. */
  reset(newVoiceId?: string): void {
    this.stop();
    this.stopped = false;
    if (newVoiceId) this.voiceId = newVoiceId;
    this.ctx = new AudioContext();
    this.nextStartTime = this.ctx.currentTime;
    this.chain = Promise.resolve();
  }

  get isActive(): boolean {
    return !this.stopped && this.ctx.state !== "closed";
  }
}

/**
 * Split accumulated streaming text into complete sentences + a remainder.
 *
 * @param text  - text buffer, may end mid-sentence
 * @returns     - { complete: string[], remainder: string }
 *
 * Example:
 *   extractCompleteSentences("Hello there. How are")
 *   → { complete: ["Hello there."], remainder: "How are" }
 */
export function extractCompleteSentences(text: string): {
  complete: string[];
  remainder: string;
} {
  // Match any text ending in . ! ? followed by whitespace (or end of string with punctuation)
  const pattern = /[^.!?]+[.!?]+[\s]*/g;
  const complete: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const sentence = match[0].trim();
    // Skip fragments shorter than 8 chars — avoids speaking "OK." or "No." alone
    if (sentence.length >= 8) {
      complete.push(sentence);
    }
    lastIndex = pattern.lastIndex;
  }

  return {
    complete,
    remainder: text.slice(lastIndex),
  };
}

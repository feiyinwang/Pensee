// One take from the microphone (SPECs/talk-notes-spec.md#recording). The web
// view records it with MediaRecorder: AAC in an .m4a on macOS (WebKit),
// Opus in a .webm where only that is offered (WebView2 on Windows). A level
// meter reads the same stream through an AnalyserNode.

export interface Take {
  blob: Blob;
  ext: "m4a" | "webm";
  startedAt: Date;
  seconds: number;
}

const FORMATS: { mime: string; ext: Take["ext"] }[] = [
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
];

/** Why the microphone can't be used, in the user's words. */
export function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Pensée can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.";
  if (name === "NotFoundError") return "No microphone was found.";
  return `The recording couldn't start: ${error instanceof Error ? error.message : String(error)}`;
}

export class Recorder {
  private readonly chunks: Blob[] = [];
  private readonly startedAt = new Date();
  private readonly started = performance.now();
  private levelFrame = 0;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly ext: Take["ext"],
    private readonly audioContext: AudioContext,
  ) {
    recorder.addEventListener("dataavailable", (e) => e.data.size && this.chunks.push(e.data));
  }

  /** Asks for the microphone (macOS prompts the first time) and starts recording. */
  static async start(onLevel: (level: number) => void): Promise<Recorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!format) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("This system can't record audio in a format Pensée saves.");
    }
    const recorder = new MediaRecorder(stream, { mimeType: format.mime });
    const audioContext = new AudioContext();
    const self = new Recorder(stream, recorder, format.ext, audioContext);
    self.meter(onLevel);
    // A chunk a second, so a crash loses at most the last second.
    recorder.start(1000);
    return self;
  }

  get seconds(): number {
    return (performance.now() - this.started) / 1000;
  }

  /** The input level, 0–1, about 30 times a second, for the pill's meter. */
  private meter(onLevel: (level: number) => void): void {
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.audioContext.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      this.levelFrame = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    };
    this.levelFrame = requestAnimationFrame(tick);
  }

  /** Ends the take and hands back its audio. */
  stop(): Promise<Take> {
    return new Promise((resolve, reject) => {
      this.recorder.addEventListener(
        "stop",
        () => {
          this.release();
          const blob = new Blob(this.chunks, { type: this.recorder.mimeType });
          if (!blob.size) return reject(new Error("Nothing was recorded."));
          resolve({ blob, ext: this.ext, startedAt: this.startedAt, seconds: this.seconds });
        },
        { once: true },
      );
      this.recorder.stop();
    });
  }

  /** Drops the take without saving it. */
  cancel(): void {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.release();
  }

  private release(): void {
    cancelAnimationFrame(this.levelFrame);
    for (const track of this.stream.getTracks()) track.stop();
    void this.audioContext.close();
  }
}

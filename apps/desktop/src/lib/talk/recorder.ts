// One take from the microphone (SPECs/talk-notes-spec.md#recording). The web
// view records it with MediaRecorder: AAC in an .m4a on macOS (WebKit),
// Opus in a .webm where only that is offered (WebView2 on Windows). A level
// meter reads the same stream through an AnalyserNode, and an AudioWorklet
// taps its samples, downsampled to 16 kHz, for Whisper.
import { createResampler } from "./resample";

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

/** The microphone itself was refused or missing (not a later step of starting). */
export class MicrophoneError extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/** Why the recording couldn't start, in the user's words. */
export function microphoneError(error: unknown): string {
  if (!(error instanceof MicrophoneError))
    return `The recording couldn't start: ${error instanceof Error ? error.message : String(error)}`;
  const name = error.reason instanceof DOMException ? error.reason.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Pensée can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.";
  if (name === "NotFoundError") return "No microphone was found.";
  return `The microphone couldn't be used: ${error.message}`;
}

/** Quieter than this reads as silence on the meter; louder than LOUD_DB fills it. */
const QUIET_DB = -55;
const LOUD_DB = -12;
/** Only zeros for this long from the start means the microphone isn't reaching Pensée. */
const SILENT_MS = 3000;

/**
 * The meter's level, 0–1, for an RMS amplitude. On a decibel scale, because
 * loudness is heard that way: speech sits around -35 to -15 dB (an RMS of
 * 0.02–0.2), which a linear scale squashes into the bottom fifth.
 */
export function meterLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)));
}

export class Recorder {
  private readonly chunks: Blob[] = [];
  private readonly startedAt = new Date();
  private readonly started = performance.now();
  private levelTimer: ReturnType<typeof setInterval> | undefined;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly ext: Take["ext"],
    private readonly audioContext: AudioContext,
  ) {
    recorder.addEventListener("dataavailable", (e) => e.data.size && this.chunks.push(e.data));
  }

  /** Asks for the microphone (macOS prompts the first time) and starts recording. */
  static async start(
    onLevel: (level: number) => void,
    onPcm?: (samples: Float32Array) => void,
    onSilent?: (silent: boolean) => void,
  ): Promise<Recorder> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      throw new MicrophoneError(error);
    }
    const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!format) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("This system can't record audio in a format Pensée saves.");
    }
    const recorder = new MediaRecorder(stream, { mimeType: format.mime });
    const audioContext = new AudioContext();
    const self = new Recorder(stream, recorder, format.ext, audioContext);
    try {
      self.meter(onLevel, onSilent);
      if (onPcm) await self.tap(onPcm);
      // A chunk a second, so a crash loses at most the last second.
      recorder.start(1000);
    } catch (error) {
      // The microphone is already open: close it before giving up.
      self.cancel();
      throw error;
    }
    return self;
  }

  get seconds(): number {
    return (performance.now() - this.started) / 1000;
  }

  /**
   * The input level, 0–1, about 30 times a second, for the pill's meter. And
   * `onSilent(true)` when nothing but exact zeros has come in for SILENT_MS:
   * macOS hands an app it hasn't let use the microphone a stream of zeros, not
   * an error, while even a quiet room is never exactly zero. Sound after that
   * sends `onSilent(false)`.
   */
  private meter(onLevel: (level: number) => void, onSilent?: (silent: boolean) => void): void {
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.audioContext.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let heard = false;
    let silent = false;
    // A timer, not animation frames: frames stop in a window that's behind
    // others, and the silence check must keep running there.
    const tick = () => {
      const now = performance.now();
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      onLevel(meterLevel(Math.sqrt(sum / samples.length)));
      if (sum > 0) {
        heard = true;
        if (silent) onSilent?.((silent = false));
      } else if (!heard && !silent && now - this.started >= SILENT_MS) {
        onSilent?.((silent = true));
      }
    };
    this.levelTimer = setInterval(tick, 33);
  }

  /** Sends the take's samples at 16 kHz mono to `onPcm`, about 10 times a second. */
  private async tap(onPcm: (samples: Float32Array) => void): Promise<void> {
    // From public/: a worklet is a script, and the app's CSP allows scripts only
    // from the app itself, not the data: URL a bundled small file becomes.
    await this.audioContext.audioWorklet.addModule("/pcm-worklet.js");
    const node = new AudioWorkletNode(this.audioContext, "pcm-tap");
    const resample = createResampler(this.audioContext.sampleRate);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const out = resample(e.data);
      if (out.length) onPcm(out);
    };
    this.audioContext.createMediaStreamSource(this.stream).connect(node);
    // A worklet only runs while connected onward; the destination gets silence from it.
    const mute = this.audioContext.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(this.audioContext.destination);
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
    clearInterval(this.levelTimer);
    for (const track of this.stream.getTracks()) track.stop();
    void this.audioContext.close();
  }
}

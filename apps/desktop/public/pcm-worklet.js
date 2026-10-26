// public/pcm-worklet.js, loaded by src/lib/talk/recorder.ts. Copies the microphone's samples off the audio thread, about every 100 ms,
// so the take can be transcribed from what was heard (SPECs/talk-notes-spec.md#transcription).
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(sampleRate / 10);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.buffer.length - this.filled);
        this.buffer.set(channel.subarray(i, i + n), this.filled);
        this.filled += n;
        i += n;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);

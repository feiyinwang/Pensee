/** Whisper's sample rate. */
export const WHISPER_RATE = 16_000;

/**
 * Downsamples mono audio to 16 kHz by averaging each output sample's span of
 * input samples (a box filter), which keeps speech clear without aliasing
 * the way dropping samples would. `carry` holds the fractional position
 * between calls, so consecutive chunks join without a seam.
 */
export function createResampler(fromRate: number): (input: Float32Array) => Float32Array {
  const step = fromRate / WHISPER_RATE;
  let pos = 0; // where the next output sample starts, in input samples, relative to `input`
  let tail = new Float32Array(0);
  return (chunk) => {
    const input = tail.length ? concat(tail, chunk) : chunk;
    const count = Math.floor((input.length - pos) / step);
    const out = new Float32Array(Math.max(0, count));
    for (let o = 0; o < count; o++) {
      const start = pos + o * step;
      const from = Math.floor(start);
      const to = Math.min(input.length, Math.floor(start + step));
      let sum = 0;
      for (let i = from; i < to; i++) sum += input[i];
      out[o] = to > from ? sum / (to - from) : (input[from] ?? 0);
    }
    const used = pos + count * step;
    const keepFrom = Math.floor(used);
    tail = input.slice(keepFrom);
    pos = used - keepFrom;
    return out;
  };
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

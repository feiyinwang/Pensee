import { useEffect, useRef } from "react";

/*
 * The painting hung as a cloth. It rests still; moving the mouse across it
 * sends a soft wave that grows with the cursor's speed and settles back flat.
 *
 * Adapted from canvas-ui's Cloth (`npx shadcn add @canvas-ui/cloth-react`).
 * That component captures live HTML through Chrome's experimental
 * HTML-in-Canvas API, so every other browser saw nothing. A painting is only
 * an image, so this version uploads the image as a WebGL texture and keeps
 * the original's wave simulation and fold lighting. It works wherever WebGL2
 * does (Safari 15+, Chrome, Firefox).
 *
 * How it works: a 97×97 grid of heights runs a damped wave equation on the
 * CPU (`stepSim`). The top edge is pinned, and the moving cursor lifts a
 * Gaussian bump that spreads as ripples (an optional travelling wind force
 * can push the rows too; it is off by default). Each
 * frame the heights become a mesh: z moves vertices toward or away from a
 * perspective camera, and the surface normals shade the folds (light side
 * brighter, far side darker). The mesh overshoots the frame by MARGIN on
 * every side, so its edges never show. Once the waves settle and the cursor
 * rests, the loop stops; the next mouse move over the painting wakes it.
 *
 * The cloth draws the same image its sibling <img> shows and reads that
 * image's object-position, so the framing matches at every breakpoint. The
 * <img> stays underneath as the first paint and the fallback: no WebGL2,
 * reduced motion or a lost context leave the still painting.
 */

export interface ClothOptions {
  /** Wind force driving the fabric. */
  wind: number;
  /** Playback speed of the motion. */
  speed: number;
  /** Height of the folds in CSS pixels. */
  amplitude: number;
  /** Strength of the cursor's wave at full speed (0 disables). */
  brush: number;
  /** Radius of the cursor's influence in CSS pixels. */
  brushSize: number;
  /** How quickly waves settle. */
  damping: number;
  /** Strength of the fold shading (0 to 1). */
  light: number;
  /** Strength of the sheen on fold crests (0 to 1). */
  sheen: number;
}

/** Still until the mouse moves; then a broad wave that settles quickly. */
const SUBTLE: ClothOptions = {
  wind: 0,
  speed: 0.35,
  amplitude: 21,
  brush: 2.55,
  brushSize: 290,
  damping: 2.15,
  light: 0.65,
  sheen: 0.08,
};

const SEG = 96;
const NODES = SEG + 1;
const DT = 1 / 120;
const WAVE_SPEED = 30;
const STIFFNESS = 0.55;
const FORCE_GAIN = 5;
/** How far the mesh overshoots the frame, so perspective never shows an edge. */
const MARGIN = 32;
const FOCAL = 1200;

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
layout(location = 1) in vec4 aData;
layout(location = 2) in vec2 aOffset;
uniform vec2 uOut;
uniform vec4 uMap;
out vec2 vUv;
out vec3 vNormal;
out float vFold;

void main () {
  vec2 rest = aGrid * uOut;
  // The texture follows the fabric, so it maps from the rest position.
  vUv = uMap.xy + (rest - ${MARGIN}.0) * uMap.zw;
  float z = aData.x;
  vec2 nxy = aData.yz;
  vNormal = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.04)));
  vFold = aData.w;
  vec2 ndc = ((rest + aOffset) / uOut) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, -z / ${FOCAL}.0, (${FOCAL}.0 - z) / ${FOCAL}.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in float vFold;
out vec4 outColor;
uniform sampler2D uImage;
uniform float uLight;
uniform float uSheen;

void main () {
  vec3 color = texture(uImage, clamp(vUv, 0.0, 1.0)).rgb;
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(-0.3, 0.42, 0.86));
  // Normalised so a flat cloth renders the painting exactly.
  float diffFlat = 0.58 + 0.42 * lightDir.z;
  float diff = 0.58 + 0.42 * dot(n, lightDir);
  vec3 lit = color * mix(1.0, (diff / diffFlat) * vFold, uLight);

  vec3 halfway = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float specFlat = pow(halfway.z, 34.0);
  float spec = max(pow(max(dot(n, halfway), 0.0), 34.0) - specFlat, 0.0) / (1.0 - specFlat);
  lit += uSheen * spec * mix(vec3(1.0), color, 0.35);

  outColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}`;

interface ClothInstance {
  setOptions: (next: Partial<ClothOptions>) => void;
  destroy: () => void;
}

function compile(gl: WebGL2RenderingContext, type: number, text: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Cloth: could not create a shader");
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Cloth shader: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/** Parse "40% 62%" (what getComputedStyle gives for object-position). */
function parseFocus(value: string): [number, number] {
  const [x = "50%", y = "50%"] = value.split(/\s+/);
  const pct = (part: string) => (part.endsWith("%") ? parseFloat(part) / 100 : 0.5);
  return [pct(x), pct(y)];
}

function createCloth(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  options: ClothOptions,
  onReady: () => void,
): ClothInstance | null {
  const config = { ...options };
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: true,
  });
  if (!gl) return null;

  const program = gl.createProgram();
  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Cloth program: ${gl.getProgramInfoLog(program)}`);
  }
  const uOut = gl.getUniformLocation(program, "uOut");
  const uMap = gl.getUniformLocation(program, "uMap");
  const uImage = gl.getUniformLocation(program, "uImage");
  const uLight = gl.getUniformLocation(program, "uLight");
  const uSheen = gl.getUniformLocation(program, "uSheen");

  const gridVerts = new Float32Array(NODES * NODES * 2);
  for (let y = 0; y < NODES; y++) {
    for (let x = 0; x < NODES; x++) {
      const i = (y * NODES + x) * 2;
      gridVerts[i] = x / SEG;
      gridVerts[i + 1] = y / SEG;
    }
  }
  const gridIndices = new Uint32Array(SEG * SEG * 6);
  let k = 0;
  for (let y = 0; y < SEG; y++) {
    for (let x = 0; x < SEG; x++) {
      const a = y * NODES + x;
      const c = a + NODES;
      gridIndices.set([a, c, a + 1, a + 1, c, c + 1], k);
      k += 6;
    }
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const gridBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, gridVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const dataBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  const offsetBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

  // Box size (the frame) and the cover crop that maps it onto the image.
  let boxW = 1;
  let boxH = 1;
  const map = new Float32Array(4);

  function syncSize() {
    boxW = Math.max(canvas.clientWidth - MARGIN * 2, 1);
    boxH = Math.max(canvas.clientHeight - MARGIN * 2, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // object-fit: cover with the <img>'s own object-position.
    const [fx, fy] = parseFocus(getComputedStyle(img).objectPosition);
    const scale = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;
    map[0] = -((boxW - drawnW) * fx) / drawnW;
    map[1] = -((boxH - drawnH) * fy) / drawnH;
    map[2] = 1 / drawnW;
    map[3] = 1 / drawnH;
  }

  let hCur = new Float32Array(NODES * NODES);
  let hPrev = new Float32Array(NODES * NODES);
  let hNext = new Float32Array(NODES * NODES);
  const vertexData = new Float32Array(NODES * NODES * 4);
  const offsetData = new Float32Array(NODES * NODES * 2);
  const zField = new Float32Array(NODES * NODES);
  const rowForce = new Float32Array(NODES);
  const colForce = new Float32Array(NODES);
  // Pinned at the top: the force grows toward the free bottom edge.
  const hangCurve = new Float32Array(NODES);
  for (let a = 0; a < NODES; a++) hangCurve[a] = Math.pow(a / SEG, 1.3);

  let simTime = Math.random() * 60;
  let gust = 0.5;
  const pointer = { x: -1e5, y: -1e5, inside: false };
  const touch = { x: -1e5, y: -1e5, vx: 0, vy: 0, s: 0 };
  // 0 to 1: how fast the cursor is moving, so a resting cursor leaves no dent.
  let stroke = 0;
  let fieldEnergy = 0;

  function stepSim(dt: number) {
    simTime += dt * Math.max(config.speed, 0);
    const t = simTime;
    const windAmp = FORCE_GAIN * Math.max(config.wind, 0) * gust;
    const kb1 = (Math.PI * 2) / (SEG / 1.5);
    const kb2 = (Math.PI * 2) / (SEG / 3.8);
    const ka = (Math.PI * 2) / (SEG / 2.2);
    const w1 = WAVE_SPEED * kb1;
    const w2 = WAVE_SPEED * kb2;
    const drift = 1.8 * Math.sin(0.23 * t);
    for (let b = 0; b < NODES; b++) {
      rowForce[b] =
        Math.sin(kb1 * b - w1 * t + drift) + 0.45 * Math.sin(kb2 * b + w2 * t * 0.8 + 3);
    }
    for (let a = 0; a < NODES; a++) {
      colForce[a] = (0.7 + 0.3 * Math.sin(ka * a - 1.7 * t)) * hangCurve[a];
    }

    const c2 = WAVE_SPEED * WAVE_SPEED;
    const dt2 = dt * dt;
    const decay = Math.exp(-Math.min(Math.max(config.damping, 0.05), 8) * dt);
    for (let y = 0; y < NODES; y++) {
      const up = Math.max(y - 1, 0) * NODES;
      const down = Math.min(y + 1, SEG) * NODES;
      const row = y * NODES;
      for (let x = 0; x < NODES; x++) {
        const i = row + x;
        const h = hCur[i];
        const lap =
          hCur[row + Math.max(x - 1, 0)] +
          hCur[row + Math.min(x + 1, SEG)] +
          hCur[up + x] +
          hCur[down + x] -
          4 * h;
        const acc = c2 * lap - STIFFNESS * h + windAmp * rowForce[x] * colForce[y];
        const next = 2 * h - hPrev[i] + dt2 * acc;
        const value = h + (next - h) * decay;
        hNext[i] = Math.max(-3.5, Math.min(3.5, value));
      }
    }
    for (let x = 0; x < NODES; x++) hNext[x] = 0;

    const spent = hPrev;
    hPrev = hCur;
    hCur = hNext;
    hNext = spent;
  }

  function touchImprint(delta: number, width: number, height: number) {
    const strength = touch.s * stroke;
    if (config.brush <= 0 || strength < 0.01) return;
    const cellW = width / SEG;
    const cellH = height / SEG;
    const radius = Math.max(config.brushSize, 12);
    const rx = radius / cellW;
    const ry = radius / cellH;
    const gx = touch.x / cellW;
    const gy = touch.y / cellH;
    const lift = 1.1 * Math.min(config.brush, 3) * strength;
    const rate = Math.min(delta * 4, 1);
    for (
      let y = Math.max(Math.ceil(gy - 2.5 * ry), 0);
      y <= Math.min(Math.floor(gy + 2.5 * ry), SEG);
      y++
    ) {
      const oy = (y - gy) / ry;
      for (
        let x = Math.max(Math.ceil(gx - 2.5 * rx), 0);
        x <= Math.min(Math.floor(gx + 2.5 * rx), SEG);
        x++
      ) {
        const ox = (x - gx) / rx;
        const g = Math.exp(-(ox * ox + oy * oy));
        if (g < 0.02) continue;
        const i = y * NODES + x;
        const pull = rate * g;
        const goal = lift * g;
        hCur[i] += (goal - hCur[i]) * pull;
        hPrev[i] += (goal - hPrev[i]) * pull;
      }
    }
  }

  /** A tilted cell covers less ground, so vertices pull in toward the anchor. */
  function foreshorten(
    axisStride: number,
    lineStride: number,
    ds: number,
    anchor: number,
    comp: number,
  ) {
    const ds2 = ds * ds;
    for (let l = 0; l < NODES; l++) {
      const base = l * lineStride;
      offsetData[(base + anchor * axisStride) * 2 + comp] = 0;
      let cum = 0;
      for (let j = anchor + 1; j < NODES; j++) {
        const i = base + j * axisStride;
        const dz = zField[i] - zField[i - axisStride];
        cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
        offsetData[i * 2 + comp] = -cum;
      }
      cum = 0;
      for (let j = anchor - 1; j >= 0; j--) {
        const i = base + j * axisStride;
        const dz = zField[i] - zField[i + axisStride];
        cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
        offsetData[i * 2 + comp] = cum;
      }
    }
  }

  function composeVertices(width: number, height: number) {
    const amp = Math.max(config.amplitude, 0);
    const cellW = width / SEG;
    const cellH = height / SEG;
    let energy = 0;
    for (let i = 0; i < NODES * NODES; i++) {
      energy = Math.max(energy, Math.abs(hCur[i]));
      zField[i] = amp * Math.tanh(hCur[i]);
    }
    fieldEnergy = energy;
    for (let y = 0; y < NODES; y++) {
      const up = Math.max(y - 1, 0) * NODES;
      const down = Math.min(y + 1, SEG) * NODES;
      const row = y * NODES;
      for (let x = 0; x < NODES; x++) {
        const i = row + x;
        const l = row + Math.max(x - 1, 0);
        const r = row + Math.min(x + 1, SEG);
        const dzdx = (zField[r] - zField[l]) / (2 * cellW);
        const dzdy = (zField[down + x] - zField[up + x]) / (2 * cellH);
        const inv = 1 / Math.hypot(dzdx, dzdy, 1);
        const curve = zField[l] + zField[r] + zField[up + x] + zField[down + x] - 4 * zField[i];
        const o = i * 4;
        vertexData[o] = zField[i];
        vertexData[o + 1] = -dzdx * inv;
        vertexData[o + 2] = -dzdy * inv;
        vertexData[o + 3] = Math.max(0.86, Math.min(1.06, 1 - curve * 0.01));
      }
    }
    foreshorten(NODES, 1, cellH, 0, 1);
    foreshorten(1, NODES, cellW, SEG >> 1, 0);
  }

  function render(width: number, height: number) {
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.useProgram(program);
    gl!.bindVertexArray(vao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, dataBuffer);
    gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, vertexData);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, offsetBuffer);
    gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, offsetData);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.uniform1i(uImage, 0);
    gl!.uniform2f(uOut, width, height);
    gl!.uniform4fv(uMap, map);
    gl!.uniform1f(uLight, Math.min(Math.max(config.light, 0), 1));
    gl!.uniform1f(uSheen, Math.max(config.sheen, 0));
    gl!.drawElements(gl!.TRIANGLES, gridIndices.length, gl!.UNSIGNED_INT, 0);
    gl!.bindVertexArray(null);
  }

  let raf = 0;
  let lastTime = performance.now();
  let simDebt = 0;
  let visible = true;
  let ready = false;

  function frame(now: number) {
    raf = 0;
    if (!visible) return;
    const delta = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    // The mesh spans the whole canvas, margin included.
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);

    const t = simTime;
    const target = Math.max(
      0.55 +
        0.35 * Math.sin(t * 0.31 + 1.3) +
        0.25 * Math.sin(t * 0.83) * (0.5 + 0.5 * Math.sin(t * 0.17)),
      0.15,
    );
    gust += (target - gust) * Math.min(delta * 2, 1);

    touch.s +=
      ((pointer.inside ? 1 : 0) - touch.s) * Math.min(delta * (pointer.inside ? 8 : 2.5), 1);
    // A critically damped spring trails the cursor, so a stroke leaves a wake.
    const omega = 14;
    touch.vx += ((pointer.x - touch.x) * omega * omega - 2 * omega * touch.vx) * delta;
    touch.vy += ((pointer.y - touch.y) * omega * omega - 2 * omega * touch.vy) * delta;
    touch.x += touch.vx * delta;
    touch.y += touch.vy * delta;
    // Rise fast with a stroke, fall slower, so the wave trails off.
    const speed = Math.min(Math.hypot(touch.vx, touch.vy) / 500, 1);
    stroke += (speed - stroke) * Math.min(delta * (speed > stroke ? 12 : 4), 1);
    touchImprint(delta, width, height);

    simDebt = Math.min(simDebt + delta, DT * 5);
    while (simDebt >= DT) {
      stepSim(DT);
      simDebt -= DT;
    }

    composeVertices(width, height);
    render(width, height);
    if (!ready) {
      ready = true;
      onReady();
    }
    // Calm cloth, no wind, resting cursor: stop until the mouse moves again.
    if (config.wind <= 0 && fieldEnergy < 0.004 && stroke < 0.01) return;
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf || !visible) return;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  syncSize();
  start();

  const resize = new ResizeObserver(() => {
    syncSize();
    start();
  });
  resize.observe(canvas);

  // Stop simulating once the hero scrolls away.
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(canvas);

  // The words sit above the painting, so listen on the window and place the
  // pointer in the canvas's own coordinates.
  function onPointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const inside =
      x >= MARGIN && y >= MARGIN && x <= rect.width - MARGIN && y <= rect.height - MARGIN;
    if (inside && touch.s < 0.01) {
      touch.x = x;
      touch.y = y;
      touch.vx = 0;
      touch.vy = 0;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.inside = inside;
    if (inside) start();
  }
  function onPointerLeave() {
    pointer.inside = false;
  }
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);

  return {
    setOptions(next) {
      Object.assign(config, next);
      start();
    },
    destroy() {
      cancelAnimationFrame(raf);
      resize.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      gl!.deleteTexture(texture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vert);
      gl!.deleteShader(frag);
      gl!.deleteBuffer(gridBuffer);
      gl!.deleteBuffer(dataBuffer);
      gl!.deleteBuffer(offsetBuffer);
      gl!.deleteBuffer(indexBuffer);
      gl!.deleteVertexArray(vao);
    },
  };
}

/** Put inside a <Painting>: it hangs that painting's image as cloth. */
export function Cloth(props: Partial<ClothOptions>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ClothInstance | null>(null);
  const options = { ...SUBTLE, ...props };
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = canvas?.parentElement?.querySelector("img");
    if (!canvas || !img) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;

    function mount() {
      if (cancelled || instanceRef.current || motion.matches || !canvas || !img) return;
      instanceRef.current = createCloth(canvas, img, optionsRef.current, () => {
        canvas.dataset.ready = "";
      });
      if (import.meta.env.DEV) Object.assign(canvas, { cloth: instanceRef.current });
    }
    function unmount() {
      instanceRef.current?.destroy();
      instanceRef.current = null;
      delete canvas!.dataset.ready;
    }
    function onMotionChange() {
      if (motion.matches) unmount();
      else mount();
    }
    function onContextLost() {
      unmount();
    }

    img.decode().then(mount, () => {});
    motion.addEventListener("change", onMotionChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => {
      cancelled = true;
      motion.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      unmount();
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return <canvas ref={canvasRef} className="cloth" aria-hidden="true" />;
}

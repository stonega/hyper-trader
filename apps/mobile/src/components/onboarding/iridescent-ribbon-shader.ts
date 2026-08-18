import type { ExpoWebGLRenderingContext } from "expo-gl";

export type RgbColor = readonly [number, number, number];

export interface RibbonShaderPalette {
  readonly background: RgbColor;
  readonly surface: RgbColor;
  readonly accent: RgbColor;
  readonly foreground: RgbColor;
  readonly dark: boolean;
}

export interface RibbonMotion {
  readonly flowOffset: number;
  readonly swayPhase: number;
}

const FLOW_UNITS_PER_SECOND = 0.052;
const SWAY_RADIANS_PER_SECOND = 0.58;

export function ribbonMotionAt(elapsedSeconds: number): RibbonMotion {
  const elapsed = Math.max(0, elapsedSeconds);
  return {
    flowOffset: elapsed * FLOW_UNITS_PER_SECOND,
    swayPhase: elapsed * SWAY_RADIANS_PER_SECOND,
  };
}

const VERTEX_SOURCE = `
  attribute vec2 aPosition;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = `
  precision highp float;

  uniform vec2 uResolution;
  uniform vec2 uMotion;
  uniform float uDark;
  uniform vec3 uBackground;
  uniform vec3 uSurface;
  uniform vec3 uAccent;
  uniform vec3 uForeground;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);

    return mix(
      mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
      mix(
        hash21(cell + vec2(0.0, 1.0)),
        hash21(cell + vec2(1.0, 1.0)),
        local.x
      ),
      local.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);

    for (int octave = 0; octave < 3; octave++) {
      value += amplitude * noise(p);
      p = rotation * p * 2.03 + 13.17;
      amplitude *= 0.5;
    }

    return value;
  }

  float organicRidge(float value, float sharpness) {
    return pow(1.0 - abs(value * 2.0 - 1.0), sharpness);
  }

  vec3 spectrum(float phase) {
    vec3 spectral = 0.58 + 0.42 * cos(
      TAU * (phase + vec3(0.02, 0.34, 0.67))
    );
    return pow(max(spectral, 0.0), vec3(0.86));
  }

  vec3 materialRamp(float value) {
    float position = clamp(value, 0.0, 1.0);
    vec3 foam = mix(uSurface, uAccent, 0.13);
    vec3 mint = mix(uAccent, vec3(0.62, 1.0, 0.86), 0.34);
    vec3 cyan = mix(uAccent, vec3(0.02, 0.72, 0.94), 0.38);
    vec3 cobalt = mix(uAccent, vec3(0.04, 0.10, 0.62), 0.52);
    vec3 violet = mix(uAccent, vec3(0.52, 0.12, 0.72), 0.36);
    vec3 amber = mix(uAccent, vec3(1.0, 0.57, 0.12), 0.34);

    vec3 color = amber;
    color = mix(color, violet, smoothstep(0.08, 0.22, position));
    color = mix(color, cobalt, smoothstep(0.25, 0.43, position));
    color = mix(color, uAccent, smoothstep(0.46, 0.63, position));
    color = mix(color, cyan, smoothstep(0.66, 0.80, position));
    color = mix(color, mint, smoothstep(0.82, 0.93, position));
    return mix(color, foam, smoothstep(0.94, 1.0, position));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    float x = uv.x;
    float y = 1.0 - uv.y;
    float flowY = y + uMotion.x;
    float crossDrift = uMotion.x * 0.48;

    // The arc keeps the copy-heavy left side calm while carrying color from
    // the top edge, around the right side, and back into the lower-left.
    float curve = clamp((y + 0.015) / 1.03, 0.0, 1.0);
    float centerline = 0.04 + 0.88 * sin(PI * pow(curve, 0.90));
    centerline -= 0.30 * smoothstep(0.60, 0.82, y);
    centerline += 0.20 * smoothstep(0.86, 1.0, y);
    float silhouetteSway = sin(uMotion.y + y * 5.4) * 0.024
      + sin(uMotion.y * 0.43 - y * 3.2) * 0.012;
    centerline += silhouetteSway;

    float broadFlow = fbm(vec2(flowY * 2.25, crossDrift));
    float fineFlow = noise(vec2(flowY * 9.0, crossDrift * 2.0));
    float bend = (broadFlow - 0.47) * 0.048
      + (fineFlow - 0.5) * 0.011
      + sin(flowY * 12.0) * 0.005;

    float distanceFromCenter = x - centerline - bend;
    float width = mix(0.14, 0.29, 1.0 - smoothstep(0.52, 0.94, y));
    width += 0.09 * smoothstep(0.67, 0.82, y)
      * (1.0 - smoothstep(0.93, 1.0, y));

    float body = exp(
      -1.48 * pow((distanceFromCenter - 0.07) / width, 2.0)
    );
    body *= smoothstep(-0.11, 0.035, distanceFromCenter);

    float topPlume = exp(-y * 5.4)
      * smoothstep(0.04, 0.28, x)
      * (1.0 - smoothstep(0.88, 1.10, x));
    float bottomPlume = exp(-pow((y - 0.93) / 0.12, 2.0))
      * exp(-pow((x - 0.17) / 0.42, 2.0));

    float normalCoordinate = distanceFromCenter / max(width, 0.001);
    float flowNoise = fbm(vec2(
      flowY * 2.28,
      normalCoordinate * 2.05 + crossDrift
    ));
    float warp = fbm(vec2(
      flowY * 1.26 + crossDrift,
      normalCoordinate * 4.0 + flowNoise * 0.70
    ));
    float paletteCoordinate = normalCoordinate * 0.67 + 0.06
      + (flowNoise - 0.47) * 0.28
      + (warp - 0.47) * 0.30;
    paletteCoordinate += 0.16 * smoothstep(0.49, 0.72, y)
      * (1.0 - smoothstep(0.84, 0.97, y));

    vec3 material = materialRamp(paletteCoordinate);
    float upperDepth = exp(-pow((y - 0.14) / 0.30, 2.0))
      * smoothstep(0.22, 0.88, x);
    float materialStrength = clamp(
      0.58 + upperDepth * 0.25 + body * 0.08 + uDark * 0.08,
      0.0,
      0.90
    );
    vec3 pearl = mix(uSurface, material, materialStrength);

    float broadField = noise(vec2(
      flowY * 1.56 + warp * 0.26,
      paletteCoordinate * 7.0 + warp * 1.28
    ));
    float fineField = noise(vec2(
      flowY * 2.95 + crossDrift,
      paletteCoordinate * 22.0 + warp * 2.9
    ));
    float hairField = noise(vec2(
      flowY * 5.0 - crossDrift,
      paletteCoordinate * 49.0 + flowNoise * 4.3
    ));
    float broadCaustic = organicRidge(broadField, 8.0);
    float fineCaustic = organicRidge(fineField, 13.0);
    float hairCaustic = organicRidge(hairField, 18.0);
    float turnDepth = exp(-pow((y - 0.62) / 0.27, 2.0));
    float causticEnvelope = body * (
      0.38 + warp * 0.44 + turnDepth * 0.56
    );
    float caustics = clamp(
      (
        broadCaustic * 0.44
        + fineCaustic * 0.27
        + hairCaustic * 0.13
      ) * causticEnvelope,
      0.0,
      0.70
    );
    vec3 highlight = mix(vec3(1.0), uForeground, uDark * 0.20);
    pearl = mix(pearl, highlight, caustics);

    vec3 thinFilm = spectrum(
      paletteCoordinate * 0.34 + fineField * 0.22 + flowY * 0.03
    );
    thinFilm = mix(thinFilm, uAccent, 0.44);
    pearl = mix(
      pearl,
      thinFilm,
      body * (0.045 + hairCaustic * 0.055 + turnDepth * 0.045)
    );

    float shadowField = noise(vec2(
      flowY * 2.0 + 0.37,
      paletteCoordinate * 11.0 + warp * 2.0 + 0.41
    ));
    float pinchDepth = exp(-pow((y - 0.54) / 0.25, 2.0));
    float shadowThread = organicRidge(shadowField, 11.0)
      * body
      * (0.045 + upperDepth * 0.07 + pinchDepth * 0.11);
    vec3 threadColor = mix(uAccent, uForeground, 0.42);
    pearl = mix(pearl, threadColor, shadowThread);

    float rimOffset = (
      noise(vec2(flowY * 4.8, crossDrift)) - 0.5
    ) * 0.005;
    float rim = exp(-pow((distanceFromCenter - rimOffset) / 0.012, 2.0));
    vec3 rimColor = mix(
      mix(uAccent, vec3(1.0, 0.62, 0.16), 0.30),
      mix(uAccent, vec3(0.04, 0.12, 0.68), 0.48),
      smoothstep(0.20, 0.66, y)
    );

    float coverage = clamp(
      body * (0.56 + flowNoise * 0.20 + uDark * 0.08)
      + topPlume * (0.28 + uDark * 0.08)
      + bottomPlume * (0.18 + uDark * 0.06),
      0.0,
      0.89
    );

    float ambientGlow = exp(-pow((x - 0.92) / 0.43, 2.0))
      * exp(-pow((y - 0.18) / 0.44, 2.0));
    vec3 color = mix(uBackground, uAccent, ambientGlow * (0.045 + uDark * 0.06));
    color = mix(color, pearl, coverage);
    color = mix(color, rimColor, rim * body * (0.34 + uDark * 0.08));

    color += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

function compileShader(
  gl: ExpoWebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function showFallback(
  gl: ExpoWebGLRenderingContext,
  background: RgbColor,
): void {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(background[0], background[1], background[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.endFrameEXP();
}

export function startIridescentRibbonShader(
  gl: ExpoWebGLRenderingContext,
  palette: RibbonShaderPalette,
  reducedMotion: boolean,
): () => void {
  showFallback(gl, palette.background);

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  if (vertexShader === null || fragmentShader === null) {
    if (vertexShader !== null) gl.deleteShader(vertexShader);
    if (fragmentShader !== null) gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return () => undefined;
  }

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const resolutionLocation = gl.getUniformLocation(program, "uResolution");
  const motionLocation = gl.getUniformLocation(program, "uMotion");
  const darkLocation = gl.getUniformLocation(program, "uDark");
  const backgroundLocation = gl.getUniformLocation(program, "uBackground");
  const surfaceLocation = gl.getUniformLocation(program, "uSurface");
  const accentLocation = gl.getUniformLocation(program, "uAccent");
  const foregroundLocation = gl.getUniformLocation(program, "uForeground");
  const vertexBuffer = gl.createBuffer();

  if (
    positionLocation < 0 ||
    resolutionLocation === null ||
    motionLocation === null ||
    darkLocation === null ||
    backgroundLocation === null ||
    surfaceLocation === null ||
    accentLocation === null ||
    foregroundLocation === null ||
    vertexBuffer === null
  ) {
    if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
    gl.deleteProgram(program);
    return () => undefined;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  // Biome treats any member named `use*` as a potential React hook. This is
  // WebGL's program-binding API and is intentionally called after validation.
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
  gl.useProgram(program);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(darkLocation, palette.dark ? 1 : 0);
  gl.uniform3fv(backgroundLocation, palette.background);
  gl.uniform3fv(surfaceLocation, palette.surface);
  gl.uniform3fv(accentLocation, palette.accent);
  gl.uniform3fv(foregroundLocation, palette.foreground);

  let stopped = false;
  let animationFrame: number | null = null;
  let lastPaintedAt = Number.NEGATIVE_INFINITY;
  const startedAt = performance.now();

  const draw = (elapsedSeconds: number): void => {
    const motion = ribbonMotionAt(elapsedSeconds);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(
      resolutionLocation,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    );
    gl.uniform2f(motionLocation, motion.flowOffset, motion.swayPhase);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
    gl.endFrameEXP();
  };

  const renderFrame = (now: number): void => {
    if (stopped) return;
    if (now - lastPaintedAt >= 1000 / 30) {
      draw((now - startedAt) / 1000);
      lastPaintedAt = now;
    }
    animationFrame = requestAnimationFrame(renderFrame);
  };

  draw(0);
  if (!reducedMotion) {
    animationFrame = requestAnimationFrame(renderFrame);
  }

  return () => {
    stopped = true;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  };
}

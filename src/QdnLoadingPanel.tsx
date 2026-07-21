import { useEffect, useRef, useState } from 'react';

import { t } from './i18n';

// The QDN loading experience, shared by every viewer kind. It deliberately
// mirrors Core's gateway splash (qortium-core
// src/main/resources/loading/index.html) so a resource that Home is fetching
// and the same resource opened through the gateway look like the same product:
// a centred frosted panel with a ring spinner, an accent-coloured status line,
// a chunk progress bar and a hexagon-forming particle field behind it.
//
// The splash has to hard-copy Home's palette as hex literals because it lives
// in Core with no access to this stylesheet. Here we use the real tokens, so
// theme, accent and uiStyle (classic/modern/fun) all follow for free.

// The particle field is a fullscreen effect in the splash. Home renders it
// inside a viewer pane that can be a narrow git-preview column or a short
// archive entry strip, where a 250-line field is illegible noise behind the
// panel and simply burns frames. Below this size we drop the canvas entirely
// and keep the panel, which is self-sufficient. The threshold is roughly the
// point at which the field is wider/taller than the panel it sits behind
// (the panel maxes out at 30em ~ 480px and is ~220px tall).
const MIN_FIELD_WIDTH = 320;
const MIN_FIELD_HEIGHT = 240;

function parseCssColor(value: string): [number, number, number] | undefined {
  const input = value.trim();

  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(input);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((character) => character + character)
            .join('')
        : digits;
    const int = Number.parseInt(full, 16);

    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  // Tokens are authored as hex today, but getComputedStyle hands back whatever
  // text the custom property holds, so tolerate the rgb() forms too.
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(input);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return undefined;
}

// Hue only — the field picks its own saturation/lightness so it stays legible
// against both page backgrounds, exactly as the splash does.
function rgbToHue([red, green, blue]: [number, number, number]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);

  return hue < 0 ? hue + 360 : hue;
}

interface FieldPalette {
  accentHue: number;
  pageBgRgb: string;
  pageBg: string;
  dark: boolean;
}

function readFieldPalette(): FieldPalette {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const accent = parseCssColor(styles.getPropertyValue('--color-accent')) ?? [33, 130, 74];
  const pageBg = parseCssColor(styles.getPropertyValue('--color-page-bg')) ?? [247, 245, 239];

  return {
    accentHue: rgbToHue(accent),
    pageBgRgb: pageBg.join(','),
    pageBg: `rgb(${pageBg.join(',')})`,
    dark: root.dataset.theme === 'dark',
  };
}

// Neon hexagon-forming particles, ported from the Core splash, which in turn
// carries this notice:
//
//   Copyright (c) 2021 by Matei Copot (https://codepen.io/towc/pen/mJzOWJ)
//   Released under the MIT licence; see the full text in
//   qortium-core/src/main/resources/loading/index.html.
function startParticleField(canvas: HTMLCanvasElement, palette: FieldPalette) {
  const context = canvas.getContext('2d');

  if (!context) {
    return () => {};
  }

  // Re-bound as a non-nullable const so the closures and class methods below
  // keep the narrowing from the guard above.
  const draw: CanvasRenderingContext2D = context;

  const opts = {
    len: 40,
    count: 250,
    baseTime: 40,
    addedTime: 10,
    dieChance: 0.05,
    spawnChance: 1,
    sparkChance: 0,
    sparkDist: 10,
    sparkSize: 2,
    color: 'hsl(hue,100%,light%)',
    baseLight: 50,
    addedLight: 10,
    shadowToTimePropMult: 1,
    baseLightInputMultiplier: 0.01,
    addedLightInputMultiplier: 0.02,
    cx: 0,
    cy: 0,
    repaintAlpha: 0.04,
    startColor: palette.accentHue,
    hueChange: 0.001,
  };

  const baseRad = (Math.PI * 2) / 6;
  let width = 0;
  let height = 0;
  let dieX = 0;
  let dieY = 0;
  let tick = 0;
  let frameId = 0;

  class Line {
    x = 0;
    y = 0;
    addedX = 0;
    addedY = 0;
    rad = Math.PI / 2;
    lightInputMultiplier = 0;
    color = '';
    cumulativeTime = 0;
    time = 0;
    targetTime = 0;

    constructor() {
      this.reset();
    }

    reset() {
      this.x = 0;
      this.y = 0;
      this.addedX = 0;
      this.addedY = 0;
      this.rad = Math.PI / 2;
      this.lightInputMultiplier =
        opts.baseLightInputMultiplier + opts.addedLightInputMultiplier * Math.random();
      this.color = opts.color.replace('hue', String(tick * opts.hueChange + opts.startColor));
      this.cumulativeTime = 0;
      this.beginPhase();
    }

    beginPhase() {
      this.x += this.addedX;
      this.y += this.addedY;
      this.time = 0;
      this.targetTime = (opts.baseTime + opts.addedTime * Math.random()) | 0;
      this.rad += baseRad * (Math.random() < 0.5 ? 1 : -1);
      this.addedX = Math.cos(this.rad);
      this.addedY = Math.sin(this.rad);

      if (
        Math.random() < opts.dieChance ||
        this.x > dieX ||
        this.x < -dieX ||
        this.y > dieY ||
        this.y < -dieY
      ) {
        this.reset();
      }
    }

    step() {
      this.time += 1;
      this.cumulativeTime += 1;

      if (this.time >= this.targetTime) {
        this.beginPhase();
      }

      const prop = this.time / this.targetTime;
      const wave = Math.sin((prop * Math.PI) / 2);
      const x = this.addedX * wave;
      const y = this.addedY * wave;

      draw.shadowBlur = prop * opts.shadowToTimePropMult;
      draw.fillStyle = draw.shadowColor = this.color.replace(
        'light',
        String(opts.baseLight + opts.addedLight * Math.sin(this.cumulativeTime * this.lightInputMultiplier)),
      );
      draw.fillRect(opts.cx + (this.x + x) * opts.len, opts.cy + (this.y + y) * opts.len, 2, 2);

      if (Math.random() < opts.sparkChance) {
        draw.fillRect(
          opts.cx +
            (this.x + x) * opts.len +
            Math.random() * opts.sparkDist * (Math.random() < 0.5 ? 1 : -1) -
            opts.sparkSize / 2,
          opts.cy +
            (this.y + y) * opts.len +
            Math.random() * opts.sparkDist * (Math.random() < 0.5 ? 1 : -1) -
            opts.sparkSize / 2,
          opts.sparkSize,
          opts.sparkSize,
        );
      }
    }
  }

  const lines: Line[] = [];

  function resize() {
    width = canvas.width = Math.max(1, canvas.clientWidth);
    height = canvas.height = Math.max(1, canvas.clientHeight);
    opts.cx = width / 2;
    opts.cy = height / 2;
    dieX = width / 2 / opts.len;
    dieY = height / 2 / opts.len;
    draw.fillStyle = palette.pageBg;
    draw.fillRect(0, 0, width, height);
  }

  function loop() {
    frameId = window.requestAnimationFrame(loop);
    tick += 1;

    draw.globalCompositeOperation = 'source-over';
    draw.shadowBlur = 0;

    // Fade toward the page background so the field dissolves into the shell
    // rather than toward pure black/white.
    draw.fillStyle = `rgba(${palette.pageBgRgb},${opts.repaintAlpha})`;
    draw.fillRect(0, 0, width, height);
    // Additive on dark, 'darken' on light, matching the splash. The op matters:
    // 'source-over' here makes the light field ~40x denser than Core's
    // (22803 vs 522 lit pixels measured on an identical 1100x760 canvas).
    draw.globalCompositeOperation = palette.dark ? 'lighter' : 'darken';

    if (lines.length < opts.count && Math.random() < opts.spawnChance) {
      lines.push(new Line());
    }

    for (const line of lines) {
      line.step();
    }
  }

  resize();
  loop();

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  return () => {
    // A leaked RAF per viewer mount compounds across tabs, so this teardown is
    // load-bearing, not hygiene.
    window.cancelAnimationFrame(frameId);
    observer.disconnect();
  };
}

function useParticleField(enabled: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Bumped when the shell's theme/accent/uiStyle changes so the field restarts
  // against the new palette instead of staying on the old hue.
  const [paletteEpoch, setPaletteEpoch] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setPaletteEpoch((epoch) => epoch + 1));
    observer.observe(root, { attributeFilter: ['data-theme', 'data-accent', 'data-ui'] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!enabled || !canvas) {
      return;
    }

    return startParticleField(canvas, readFieldPalette());
  }, [enabled, paletteEpoch]);

  return canvasRef;
}

// True unless the OS asks for reduced motion. The field can sit animating for
// minutes while chunks arrive, so under the preference we skip the loop
// entirely rather than merely hiding the canvas.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    setReduced(query.matches);

    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// Tracks whether the pane is large enough to be worth drawing a particle field
// into. Starts false so a pane that never grows past the threshold never spins
// the loop up at all.
function useFieldFits(ref: React.RefObject<HTMLDivElement | null>) {
  const [fits, setFits] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const measure = () => {
      const { clientWidth, clientHeight } = element;
      setFits(clientWidth >= MIN_FIELD_WIDTH && clientHeight >= MIN_FIELD_HEIGHT);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return fits;
}

export function QdnLoadingPanel({
  className,
  message,
  progress,
  progressText,
}: {
  className?: string;
  /** The status line Home has already computed (formatQdnStatus, or a local one). */
  message: string;
  /** 0-100 chunk progress from getStatusProgress; omitted when unknown. */
  progress?: number;
  /** The "N / M files" secondary line from getProgressText. */
  progressText?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const fieldFits = useFieldFits(rootRef);
  const showField = fieldFits && !reducedMotion;
  const canvasRef = useParticleField(showField);
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);

  return (
    <div className={`qdn-loading${className ? ` ${className}` : ''}`} ref={rootRef}>
      {showField ? <canvas aria-hidden="true" className="qdn-loading__field" ref={canvasRef} /> : null}

      <div className="qdn-loading__panel">
        <div className="qdn-loading__spinner-row">
          <div aria-hidden="true" className="qdn-loading__spinner" />
        </div>

        <p className="qdn-loading__status" role="status">
          {message}
        </p>

        {hasProgress ? (
          <div
            aria-label={t('viewer.progressAriaLabel')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progress)}
            className="qdn-loading__progress"
            role="progressbar"
          >
            <span className="qdn-loading__progress-fill" style={{ width: `${progress}%` }} />
          </div>
        ) : null}

        {progressText ? <p className="qdn-loading__progress-text">{progressText}</p> : null}
      </div>
    </div>
  );
}

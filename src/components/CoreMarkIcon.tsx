export type CoreMarkVariant = 'minting' | 'synced' | 'syncing' | 'unavailable';

type CoreMarkIconProps = {
  size?: number;
  variant: CoreMarkVariant;
};

// Geometry mirrors the Qortium Core tray icon: a pointy-top hexagon with six
// aperture blades; each blade extends one inner-hexagon edge out to the rim.
const OUTER_HEXAGON = '16,2 28.12,9 28.12,23 16,30 3.88,23 3.88,9';
const INNER_HEXAGON = '16,10.2 21.02,13.1 21.02,18.9 16,21.8 10.98,18.9 10.98,13.1';
const BLADE = 'M10.98 18.9 L10.98 4.9';
const BLADE_ROTATIONS = [0, 60, 120, 180, 240, 300];

const INK = '#0b0d0d';
const PAPER = '#ffffff';
const DISABLED = '#8a9191';

function ApertureBlades({ color, width }: { color: string; width: number }) {
  return (
    <g stroke={color} strokeWidth={width} strokeLinecap="butt" fill="none">
      {BLADE_ROTATIONS.map((angle) => (
        <path key={angle} d={BLADE} transform={angle ? `rotate(${angle} 16 16)` : undefined} />
      ))}
    </g>
  );
}

export function CoreMarkIcon({ size = 20, variant }: CoreMarkIconProps) {
  const isSolid = variant === 'syncing';
  const markColor = variant === 'unavailable' ? DISABLED : INK;

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="presentation"
      focusable="false"
    >
      {isSolid ? (
        <>
          <polygon points={OUTER_HEXAGON} fill={INK} stroke={PAPER} strokeWidth={1} />
          <ApertureBlades color={PAPER} width={1.4} />
        </>
      ) : (
        <>
          <polygon points={OUTER_HEXAGON} fill={PAPER} stroke={markColor} strokeWidth={1.4} />
          <ApertureBlades color={markColor} width={1.8} />
          {variant === 'synced' ? <polygon points={INNER_HEXAGON} fill={INK} /> : null}
        </>
      )}
      {variant === 'unavailable' ? (
        <g strokeLinecap="round" fill="none">
          <path d="M7.5 7.5 L24.5 24.5 M24.5 7.5 L7.5 24.5" stroke={PAPER} strokeWidth={4.6} />
          <path d="M7.5 7.5 L24.5 24.5 M24.5 7.5 L7.5 24.5" stroke="currentColor" strokeWidth={2.4} />
        </g>
      ) : null}
    </svg>
  );
}

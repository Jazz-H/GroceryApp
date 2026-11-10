/**
 * Line icons in one style (24px grid, 2px stroke, round caps), sized by the caller.
 * Decorative by default; give the button an aria-label instead.
 */
type P = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const CloseIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const CameraIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3 8h3l2-3h8l2 3h3v12H3z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const BarcodeIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
  </svg>
);

export const RecipeIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M6 13.9A4 4 0 0 1 7.5 6a5 5 0 0 1 9 0A4 4 0 0 1 18 13.9V20H6zM6 17h12" />
  </svg>
);

export const TrendIcon = ({ up, size = 14 }: P & { up: boolean }) => (
  <svg {...base(size)}>
    <path d={up ? 'M4 16l6-6 4 4 6-7M14 7h6v6' : 'M4 8l6 6 4-4 6 7M14 17h6v-6'} />
  </svg>
);

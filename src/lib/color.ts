/** Marker color helpers. Pastels are stored as-is and shown raw in dark mode; light mode gets a deeper ink. */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ink for writing on the white board: the same hue, darkened until it's readable
 * (3:1 against white, the bar for large text). Already-dark colors come back unchanged.
 */
export function inkFor(hex: string): string {
  if (contrast(hex, '#ffffff') >= 3) return hex;
  const [h, s0, l0] = rgbToHsl(hexToRgb(hex));
  const s = Math.max(s0, 0.55); // keep pastels from turning gray as they darken
  for (let l = Math.min(l0, 0.6); l > 0.1; l -= 0.01) {
    const candidate = hslToHex(h, s, l);
    if (contrast(candidate, '#ffffff') >= 3.2) return candidate;
  }
  return hslToHex(h, s, 0.3);
}

/** Text color to put on top of a marker color (avatars). */
export function textOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#12304f' : '#ffffff';
}

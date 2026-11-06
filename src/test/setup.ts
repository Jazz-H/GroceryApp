/**
 * Shared setup for tests. `setupFiles` runs for every test file, but only the
 * component tests need a DOM — so everything DOM-related here is behind a
 * check for one, and the testing-library imports are dynamic so the ten pure
 * lib test files never pay to load them.
 *
 * Component tests select the DOM with a `// @vitest-environment jsdom`
 * docblock; see the comment in vite.config.ts for why that is per-file rather
 * than a global setting.
 */
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  // `globals` is deliberately off in this repo — every test imports what it
  // uses — so React Testing Library's automatic cleanup never registers
  // itself. Without this, components stay mounted between tests in the same
  // file and an unmount assertion would be measuring the previous render.
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);

  await import('@testing-library/jest-dom/vitest');

  // jsdom implements the <canvas> element but not its 2D context: getContext()
  // returns null and anything drawing to it throws. ReceiptFlow's PhotoEditor
  // paints each photo to a canvas on mount, so a component test cannot render
  // it at all without this. The stub records nothing — these tests are about
  // lifecycle and behaviour, never pixels. If a future test needs to assert on
  // what was drawn, give it a per-test spy rather than widening this.
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      drawImage() {},
      fillRect() {},
      clearRect() {},
      set fillStyle(_v: string) {},
      get fillStyle() {
        return '#000';
      },
    };
  } as unknown as HTMLCanvasElement['getContext'];

  // Used by exportPhoto when the receipt is sent for parsing.
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,stub';
}

// @vitest-environment jsdom
/**
 * ReceiptFlow's ImageBitmap lifecycle.
 *
 * An ImageBitmap holds decoded image memory that the GC will not reclaim — it
 * has to be closed explicitly. ReceiptFlow accepts up to six full-resolution
 * phone photos, so getting this wrong leaks several hundred MB per receipt.
 *
 * The bug this file exists for: the unmount cleanup used to be
 *
 *     useEffect(() => () => photos.forEach((p) => p.bitmap.close()), [])
 *
 * with `react-hooks/exhaustive-deps` suppressed. The empty dependency array
 * meant the closure captured `photos` as it was at mount — an empty array — so
 * it closed nothing, ever. It was only noticed when ESLint was finally
 * installed and the suppression audited.
 *
 * These tests drive the component the way a user does (pick files, remove a
 * photo, close the sheet) rather than reaching into its internals, so they
 * stay valid if the ref-based implementation is replaced by another correct one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReceiptFlow } from './ReceiptFlow';
import type { Household } from '../types';

// Both pull in Firebase at import time; neither is exercised by these tests.
vi.mock('../data/receipts', () => ({ saveReceipt: vi.fn() }));
vi.mock('../data/receiptParser', () => ({
  parseReceiptImages: vi.fn(),
  ParseError: class ParseError extends Error {},
}));

/** An ImageBitmap stand-in whose close() can be asserted on. */
function fakeBitmap() {
  return { width: 1200, height: 2400, close: vi.fn() };
}

const bitmaps: ReturnType<typeof fakeBitmap>[] = [];

beforeEach(() => {
  bitmaps.length = 0;
  // jsdom has no createImageBitmap. One fresh fake per file handed to the
  // component, kept here so the test can assert on close() afterwards.
  vi.stubGlobal('createImageBitmap', async () => {
    const b = fakeBitmap();
    bitmaps.push(b);
    return b;
  });
});

const HOUSEHOLD = { id: 'h1', name: 'Home', members: ['u1'] } as unknown as Household;

function renderFlow() {
  const result = render(
    <ReceiptFlow
      household={HOUSEHOLD}
      uid="u1"
      items={[]}
      aliases={new Map()}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  const input = result.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found — the photos step did not render');
  return { ...result, input };
}

function file(name: string) {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** Picks files the way the hidden input receives them, and waits for the state update. */
async function addPhotos(input: HTMLInputElement, ...names: string[]) {
  fireEvent.change(input, { target: { files: names.map(file) } });
  // addFiles awaits createImageBitmap per file before setState.
  await vi.waitFor(() => expect(bitmaps).toHaveLength(names.length));
  await screen.findByText(/Hide card info:/);
}

describe('ReceiptFlow bitmap lifecycle', () => {
  it('closes every open bitmap when the flow unmounts', async () => {
    const { input, unmount } = renderFlow();
    await addPhotos(input, 'a.jpg', 'b.jpg', 'c.jpg');

    // Nothing closed while the flow is open and the photos are still in use.
    expect(bitmaps.map((b) => b.close.mock.calls.length)).toEqual([0, 0, 0]);

    unmount();

    // This is the assertion the old code failed: it closed none of them.
    for (const [i, b] of bitmaps.entries()) {
      expect(b.close, `bitmap ${i} was never closed`).toHaveBeenCalledTimes(1);
    }
  });

  it('closes a removed photo immediately, and does not close it twice on unmount', async () => {
    const { input, unmount } = renderFlow();
    await addPhotos(input, 'a.jpg', 'b.jpg');

    fireEvent.click(screen.getAllByRole('button', { name: /remove photo/i })[0]);
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).not.toHaveBeenCalled();

    unmount();

    // The removed one must not be closed again — double-closing is why the
    // cleanup reads live state instead of a mount-time snapshot.
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
  });

  it('unmounting with no photos closes nothing and does not throw', () => {
    const { unmount } = renderFlow();
    expect(() => unmount()).not.toThrow();
    expect(bitmaps).toHaveLength(0);
  });
});

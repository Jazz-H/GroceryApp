import { useEffect, useRef, useState } from 'react';
import { lookupBarcode, rememberBarcode } from '../data/barcodes';
import { isProductCode, normalizeCode } from '../lib/barcode';
import { CloseIcon } from './icons';
import { Button } from './ui/button';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * The phone's own barcode reader when it has one (Android Chrome), otherwise a WebAssembly
 * reader (iPhone Safari). The wasm file is bundled with the app, so nothing comes from a CDN.
 */
async function makeDetector(): Promise<Detector> {
  const Native = (
    window as unknown as {
      BarcodeDetector?: {
        new (o: object): Detector;
        getSupportedFormats?: () => Promise<string[]>;
      };
    }
  ).BarcodeDetector;
  if (Native) {
    const supported = (await Native.getSupportedFormats?.().catch(() => [])) ?? [];
    if (FORMATS.some((f) => supported.includes(f))) return new Native({ formats: FORMATS });
  }
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasm.default : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
}

type Found =
  | { state: 'looking'; code: string }
  | { state: 'found'; code: string; name: string; known: boolean }
  | { state: 'unknown'; code: string };

/** Full-screen camera that reads a product barcode and turns it into an item name. */
export function BarcodeScanner({
  hid,
  onName,
  onClose,
}: {
  hid: string;
  onName: (name: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  const paused = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!alive || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => undefined);
        if (alive) setReady(true);
        const detector = await makeDetector();
        const tick = async () => {
          if (!alive) return;
          const v = video.current;
          if (!paused.current && v && v.readyState >= 2) {
            const codes = await detector.detect(v).catch(() => []);
            const hit = codes.map((c) => c.rawValue).find(isProductCode);
            if (hit) {
              paused.current = true;
              navigator.vibrate?.(40);
              const code = normalizeCode(hit);
              setFound({ state: 'looking', code });
              const res = await lookupBarcode(hid, code);
              if (!alive) return;
              if (res) {
                setName(res.name);
                setFound({
                  state: 'found',
                  code,
                  name: res.name,
                  known: res.source === 'remembered',
                });
              } else {
                setName('');
                setFound({ state: 'unknown', code });
              }
            }
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (e) {
        const msg = (e as Error).name;
        setError(
          msg === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for Stocked in your phone’s settings, then try again.'
            : msg === 'NotFoundError'
              ? 'No camera found on this device.'
              : `Couldn’t start the camera: ${(e as Error).message}`,
        );
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [hid]);

  function scanAgain() {
    setFound(null);
    setName('');
    paused.current = false;
  }

  async function use() {
    if (!found || found.state === 'looking' || !name.trim()) return;
    await rememberBarcode(hid, found.code, name.trim()).catch(() => undefined);
    onName(name.trim());
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <div className="scanner-top">
        <h2 id="scanner-title">Scan a barcode</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close scanner">
          <CloseIcon />
        </Button>
      </div>
      {error ? (
        <p className="error scanner-error" role="alert">
          {error}
        </p>
      ) : (
        <div className="scanner-view">
          <video ref={video} playsInline muted aria-label="Camera" />
          {!found && ready && <div className="scanner-frame" aria-hidden="true" />}
          {!ready && (
            <p className="scanner-starting" role="status">
              Starting the camera…
            </p>
          )}
        </div>
      )}
      {!found && !error && (
        <p className="scanner-hint">Point the camera at the barcode on the package.</p>
      )}
      {found && (
        <div className="scanner-result" role="status">
          {found.state === 'looking' ? (
            <p>Looking up {found.code}…</p>
          ) : (
            <>
              <p className="muted">
                {found.state === 'found'
                  ? found.known
                    ? 'You’ve scanned this before.'
                    : 'Found it. Edit the name if you like.'
                  : `Not in the product database (${found.code}). What is it?`}
              </p>
              <label htmlFor="scan-name" className="sr-only">
                Item name
              </label>
              <input
                id="scan-name"
                value={name}
                autoFocus={found.state === 'unknown'}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chobani strawberry yogurt"
              />
              <div className="row-actions">
                <Button onClick={use} disabled={!name.trim()}>
                  Add to list
                </Button>
                <Button variant="secondary" onClick={scanAgain}>
                  Scan another
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

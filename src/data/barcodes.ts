import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { nameFromOff, normalizeCode } from '../lib/barcode';

const ref = (hid: string, code: string) =>
  doc(db, 'households', hid, 'barcodes', normalizeCode(code));

export type BarcodeLookup = { name: string; source: 'remembered' | 'openfoodfacts' } | null;

/**
 * What a scanned code is: a name you've used for it before, or Open Food Facts' name for it
 * (a free, open product database). Null when neither knows it.
 */
export async function lookupBarcode(hid: string, code: string): Promise<BarcodeLookup> {
  const saved = await getDoc(ref(hid, code)).catch(() => null);
  const name = saved?.exists() ? String(saved.data().name ?? '') : '';
  if (name) return { name, source: 'remembered' };
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_en,generic_name,brands,quantity`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: number;
      product?: Parameters<typeof nameFromOff>[0];
    };
    const off = body.status === 1 ? nameFromOff(body.product) : null;
    return off ? { name: off, source: 'openfoodfacts' } : null;
  } catch {
    return null;
  }
}

/** Remembers what you call this barcode, so the next scan fills it in instantly. */
export async function rememberBarcode(hid: string, code: string, name: string): Promise<void> {
  await setDoc(ref(hid, code), { name: name.slice(0, 120), at: serverTimestamp() });
}

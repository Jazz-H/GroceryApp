import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const settlements = (hid: string) => collection(db, 'households', hid, 'settlements');

/** Records that `from` paid `to` back. */
export async function recordSettlement(
  hid: string,
  by: string,
  from: string,
  to: string,
  cents: number,
): Promise<void> {
  await addDoc(settlements(hid), { from, to, cents: Math.round(cents), by, at: serverTimestamp() });
}

export async function undoSettlement(hid: string, id: string): Promise<void> {
  await deleteDoc(doc(settlements(hid), id));
}

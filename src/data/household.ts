import {
  arrayUnion,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import { DEFAULT_ZONE_ORDER, MEMBER_COLORS } from '../lib/stores';
import { cleanInviteCode, makeInviteCode } from '../lib/text';
import type { Household, Member, StoreId } from '../types';

function memberFor(user: User, color: string): Member {
  const name = (user.displayName ?? user.email ?? 'Me').split(' ')[0];
  return { name, color, ...(user.photoURL ? { photoURL: user.photoURL } : {}) };
}

export async function createHousehold(user: User, name: string, zip: string): Promise<string> {
  const ref = doc(db, 'households', crypto.randomUUID());
  const code = makeInviteCode();
  const batch = writeBatch(db);
  batch.set(ref, {
    name: name.trim() || 'Home',
    memberIds: [user.uid],
    members: { [user.uid]: memberFor(user, MEMBER_COLORS[0]) },
    inviteCode: code,
    zip: zip.trim(),
    zoneOrder: DEFAULT_ZONE_ORDER,
  });
  batch.set(doc(db, 'invites', code), { householdId: ref.id, createdBy: user.uid });
  batch.set(doc(db, 'users', user.uid), { householdId: ref.id }, { merge: true });
  await batch.commit();
  return ref.id;
}

export class InviteError extends Error {}

export async function joinHousehold(user: User, rawCode: string): Promise<string> {
  const code = cleanInviteCode(rawCode);
  if (code.length !== 6) throw new InviteError('Invite codes are 6 letters and numbers.');
  const invite = await getDoc(doc(db, 'invites', code));
  if (!invite.exists())
    throw new InviteError('That code didn’t match a household. Check it and try again.');
  const hid = String(invite.data().householdId);
  // We can't read the household until we're in it, so pick the second marker color.
  try {
    await updateDoc(doc(db, 'households', hid), {
      memberIds: arrayUnion(user.uid),
      [`members.${user.uid}`]: memberFor(user, MEMBER_COLORS[1]),
      joinCode: code,
    });
  } catch {
    throw new InviteError(
      'That code is no longer valid, or the household is full. Ask for a new code.',
    );
  }
  await setDoc(doc(db, 'users', user.uid), { householdId: hid }, { merge: true });
  return hid;
}

/** Replaces the invite code so an old one stops working. */
export async function rotateInviteCode(household: Household, uid: string): Promise<void> {
  const code = makeInviteCode();
  const batch = writeBatch(db);
  batch.update(doc(db, 'households', household.id), { inviteCode: code });
  batch.set(doc(db, 'invites', code), { householdId: household.id, createdBy: uid });
  await batch.commit();
  await deleteDoc(doc(db, 'invites', household.inviteCode)).catch(() => undefined);
}

export async function updateMember(household: Household, uid: string, patch: Partial<Member>) {
  const current = household.members[uid] ?? { name: 'Me', color: MEMBER_COLORS[0] };
  await updateDoc(doc(db, 'households', household.id), {
    [`members.${uid}`]: { ...current, ...patch },
  });
}

export async function updateZoneOrder(household: Household, store: StoreId, order: string[]) {
  await updateDoc(doc(db, 'households', household.id), { [`zoneOrder.${store}`]: order });
}

export async function renameHousehold(household: Household, name: string) {
  await updateDoc(doc(db, 'households', household.id), {
    name: name.trim().slice(0, 60) || 'Home',
  });
}

export async function leaveHousehold(household: Household, uid: string) {
  await updateDoc(doc(db, 'households', household.id), {
    memberIds: household.memberIds.filter((m) => m !== uid),
  });
  await setDoc(doc(db, 'users', uid), { householdId: null }, { merge: true });
}

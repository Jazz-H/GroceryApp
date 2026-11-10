import { app, usingEmulators } from '../firebase';

/** Override in .env.local if Google retires this model or you want a different one. */
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.6-flash';

const PROMPT = `You are reading photos of ONE grocery receipt or order screenshot (several photos are parts of the same receipt, in order). Return JSON only.

store: "ht" for Harris Teeter, "target" for Target, "amazon" for Amazon or Whole Foods via Amazon, otherwise "other".
date: purchase date as YYYY-MM-DD, or "" if you can't see it.
lines: every purchased product, in printed order.
  raw: the text exactly as printed, e.g. "HT ORG SPINACH 10Z".
  name: a short plain-English name a person would write on a list, e.g. "Organic spinach".
  qty: how many units (weighed items count as 1).
  total: what that line cost in dollars AFTER any discount printed directly under it (VIC, Circle, coupons). Fold those discounts into the line instead of listing them separately.
subtotal, tax, total: in dollars, as printed (0 if not printed).
savings: total discounts in dollars as a positive number (0 if none).
payments: how it was paid, one entry per tender line near the bottom (e.g. "VISA ****1234  $20.00").
  card: the card or tender name as printed, e.g. "Visa", "Target Circle Card", "Gift card", "Cash".
  last4: ONLY the last 4 digits as printed after the asterisks or X's, or "" if none are printed.
  amount: dollars charged to it.

Include bag fees and bottle deposits as lines only if they were charged. Never return more than the last 4 digits of any card, and never include member or loyalty numbers, names, addresses or phone numbers. Do not invent lines you can't read.`;

async function responseSchema() {
  const { Schema } = await import('firebase/ai');
  const money = () => Schema.number();
  return Schema.object({
    properties: {
      store: Schema.enumString({ enum: ['ht', 'target', 'amazon', 'other'] }),
      date: Schema.string(),
      lines: Schema.array({
        items: Schema.object({
          properties: {
            raw: Schema.string(),
            name: Schema.string(),
            qty: Schema.integer(),
            total: money(),
          },
        }),
      }),
      subtotal: money(),
      tax: money(),
      savings: money(),
      total: money(),
      payments: Schema.array({
        items: Schema.object({
          properties: {
            card: Schema.string(),
            last4: Schema.string(),
            amount: money(),
          },
        }),
      }),
    },
    optionalProperties: ['payments'],
  });
}

export class ParseError extends Error {}

/**
 * Sends receipt photos (base64 JPEG, with anything the user blacked out burned in) to Gemini through
 * Firebase AI Logic and returns its raw JSON answer. Against the local emulators there's no
 * Gemini, so a sample receipt comes back instead.
 */
export async function parseReceiptImages(jpegsBase64: string[]): Promise<unknown> {
  if (usingEmulators) return sampleReceipt();
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: await responseSchema(),
      temperature: 0,
    },
  });
  let text: string;
  try {
    const result = await model.generateContent([
      PROMPT,
      ...jpegsBase64.map((data) => ({ inlineData: { data, mimeType: 'image/jpeg' } })),
    ]);
    text = result.response.text();
  } catch (e) {
    throw new ParseError(explain(e));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ParseError('Gemini’s answer wasn’t readable. Try again, or with a sharper photo.');
  }
}

function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/api-not-enabled|firebasevertexai|firebaseml|AI Logic|PERMISSION_DENIED|403/i.test(msg))
    return 'Receipt reading isn’t turned on for this Firebase project yet. In the Firebase console, open AI Logic and choose Get started with the Gemini Developer API.';
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg))
    return 'Gemini’s free daily limit is used up. Try again later, or enter the receipt by hand.';
  if (/not found|404/i.test(msg))
    return `The Gemini model “${MODEL}” isn’t available. Set VITE_GEMINI_MODEL in .env.local to a current Flash model.`;
  if (/network|fetch|offline/i.test(msg) || !navigator.onLine)
    return 'Reading a receipt needs a connection. Try again when you’re back online.';
  return `Couldn’t read the receipt: ${msg}`;
}

function sampleReceipt() {
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          store: 'ht',
          date: `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`,
          lines: [
            { raw: 'HT ORG SPINACH 10Z', name: 'Organic spinach', qty: 1, total: 3.99 },
            { raw: 'BANANAS', name: 'Bananas', qty: 1, total: 1.42 },
            { raw: 'OATLY OAT MLK 64Z', name: 'Oat milk', qty: 2, total: 9.18 },
            { raw: 'HT LG EGGS 12CT', name: 'Large eggs', qty: 1, total: 3.49 },
            { raw: 'TIDE PODS 42CT', name: 'Tide pods', qty: 1, total: 13.99 },
          ],
          subtotal: 32.07,
          tax: 1.62,
          savings: 2.5,
          total: 33.69,
          payments: [{ card: 'Visa', last4: '4242', amount: 33.69 }],
        }),
      600,
    ),
  );
}

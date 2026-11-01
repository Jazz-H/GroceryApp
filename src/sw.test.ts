import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Loads public/push-sw.js into a fake service worker scope. */
function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: {
    title: string;
    options: { body: string; tag: string; data: { items: string[] } };
  }[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    location: { origin: 'https://fridgeboard.web.app' },
    registration: {
      getNotifications: async ({ tag }: { tag: string }) =>
        shown
          .filter((n) => n.options.tag === tag)
          .map((n) => ({ data: n.options.data, close: () => shown.splice(shown.indexOf(n), 1) })),
      showNotification: async (title: string, options: (typeof shown)[number]['options']) => {
        shown.push({ title, options });
      },
    },
    clients: { matchAll: async () => [], openWindow: async () => null },
  };
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL });

  async function push(data: object) {
    let done: Promise<unknown> = Promise.resolve();
    handlers.push({
      data: { json: () => data, text: () => JSON.stringify(data) },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
  }
  return { push, shown };
}

describe('push service worker', () => {
  it('merges quick adds from the same person into one notification', async () => {
    const sw = loadWorker();
    await sw.push({
      kind: 'adds',
      actor: 'Sam',
      items: ['Eggs'],
      title: 'Sam added Eggs',
      tag: 'adds-sam',
    });
    await sw.push({
      kind: 'adds',
      actor: 'Sam',
      items: ['Milk', 'Bread', 'Eggs'],
      title: 'x',
      tag: 'adds-sam',
    });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('Sam added 3 items');
    expect(sw.shown[0].options.body).toBe('Eggs, Milk, Bread');
  });

  it('shows trip notifications as sent', async () => {
    const sw = loadWorker();
    await sw.push({
      kind: 'trip',
      title: 'Alex is at Harris Teeter',
      body: 'Shopping solo with 6 items.',
      tag: 'trip-ht',
    });
    expect(sw.shown[0]).toMatchObject({
      title: 'Alex is at Harris Teeter',
      options: { body: 'Shopping solo with 6 items.' },
    });
  });
});

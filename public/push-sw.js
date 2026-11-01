/* Fridgeboard push handling. Loaded into the generated service worker via importScripts. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Fridgeboard', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const tag = data.tag || data.kind || 'fridgeboard';
      let title = data.title || 'Fridgeboard';
      let body = data.body || '';
      let items = Array.isArray(data.items) ? data.items : [];

      // Several quick adds become one notification: "Sam added 5 items".
      if (data.kind === 'adds' && data.actor) {
        const existing = await self.registration.getNotifications({ tag });
        for (const n of existing) {
          const prev = (n.data && n.data.items) || [];
          items = prev.concat(items.filter((i) => !prev.includes(i)));
          n.close();
        }
        title =
          items.length > 1
            ? `${data.actor} added ${items.length} items`
            : `${data.actor} added ${items[0] || 'an item'}`;
        body = items.join(', ');
      }

      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        data: { url: data.url || '/', items },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

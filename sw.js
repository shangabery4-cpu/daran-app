/* Sorani preview: no offline interception until deployment and data security are validated. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));

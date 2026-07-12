/* Simple offline cache for the UPSC Exam Timer.
Bump CACHE_VERSION whenever you change the app files. */
const CACHE_VERSION = "upsc-timer-v1";
const ASSETS = [
"./",
"./index.html",
"./styles.css",
"./app.js",
"./manifest.json",
"./icons/icon.svg",
];
self.addEventListener("install", (event) => {
event.waitUntil(
caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
);
});
self.skipWaiting();
self.addEventListener("activate", (event) => {
event.waitUntil(
caches.keys().then((keys) =>
Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
)
);
});
self.clients.claim();
// Cache-first: perfect for an offline-only app.
self.addEventListener("fetch", (event) => {
if (event.request.method !== "GET") return;
event.respondWith(
caches.match(event.request).then((cached) =>
cached ||
fetch(event.request).then((resp) => {
const copy = resp.clone();
caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
return resp;
}).catch(() => cached)
)
);
});
// Service worker mínimo — existe principalmente para o navegador considerar
// o site "instalável" como PWA. Faz cache só do "shell" estático (o próprio
// HTML, manifest e ícones); nunca cacheia chamadas à API (essas sempre
// precisam de dados atuais, nunca uma versão antiga guardada em cache).

// Versão do cache: precisa subir a cada mudança no shell (index.html,
// manifest.json, ícones) — senão o navegador continua servindo a versão
// antiga guardada. Foi o que aconteceu com a trava de orientação no
// manifest: sem bump, o PWA instalado seguia lendo o manifest velho.
const CACHE_NAME = 'dld-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nomes =>
      Promise.all(nomes.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Nunca interceptar/cachear chamadas à API — sempre rede, sempre dado atual.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

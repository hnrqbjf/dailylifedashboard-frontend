// Service worker mínimo — existe principalmente para o navegador considerar
// o site "instalável" como PWA. Faz cache só do "shell" estático (o próprio
// HTML, manifest e ícones); nunca cacheia chamadas à API (essas sempre
// precisam de dados atuais, nunca uma versão antiga guardada em cache).

// Versão do cache: precisa subir a cada mudança no shell (index.html,
// manifest.json, ícones) — senão o navegador continua servindo a versão
// antiga guardada. Foi o que aconteceu com a trava de orientação no
// manifest: sem bump, o PWA instalado seguia lendo o manifest velho.
// v9 (14/09/2026): tela de login, trocar senha e sair (context/Modulo_Login.md).
// v10 (15/09/2026): checkmark nos hábitos, cores das badges pendente/anulado,
// "sem valor definido" some quando a conta vale zero, streak da água no canto
// (igual hábitos), e um verde no bloco de remédios já tomados.
// v8 (14/09/2026): água 480→450 e "Outro valor" como botão, tarefas ordenadas
// por prioridade com subtarefas recolhíveis, remédios tomados em bloco
// resumido, e o modal de Status do sistema. Um bump só porque nenhuma dessas
// versões chegou a ir para produção separada.
const CACHE_NAME = 'dld-shell-v10';
// v6: módulo de Agenda implementado (o card deixa de ser "em breve").
// v5: módulo de Tasks implementado.
//
// Sobre o v7: o commit do v6 subiu certo (a branch remota recebeu), mas o build
// do Pages ficou preso em "queued" sem alocar runner nenhum, com o GitHub
// reportando tudo operacional. O GitHub Pages tem um limite SOFT de 10 builds
// por hora quando a origem é "deploy from a branch", que é o caso deste repo —
// e cancelar e refazer o deploy gasta build desse orçamento em vez de destravar.
// O v7 existe para forçar um commit novo depois que a janela da hora virou.
// Se isso voltar a acontecer: espere a hora fechar em vez de re-rodar, ou troque
// a origem do Pages para um workflow próprio do Actions, ao qual o limite não se
// aplica.
//
// ⚠️ O bump para v5 NÃO foi feito quando Tasks entrou: o `index.html` foi
// alterado em 13/09 e este arquivo ficou em v4, de 12/09. No navegador comum
// isso passa despercebido (o HTML é revalidado), mas no PWA instalado o shell
// vem do cache — ou seja, o card de Tasks pode nunca ter aparecido lá. É
// exatamente a falha que o comentário acima já descrevia sobre o manifest, e
// ela voltou porque o bump depende de alguém lembrar.
//
// Os dois módulos entram juntos neste v6. Se o card de Tasks continuar
// ausente no aparelho depois do deploy, o problema não é este arquivo — é o
// service worker antigo ainda ativo, e o conserto é fechar todas as abas do
// app (ou desinstalar e reinstalar o PWA) uma única vez.
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

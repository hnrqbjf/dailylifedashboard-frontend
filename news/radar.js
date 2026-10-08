/* Radar dentro do DLD (context/Modulo_Noticias.md). Veio do poc-news; as
   mudanças são login (o mesmo do DLD), rotas /noticias e a coleta só quando
   pedida, com a varredura animada no lugar do "aguarde". */
const API = window.API_BASE || "";
const TOKEN_KEY = "dld_sessao_token";        // o MESMO do DLD: uma sessão vale nos dois
const VOLTA_MS = 4200;                        // uma volta do feixe da varredura (era 2,6 s: frenético)
const NOME_MS = 750;                          // um nome de veículo fica pelo menos isso na tela
const RESULTADO_MS = 1800;                    // quanto o resultado da varredura fica na tela
const INTERVALO_MS = 5 * 60 * 1000;            // RN-08: espera mínima entre duas buscas (o servidor também confere)
const IDADE_TICK_MS = 15 * 1000;               // de quanto em quanto tempo o "há X min" é recalculado
const ARMAR_MS = 240;               // segurar PARADO antes de qualquer efeito: rolar a lista nunca acende nada
const CARGA_MS = 760;               // depois disso, a barra enche; soltar antes cancela
const LONG_PRESS_MS = ARMAR_MS + CARGA_MS;   // total para marcar como lida (1 s)
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const READ_KEY = "radar.read.v1";   // lidos ficam só neste navegador (localStorage)
const PREFS_KEY = "radar.prefs.v1";
const HINT_KEY = "radar.hint.v1";
const READ_KEEP_DAYS = 30;

const CAT_LABEL = {
  politica: "Política", economia: "Economia", mundo: "Mundo",
  tecnologia: "Tecnologia", esportes: "Esportes", geral: "Geral",
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* ---------------- armazenamento local (tolerante a falhas) ---------------- */
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado etc. */ }
}

const prefs = Object.assign({ period: "day", category: "all", intl: true }, lsGet(PREFS_KEY, {}));
const state = { ...prefs, view: "news", stories: [], lastFetch: null, loaded: false, fontes: [] };
const savePrefs = () => lsSet(PREFS_KEY, { period: state.period, category: state.category, intl: state.intl });

/* ---------------- lidos ----------------
   O id de um assunto muda quando uma matéria nova entra no grupo, então
   guardamos os links das matérias: se qualquer link do assunto já foi
   marcado, o assunto inteiro conta como lido. */
let readEntries = lsGet(READ_KEY, []).filter((e) => e.readAt > Date.now() - READ_KEEP_DAYS * 864e5);
let readLinks = new Set();
function rebuildReadIndex() {
  readLinks = new Set(readEntries.flatMap((e) => e.links));
  const n = readEntries.length;
  $$("[data-read-count]").forEach((el) => (el.textContent = n ? String(n) : ""));
  $("#clear-read").hidden = n === 0;
}
const storyLinks = (s) => [...new Set([s.link, ...s.articles.map((a) => a.link)])];
const isRead = (s) => storyLinks(s).some((l) => readLinks.has(l));

function markRead(s) {
  if (isRead(s)) return;
  readEntries.unshift({
    id: s.id, title: s.title, link: s.link, source: s.source, category: s.category,
    sources: s.sources_count, links: storyLinks(s), readAt: Date.now(),
  });
  lsSet(READ_KEY, readEntries);
  rebuildReadIndex();
}
function unmarkLinks(links) {
  const set = new Set(links);
  const removed = readEntries.filter((e) => e.links.some((l) => set.has(l)));
  readEntries = readEntries.filter((e) => !e.links.some((l) => set.has(l)));
  lsSet(READ_KEY, readEntries);
  rebuildReadIndex();
  return removed;
}
function restoreEntries(entries) {
  readEntries = [...entries, ...readEntries].sort((a, b) => b.readAt - a.readAt);
  lsSet(READ_KEY, readEntries);
  rebuildReadIndex();
}

/* ---------------- utilidades ---------------- */
/* ---------------- sessão ----------------
   Sem token, ou com o servidor respondendo 401, a tela de login do próprio
   Radar aparece por cima de tudo — não é preciso voltar ao DLD para entrar. */
function token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function salvarToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* modo privado */ } }
function esquecerToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* idem */ } }

class SemSessao extends Error {}
class ErroApi extends Error {
  constructor(status, corpo) {
    super((corpo && corpo.message) || `Erro ${status}`);
    this.status = status; this.codigo = corpo && corpo.error_code;
  }
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(API + path, { ...opts, headers });
  if (r.status === 401) {
    esquecerToken();
    mostrarLogin(t ? "Sua sessão expirou. Entre de novo." : "");
    throw new SemSessao();
  }
  if (!r.ok) throw new ErroApi(r.status, await r.json().catch(() => null));
  return r.json();
}
function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ontem" : `há ${d} dias`;
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function formatTraffic(t) {
  if (!t) return "";
  const n = parseInt(String(t).replace(/\D/g, ""), 10);
  if (!n) return t;
  const plus = String(t).includes("+") ? "+" : "";
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("pt-BR")} mi${plus} buscas`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("pt-BR")} mil${plus} buscas`;
  return `${n}${plus} buscas`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// alguns veículos repetem o título no começo do resumo
function cleanSummary(summary, title) {
  if (!summary) return "";
  const t = title.trim();
  let out = summary.trim();
  if (out.toLowerCase().startsWith(t.toLowerCase())) out = out.slice(t.length).replace(/^[\s.:–-]+/, "");
  return out.length > 20 ? out : "";
}

/* ---------------- aviso flutuante ---------------- */
let toastTimer;
function toast(text, actionLabel, onAction) {
  const t = $("#toast"), btn = $("#toast-action");
  $("#toast-text").textContent = text;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || "";
  btn.onclick = () => { t.hidden = true; onAction && onAction(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 5000 : 2500);
}

/* ---------------- toque longo ----------------
   Duas fases. Primeiro ARMAR_MS segurando parado, sem efeito nenhum — no
   celular, um dedo que começa a rolar a lista sempre se mexe (ou o navegador
   manda pointercancel) antes disso, então rolar nunca acende a barra. Só
   depois começa a carga: uma barra de luz no pé da notícia, soltando
   partículas, que enche em CARGA_MS. Soltar antes cancela. */
function corVar(nome, reserva) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || reserva;
}

// A carga é desenhada num canvas FIXO por cima da linha (não dentro dela):
// assim a explosão final continua visível enquanto a linha se recolhe.
function criarCarga(row) {
  const sweep = row.querySelector(".story__sweep");
  const reduz = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduz) {
    if (sweep) sweep.style.transform = "scaleX(1)";
    return { concluir() {}, cancelar() { if (sweep) sweep.style.transform = ""; } };
  }
  const PAD = 28;
  const r0 = row.getBoundingClientRect();
  // Só a parte VISÍVEL da notícia: na manchete (alta, com imagem) o pé da
  // linha costuma estar fora da tela, e a barra precisa aparecer.
  // (descontando a barra do topo e a de abas do celular, que ficam por cima)
  const barra = $(".bar").getBoundingClientRect().bottom;
  const abas = $(".tabbar");
  const chao = abas && getComputedStyle(abas).display !== "none" ? abas.getBoundingClientRect().top : window.innerHeight;
  const topo = Math.max(r0.top, barra), base = Math.min(r0.bottom, chao - 10);
  const r = { left: r0.left, top: topo, width: r0.width, height: Math.max(40, base - topo) };
  const cv = document.createElement("canvas");
  cv.className = "carga";
  cv.setAttribute("aria-hidden", "true");
  const w = r.width + 16 + PAD * 2, h = r.height + PAD * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  Object.assign(cv.style, { left: `${r.left - 8 - PAD}px`, top: `${r.top - PAD}px`, width: `${w}px`, height: `${h}px` });
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  document.body.append(cv);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);

  const azul = corVar("--cobalt", "#2F5BEA"), amarelo = corVar("--marker", "#FFE14D"), trilho = corVar("--rule", "#DCE1E8");
  const x0 = PAD + 8, x1 = w - PAD - 8, y = h - PAD - 3;   // a barra corre no pé da linha
  const parts = [];
  let inicio = performance.now(), anterior = inicio, p = 0, estado = "carregando", fimEm = 0, raf = 0;

  const emitir = (x, n, explosao) => {
    for (let i = 0; i < n; i++) {
      const ang = explosao ? Math.random() * Math.PI * 2 : Math.PI + (Math.random() - 0.5) * 1.1 - 0.35;
      const vel = explosao ? 0.6 + Math.random() * 2.8 : 0.35 + Math.random() * 1.3;
      parts.push({
        x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 3,
        vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel - (explosao ? 0.4 : 0.35),
        vida: 0, max: (explosao ? 520 : 360) + Math.random() * 520,
        r: 0.7 + Math.random() * (explosao ? 2 : 1.4),
        cor: Math.random() < 0.6 ? amarelo : azul,
        traco: Math.random() < 0.35,
      });
    }
  };

  const quadro = (t) => {
    const dt = Math.min(48, t - anterior); anterior = t;
    ctx.clearRect(0, 0, w, h);
    if (estado === "carregando") {
      p = Math.min(1, (t - inicio) / CARGA_MS);
      if (sweep) sweep.style.transform = `scaleX(${p})`;
    }
    const xc = x0 + (x1 - x0) * p;
    // trilho e marcas de régua (acendem quando a carga passa por elas)
    const apagar = estado === "cancelada" ? Math.max(0, 1 - (t - fimEm) / 220) : estado === "concluida" ? Math.max(0, 1 - (t - fimEm) / 520) : 1;
    if (apagar > 0) {
      ctx.globalAlpha = apagar;
      ctx.fillStyle = trilho;
      ctx.fillRect(x0, y - 0.5, x1 - x0, 1);
      for (let x = x0; x <= x1; x += 22) {
        ctx.fillStyle = x <= xc ? amarelo : trilho;
        ctx.fillRect(x, y - 3, 1, x <= xc ? 6 : 3);
      }
      // barra cheia, com brilho
      const g = ctx.createLinearGradient(x0, 0, Math.max(x0 + 1, xc), 0);
      g.addColorStop(0, azul); g.addColorStop(1, amarelo);
      ctx.save();
      ctx.shadowColor = amarelo; ctx.shadowBlur = 12;
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xc, y); ctx.stroke();
      // cabeça da carga: ponto aceso e um feixe vertical que sobe e some
      if (estado !== "cancelada") {
        const fe = ctx.createLinearGradient(0, y, 0, y - 46);
        fe.addColorStop(0, amarelo); fe.addColorStop(1, "transparent");
        ctx.fillStyle = fe; ctx.globalAlpha = apagar * 0.55;
        ctx.fillRect(xc - 0.75, y - 46, 1.5, 46);
        ctx.globalAlpha = apagar;
        ctx.fillStyle = amarelo;
        ctx.beginPath(); ctx.arc(xc, y, 3.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (estado === "carregando") emitir(xc, 2, false);

    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.vida += dt;
      if (q.vida >= q.max) { parts.splice(i, 1); continue; }
      const k = dt / 16;
      q.x += q.vx * k; q.y += q.vy * k;
      q.vx *= 0.985; q.vy = q.vy * 0.985 - 0.006 * k;   // flutuam para cima, perdendo força
      ctx.globalAlpha = 1 - q.vida / q.max;
      ctx.fillStyle = q.cor;
      if (q.traco) ctx.fillRect(q.x, q.y, q.r * 3.2, 1);
      else ctx.fillRect(q.x - q.r / 2, q.y - q.r / 2, q.r, q.r);
    }
    ctx.globalAlpha = 1;

    if (estado !== "carregando" && !parts.length && apagar === 0) { cv.remove(); return; }
    raf = requestAnimationFrame(quadro);
  };
  raf = requestAnimationFrame(quadro);

  return {
    concluir() {
      if (estado !== "carregando") return;
      estado = "concluida"; p = 1; fimEm = performance.now();
      if (sweep) sweep.style.transform = "scaleX(1)";
      emitir(x1, 46, true);
    },
    cancelar() {
      if (estado !== "carregando") return;
      estado = "cancelada"; fimEm = performance.now();
      if (sweep) sweep.style.transform = "";
    },
  };
}

function longPress(container, selector, onDone) {
  let armar = null, carregar = null, row = null, carga = null, x0 = 0, y0 = 0, fired = false;
  const cancel = () => {
    clearTimeout(armar); clearTimeout(carregar); armar = carregar = null;
    if (carga) carga.cancelar();
    if (row) row.classList.remove("is-pressing");
    row = null; carga = null;
  };
  container.addEventListener("pointerdown", (e) => {
    fired = false;
    if (e.button !== 0) return;
    const target = e.target.closest(selector);
    if (!target || e.target.closest("[data-no-press]")) return;
    row = target; x0 = e.clientX; y0 = e.clientY;
    armar = setTimeout(() => {
      armar = null;
      row.classList.add("is-pressing");
      carga = criarCarga(row);
      carregar = setTimeout(() => {
        fired = true;
        const done = row, c = carga;
        carga = null;          // para o cancel() abaixo não apagar a explosão
        cancel();
        c.concluir();
        if (navigator.vibrate) navigator.vibrate(20);
        onDone(done);
      }, CARGA_MS);
    }, ARMAR_MS);
  });
  container.addEventListener("pointermove", (e) => {
    if (row && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); // virou rolagem
  });
  ["pointerup", "pointercancel"].forEach((ev) => document.addEventListener(ev, cancel));
  container.addEventListener("pointerleave", cancel);
  window.addEventListener("scroll", () => { if (row) cancel(); }, { passive: true });
  // depois de um toque longo, o "clique" que vem em seguida não abre o link
  container.addEventListener("click", (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, true);
  // impede o menu do link/seleção de texto do Android durante o toque longo
  container.addEventListener("contextmenu", (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

/* ---------------- notícias ---------------- */
function visibleStories() {
  return state.category === "all" ? state.stories.filter((s) => !isRead(s)) : state.stories;
}

function meter(n) {
  const m = el("span", "meter");
  m.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 10; i++) m.append(el("i", i < n ? "on" : ""));
  return m;
}

function renderStory(s, i) {
  const read = isRead(s);
  const row = el("article", "story" + (i === 0 ? " story--lead" : "") + (read ? " is-read" : ""));
  row.dataset.id = s.id;
  row.append(el("span", "story__sweep"));
  row.append(el("span", "story__rank", String(i + 1)));

  const main = el("div", "story__main");
  const cat = el("p", "story__cat");
  const catname = el("span", "catname");
  const dot = el("i", "dot");
  dot.style.background = `var(--c-${s.category}, var(--c-geral))`;
  catname.append(dot, CAT_LABEL[s.category] || s.category);
  cat.append(el("span", "rank-inline", String(i + 1)), catname);
  if (s.trend) cat.append(el("span", "hot", `Em alta: ${s.trend.term}`));
  if (s.lang === "en") cat.append(el("span", "lang", "Em inglês"));
  if (read) cat.append(el("span", "readmark", "Lida"));
  main.append(cat);

  const h = el("h2", "story__title");
  const a = el("a", null, s.title);
  a.href = s.link; a.target = "_blank"; a.rel = "noopener"; a.draggable = false;
  h.append(a);
  main.append(h);
  const summary = cleanSummary(s.summary, s.title);
  if (summary) main.append(el("p", "story__summary", summary));

  const meta = el("div", "story__meta");
  const cov = el("span", "coverage");
  cov.style.display = "inline-flex"; cov.style.alignItems = "center"; cov.style.gap = "8px";
  cov.append(meter(s.sources_count), el("span", "count", s.sources_count === 1 ? "1 veículo" : `${s.sources_count} veículos`));
  meta.append(cov, el("span", null, s.source), el("span", null, timeAgo(s.last_seen)));
  main.append(meta);

  if (s.articles.length > 1) {
    const det = el("details", "story__more");
    det.append(el("summary", null, `Ver os ${s.articles.length} veículos`));
    const ul = el("ul");
    for (const art of s.articles) {
      const li = el("li");
      const link = el("a", null, art.title);
      link.href = art.link; link.target = "_blank"; link.rel = "noopener"; link.draggable = false;
      li.append(el("span", "src", `${art.source}, ${timeAgo(art.published_at)}`), link);
      ul.append(li);
    }
    det.append(ul);
    main.append(det);
  }
  row.append(main);

  if (s.image) {
    const img = el("img", "story__thumb");
    img.src = s.image; img.alt = ""; img.loading = i < 3 ? "eager" : "lazy";
    img.referrerPolicy = "no-referrer"; img.draggable = false;
    img.onerror = () => img.remove();
    row.append(img);
  }

  const check = el("button", "story__check", read ? "Desmarcar" : "Marcar como lida");
  check.type = "button";
  check.dataset.noPress = "";
  check.addEventListener("click", () => {
    if (!isRead(s)) { const c = criarCarga(row); c.concluir(); }
    toggleRead(row);
  });
  row.append(check);
  return row;
}

function renderNews() {
  const list = $("#stories");
  const items = visibleStories();

  const now = new Date();
  $("#news-heading").textContent = state.period === "day"
    ? cap(now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))
    : "Últimos 7 dias";
  const where = state.category === "all" ? "" : ` em ${CAT_LABEL[state.category]}`;
  const unread = state.stories.filter((s) => !isRead(s)).length;
  $("#status-count").textContent = !state.loaded ? "" :
    !state.lastFetch ? "Nenhuma busca ainda" :
    state.category === "all"
      ? `${unread} ${unread === 1 ? "assunto para ler" : "assuntos para ler"}`
      : `${items.length} assuntos${where}, ${unread} não lidos`;
  atualizarIdade();

  if (!state.loaded) return;
  // A dica do toque longo só faz sentido com notícia na tela.
  if (!state.stories.length) $("#hint").hidden = true;
  else if (!lsGet(HINT_KEY, false)) $("#hint").hidden = false;
  list.replaceChildren();
  if (!state.stories.length) {
    return state.lastFetch
      ? emptyState(list, "A última busca não trouxe assuntos para este filtro.", "Buscar notícias agora", refresh)
      : emptyState(list, "Nenhuma busca de notícias foi feita ainda. Ela leva de 10 a 30 segundos.", "Buscar notícias agora", refresh);
  }
  if (!items.length) {
    return emptyState(list, "Você já leu tudo o que importa por enquanto.", "Ver lidos", () => setView("read"));
  }
  items.forEach((s, i) => list.append(renderStory(s, i)));
}

function emptyState(container, text, actionLabel, action) {
  const box = el("div", "empty");
  box.append(el("p", null, text));
  if (actionLabel) {
    const b = el("button", "link-btn", actionLabel);
    b.type = "button"; b.onclick = action;
    box.append(b);
  }
  container.replaceChildren(box);
}

function skeleton() {
  const list = $("#stories");
  list.replaceChildren(...Array.from({ length: 6 }, () => el("div", "skel")));
}

/* ---------------- transição ao marcar como lida ----------------
   1) a linha pisca em amarelo e se recolhe (as de baixo sobem junto, sem
      salto); 2) a lista é redesenhada e, se a que saiu era a manchete, a
      próxima vira manchete com a imagem se abrindo de cima para baixo e o
      título crescendo até o tamanho de manchete — em vez de a imagem grande
      aparecer de uma vez. */
const reduzMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function sairDaLista(row, depois) {
  row.classList.add("is-done");
  if (reduzMovimento()) return depois();
  const h = row.getBoundingClientRect().height;
  const cs = getComputedStyle(row);
  row.style.overflow = "hidden";
  const a = row.animate([
    { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, offset: 0 },
    { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, offset: 0.3 },
    { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
  ], { duration: 520, easing: EASE, fill: "forwards" });
  a.onfinish = depois;
}

function renderNewsAnimado() {
  if (reduzMovimento()) return renderNews();
  const antes = new Map();
  $$("#stories .story").forEach((r) => {
    const t = r.querySelector(".story__title");
    antes.set(r.dataset.id, { lead: r.classList.contains("story--lead"), fs: t ? parseFloat(getComputedStyle(t).fontSize) : 0 });
  });
  renderNews();
  const lead = $("#stories .story--lead");
  const a = lead && antes.get(lead.dataset.id);
  if (a && !a.lead) promoverManchete(lead, a.fs);
}

function promoverManchete(row, fsAntes) {
  const D = 640;
  const img = row.querySelector(".story__thumb");
  if (img && img.complete && img.naturalWidth) {
    const cs = getComputedStyle(img);
    const H = img.getBoundingClientRect().height;
    img.animate([
      { height: "0px", marginBottom: "0px", opacity: 0, clipPath: "inset(0 0 100% 0 round 14px)" },
      { height: `${H}px`, marginBottom: cs.marginBottom, opacity: 1, clipPath: "inset(0 0 0% 0 round 14px)" },
    ], { duration: D, easing: EASE });
  } else if (img) {
    img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D, easing: "ease" });
  }
  const t = row.querySelector(".story__title");
  if (t && fsAntes) {
    t.animate([{ fontSize: `${fsAntes}px` }, { fontSize: getComputedStyle(t).fontSize }], { duration: D, easing: EASE });
  }
  const resumo = row.querySelector(".story__summary");
  if (resumo) resumo.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: D, easing: "ease" });
  // um brilho amarelo que atravessa a nova manchete: "subiu para o topo"
  const sweep = row.querySelector(".story__sweep");
  if (sweep) sweep.animate([
    { transform: "scaleX(0)", opacity: 0.9, transformOrigin: "left center" },
    { transform: "scaleX(1)", opacity: 0.6, transformOrigin: "left center", offset: 0.5 },
    { transform: "scaleX(1)", opacity: 0, transformOrigin: "left center" },
  ], { duration: 900, easing: EASE });
}

function toggleRead(row) {
  const s = state.stories.find((x) => x.id === row.dataset.id);
  if (!s) return;
  if (isRead(s)) {
    const removed = unmarkLinks(storyLinks(s));
    renderNews();
    toast("Desmarcada", "Desfazer", () => { restoreEntries(removed); renderNews(); });
    return;
  }
  markRead(s);
  const undo = () => { unmarkLinks(storyLinks(s)); renderNews(); renderRead(); };
  renderRead();
  if (state.category === "all") sairDaLista(row, renderNewsAnimado);
  else renderNews();
  toast("Marcada como lida", "Desfazer", undo);
}

async function loadStories() {
  state.loaded = false;
  renderNews();
  skeleton();
  const q = new URLSearchParams({ period: state.period, limit: 80 });
  if (state.category !== "all") q.set("category", state.category);
  if (!state.intl) q.set("lang", "pt");
  try {
    const data = await api(`/noticias/top?${q}`);
    state.stories = data.stories;
    state.lastFetch = data.last_fetch;
    state.loaded = true;
    renderNews();
  } catch (e) {
    if (e instanceof SemSessao) return;
    state.loaded = true;
    state.stories = [];
    emptyState($("#stories"), "Não consegui falar com o servidor do DLD. Confira a conexão e tente de novo.", "Tentar de novo", loadStories);
  }
}

/* ---------------- lidos ---------------- */
function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return cap(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" }));
}

function renderRead() {
  const box = $("#read-list");
  if (!readEntries.length) {
    return emptyState(box, "Nada marcado ainda. Segure uma notícia por um segundo para marcar como lida.", "Ir para notícias", () => setView("news"));
  }
  box.replaceChildren();
  let current = "";
  for (const e of readEntries) {
    const label = dayLabel(e.readAt);
    if (label !== current) { box.append(el("h2", "read-group", label)); current = label; }
    const row = el("div", "read-item");
    row.dataset.readAt = e.readAt;
    row.append(el("span", "story__sweep"));
    const a = el("a", "read-item__title", e.title);
    a.href = e.link; a.target = "_blank"; a.rel = "noopener"; a.draggable = false;
    const meta = el("div", "read-item__meta");
    meta.append(
      el("span", null, CAT_LABEL[e.category] || e.category),
      el("span", null, e.sources === 1 ? "1 veículo" : `${e.sources} veículos`),
      el("span", null, `lida às ${new Date(e.readAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`),
    );
    const btn = el("button", "link-btn", "Desmarcar");
    btn.type = "button"; btn.dataset.noPress = "";
    btn.onclick = () => unmarkEntry(e);
    row.append(a, btn, meta);
    box.append(row);
  }
}

function unmarkEntry(entry) {
  const removed = unmarkLinks(entry.links);
  renderRead(); renderNews();
  toast("Desmarcada, voltou para Tudo", "Desfazer", () => { restoreEntries(removed); renderRead(); renderNews(); });
}

/* ---------------- em alta e fontes ---------------- */
async function loadTrends() {
  const ol = $("#trends");
  try {
    const { trends } = await api("/noticias/tendencias");
    ol.replaceChildren();
    if (!trends.length) { ol.append(el("li", null, "Sem dados ainda.")); return; }
    for (const t of trends) {
      const li = el("li");
      li.append(el("span", "term", t.term));
      if (t.traffic) li.append(el("span", "traffic", formatTraffic(t.traffic)));
      const n = (t.news || []).find((x) => x.url);
      if (n) {
        const a = el("a", "news", n.source ? `${n.source}: ${n.title}` : n.title);
        a.href = n.url; a.target = "_blank"; a.rel = "noopener";
        li.append(a);
      }
      ol.append(li);
    }
  } catch (e) {
    if (e instanceof SemSessao) return;
    ol.replaceChildren(el("li", null, "Não foi possível carregar as buscas em alta."));
  }
}

async function loadFeeds() {
  const box = $("#feeds");
  try {
    const { configured, feeds, sources } = await api("/noticias/fontes");
    state.fontes = sources || [];
    if (!feeds.length) { box.textContent = `${configured} feeds configurados. Ainda não houve busca.`; return; }
    const ok = feeds.filter((f) => f.ok).length;
    const bad = feeds.filter((f) => !f.ok);
    const p = el("p");
    p.style.margin = "0";
    p.append(el("strong", null, `${ok} de ${configured}`), " feeds responderam na última coleta.");
    box.replaceChildren(p);
    if (bad.length) {
      const det = el("details");
      det.append(el("summary", null, bad.length === 1 ? "1 com falha" : `${bad.length} com falha`));
      const ul = el("ul");
      for (const f of bad) {
        const li = el("li", null, `${f.source}: ${f.error || "erro desconhecido"}`);
        li.title = f.url;
        ul.append(li);
      }
      det.append(ul);
      box.append(det);
    }
  } catch (e) {
    if (e instanceof SemSessao) return;
    box.textContent = "Status indisponível.";
  }
}

/* ---------------- navegação e controles ---------------- */
function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  $$("[data-view]").forEach((b) => {
    if (b.tagName === "BODY") return;
    if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (view === "read") renderRead();
  window.scrollTo({ top: 0 });
}

function syncControls() {
  $$(".seg__btn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.period === state.period)));
  $$(".chip[data-cat]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.cat === state.category)));
  $("#intl").setAttribute("aria-pressed", String(state.intl));
}

/* ---------------- varredura ----------------
   A coleta é um POST só, que leva de 10 a 30 s; não existe progresso real a
   mostrar. Então a animação é honesta: o feixe gira, acende cada veículo por
   onde passa, e o relógio conta os segundos. Quando a resposta chega, o
   desenho para e mostra o resultado de verdade — ponto aceso respondeu,
   ponto oco falhou. */
const ANEL = { politica: 39, economia: 39, geral: 65, mundo: 91, tecnologia: 91, esportes: 91 };

function hashAngulo(nome) {
  let h = 2166136261;
  for (const c of nome) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 3600) / 10;
}

function montarBlips(fontes) {
  const g = $("#scan-blips");
  g.replaceChildren();
  return fontes.map((f) => {
    const ang = hashAngulo(f.name);
    const base = f.lang === "en" ? 91 : (ANEL[f.category] || 65);
    const r = base + ((hashAngulo(f.name + "#") / 360) * 14 - 7);   // espalha dentro do anel
    const rad = (ang * Math.PI) / 180;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "blip");
    c.setAttribute("r", "4.2");
    c.setAttribute("cx", (r * Math.sin(rad)).toFixed(1));
    c.setAttribute("cy", (-r * Math.cos(rad)).toFixed(1));
    g.append(c);
    return { nome: f.name, ang, el: c };
  });
}

const varredura = { raf: 0, inicio: 0, ultimo: 0, blips: [], relogio: 0, passo: 0 };

function iniciarVarredura() {
  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fontes = state.fontes.length ? state.fontes : [{ name: "Fontes", category: "geral", lang: "pt" }];
  varredura.blips = montarBlips(fontes).sort((a, b) => a.ang - b.ang);
  const scan = $("#scan");
  scan.classList.remove("is-done");
  scan.hidden = false;
  $("#stories").hidden = true;
  $("#scan-title").textContent = `Varrendo ${fontes.length} veículos`;
  $("#status-count").textContent = "Buscando notícias nas fontes";
  $("#hint").hidden = true;
  $("#scan-now").innerHTML = "&nbsp;";
  varredura.inicio = performance.now();
  varredura.ultimo = 0;

  // O ponto acende sempre que o feixe passa; o NOME embaixo troca no máximo
  // a cada NOME_MS (com 28 veículos numa volta, trocar a cada ponto era frenético).
  let ultimoNome = -Infinity;
  const acender = (b) => {
    b.el.classList.remove("apagando");
    b.el.classList.add("lit");
    setTimeout(() => b.el.classList.add("apagando"), 140);
    const agora = performance.now();
    if (agora - ultimoNome < NOME_MS) return;
    ultimoNome = agora;
    $("#scan-now").replaceChildren(el("mark", null, b.nome));
  };

  const relogio = () => {
    const s = Math.floor((performance.now() - varredura.inicio) / 1000);
    $("#scan-time").textContent = s < 1 ? "" : `${s} s`;
  };
  varredura.relogio = setInterval(relogio, 250);

  if (reduzido) {   // sem rotação: acende um veículo por vez, em ordem
    let i = 0;
    varredura.passo = setInterval(() => acender(varredura.blips[i++ % varredura.blips.length]), NOME_MS);
    return;
  }
  const beam = $(".scan__beam");
  const quadro = (t) => {
    const ang = (((t - varredura.inicio) / VOLTA_MS) * 360) % 360;
    beam.style.transform = `rotate(${ang}deg)`;
    const de = varredura.ultimo, ate = ang;
    for (const b of varredura.blips) {
      const passou = de <= ate ? (b.ang > de && b.ang <= ate) : (b.ang > de || b.ang <= ate);
      if (passou) acender(b);
    }
    varredura.ultimo = ang;
    varredura.raf = requestAnimationFrame(quadro);
  };
  varredura.raf = requestAnimationFrame(quadro);
}

function pararVarredura() {
  cancelAnimationFrame(varredura.raf);
  clearInterval(varredura.relogio);
  clearInterval(varredura.passo);
}

function esconderVarredura() {
  pararVarredura();
  $("#scan").hidden = true;
  $("#stories").hidden = false;
}

async function mostrarResultado(resumo, feeds) {
  pararVarredura();
  const okPorVeiculo = new Map();
  for (const f of feeds) okPorVeiculo.set(f.source, (okPorVeiculo.get(f.source) || 0) + (f.ok ? 1 : 0));
  for (const b of varredura.blips) {
    b.el.classList.remove("lit", "apagando");
    b.el.classList.toggle("falhou", okPorVeiculo.has(b.nome) && okPorVeiculo.get(b.nome) === 0);
  }
  $("#scan").classList.add("is-done");
  $("#scan-title").textContent = `${resumo.feeds_ok} de ${resumo.feeds_total} fontes responderam`;
  const n = resumo.items_new;
  $("#scan-now").textContent = n === 0 ? "Nenhuma matéria nova desde a última busca"
    : `${n.toLocaleString("pt-BR")} ${n === 1 ? "matéria nova" : "matérias novas"}`;
  const s = Math.round((performance.now() - varredura.inicio) / 1000);
  $("#scan-time").textContent = `em ${s} s`;
  await new Promise((r) => setTimeout(r, RESULTADO_MS));
}

/* ---------------- tema ----------------
   O mesmo `dld_tema` do DLD: trocar aqui troca lá, e vice-versa. O DLD tem um
   terceiro estado ("seguir o aparelho", sem chave salva); aqui o botão só
   alterna claro/escuro, partindo do que está na tela. */
const TEMA_KEY = "dld_tema";
const temaEscuroAgora = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
function sincronizarBotaoTema() {
  const escuro = temaEscuroAgora();
  const b = $("#tema");
  b.classList.toggle("is-escuro", escuro);
  b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
  b.title = escuro ? "Tema claro" : "Tema escuro";
}
$("#tema").addEventListener("click", () => {
  const novo = temaEscuroAgora() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", novo);
  try { localStorage.setItem(TEMA_KEY, novo); } catch { /* modo privado: vale até fechar */ }
  sincronizarBotaoTema();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sincronizarBotaoTema);
sincronizarBotaoTema();

/* ---------------- tempo desde a última busca ---------------- */
// Um relógio só, que recalcula o texto a cada 15 s e sempre que a aba volta a
// ficar visível (celular bloqueado, troca de app): o setInterval do navegador
// dorme em segundo plano, e sem isso o "há 2 min" ficaria congelado.
function atualizarIdade() {
  const idade = $("#idade");
  if (idade.classList.contains("is-busy")) return;
  if (!state.lastFetch) { idade.hidden = true; return; }
  const quando = $("#idade-quando");
  quando.dateTime = state.lastFetch;
  // "há" vira um span à parte para sumir nos celulares mais estreitos (360 px):
  // ali "47 min" ao lado do ícone já diz tudo, e o título traz a hora exata.
  const texto = timeAgo(state.lastFetch);
  if (texto.startsWith("há ")) quando.replaceChildren(el("span", "idade__ha", "há "), texto.slice(3));
  else quando.textContent = texto;
  idade.title = `Última busca: ${new Date(state.lastFetch).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  idade.hidden = false;
}

function marcarBuscando(sim) {
  const idade = $("#idade");
  idade.classList.toggle("is-busy", sim);
  if (sim) { $("#idade-quando").textContent = "buscando…"; idade.hidden = false; }
  else atualizarIdade();
}

function minutosParaLiberar() {
  if (!state.lastFetch) return 0;
  const falta = INTERVALO_MS - (Date.now() - new Date(state.lastFetch).getTime());
  return falta > 0 ? Math.ceil(falta / 60000) : 0;
}

// Outra aba ou outro aparelho pode ter buscado enquanto esta dormia: ao voltar,
// uma leitura leve de /meta diz se há algo mais novo para mostrar.
async function conferirOutraBusca() {
  if (!token() || $("#refresh").classList.contains("is-busy")) return;
  try {
    const { last_fetch } = await api("/noticias/meta");
    if (last_fetch && last_fetch !== state.lastFetch) await refreshAll();
  } catch { /* sem rede agora: o texto segue o relógio local */ }
}

setInterval(atualizarIdade, IDADE_TICK_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  atualizarIdade();
  conferirOutraBusca();
});

async function refresh() {
  const btn = $("#refresh");
  if (btn.classList.contains("is-busy")) return;
  // RN-08 antes de animar: sem isso o radar girava meio segundo e sumia no 429.
  const espera = minutosParaLiberar();
  if (espera) {
    toast(`Aguarde ${espera === 1 ? "1 minuto" : `${espera} minutos`} para uma nova busca.`);
    return;
  }
  btn.classList.add("is-busy");
  btn.setAttribute("aria-label", "Buscando notícias");
  setView("news");
  marcarBuscando(true);
  if (!state.fontes.length) await loadFeeds();
  iniciarVarredura();
  const inicio = performance.now();
  try {
    const resumo = await api("/noticias/coletar", { method: "POST" });
    // Pelo menos uma volta inteira do feixe, mesmo se a resposta vier rápido.
    const falta = VOLTA_MS - (performance.now() - inicio);
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    const { feeds } = await api("/noticias/fontes");
    await mostrarResultado(resumo, feeds);
    esconderVarredura();
    await refreshAll();
  } catch (e) {
    esconderVarredura();
    if (!(e instanceof SemSessao)) {
      toast(e instanceof ErroApi ? e.message : "Não consegui falar com o servidor do DLD. Tente de novo.");
    }
  } finally {
    btn.classList.remove("is-busy");
    btn.setAttribute("aria-label", "Atualizar notícias");
    marcarBuscando(false);
  }
}

async function refreshAll() {
  await Promise.all([loadStories(), loadTrends(), loadFeeds()]);
}

$$(".seg__btn").forEach((b) => b.addEventListener("click", () => {
  state.period = b.dataset.period; savePrefs(); syncControls(); loadStories();
}));
$$(".chip[data-cat]").forEach((b) => b.addEventListener("click", () => {
  state.category = b.dataset.cat; savePrefs(); syncControls(); loadStories();
}));
$("#intl").addEventListener("click", () => {
  state.intl = !state.intl; savePrefs(); syncControls(); loadStories();
});
$$(".tabbar__btn, .topnav__btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$("#refresh").addEventListener("click", refresh);
$("#clear-read").addEventListener("click", () => {
  const removed = readEntries;
  readEntries = []; lsSet(READ_KEY, readEntries); rebuildReadIndex();
  renderRead(); renderNews();
  toast("Lista de lidos limpa", "Desfazer", () => { restoreEntries(removed); renderRead(); renderNews(); });
});

if (!lsGet(HINT_KEY, false)) $("#hint").hidden = false;
$("#hint-ok").addEventListener("click", () => { $("#hint").hidden = true; lsSet(HINT_KEY, true); });

longPress($("#stories"), ".story", (row) => {
  if (!$("#hint").hidden) { $("#hint").hidden = true; lsSet(HINT_KEY, true); }
  toggleRead(row);
});
longPress($("#read-list"), ".read-item", (row) => {
  const e = readEntries.find((x) => String(x.readAt) === row.dataset.readAt);
  if (e) unmarkEntry(e);
});

/* ---------------- login ---------------- */
function mostrarLogin(mensagem) {
  const erro = $("#login-erro");
  erro.textContent = mensagem || "";
  erro.hidden = !mensagem;
  $("#login").hidden = false;
  setTimeout(() => $("#login-usuario").focus(), 50);
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const usuario = $("#login-usuario").value.trim();
  const senha = $("#login-senha").value;
  const erro = $("#login-erro"), btn = $("#login-entrar");
  if (!usuario || !senha) return;
  erro.hidden = true;
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });
    if (r.status === 429) throw new Error("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    if (!r.ok) throw new Error("Usuário ou senha inválidos.");
    salvarToken((await r.json()).token);
    $("#login-form").reset();
    $("#login").hidden = true;
    iniciar();
  } catch (err) {
    erro.textContent = err instanceof TypeError ? "Não consegui falar com o servidor. Tente de novo." : err.message;
    erro.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- início ---------------- */
async function iniciar() {
  rebuildReadIndex();
  syncControls();
  skeleton();
  await refreshAll();
}

if (token()) iniciar(); else { rebuildReadIndex(); syncControls(); mostrarLogin(""); }

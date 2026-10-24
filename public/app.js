// Nos films : watchlist familiale.
// Données : TMDB (films, plateformes JustWatch), Allociné (séances), SensCritique (note).

import {
  IMG, settings, saveSettings, tmdb, pages, movieDetails, genres, nowPlayingIds, loadNowPlaying, providersFor, loadAllProviders,
  keywordId, list, listLoaded, fetchList, listAction, inList, resetList, seances, senscritique, awards,
} from './js/data.js';
import { buildProfile, topEntries, deepRank, recommendationsFrom } from './js/reco.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ---------- Formats ----------

const fmtDate = (d, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('fr-FR', opts) : '');
const shortDate = (d) => fmtDate(d, { day: 'numeric', month: 'short' });
const year = (d) => (d ? d.slice(0, 4) : '');
const isoDay = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const today = () => isoDay(new Date());
const isFuture = (d) => d && d > today();
const daysUntil = (d) => Math.round((new Date(d) - new Date(today())) / 864e5);
const fr1 = (n) => Number(n).toFixed(1).replace('.', ',');
const runtime = (min) => (min ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : '');
const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();
const hue = (name) => [...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (name) => `<span class="avatar" style="background:hsl(${hue(name)} 50% 40%)" title="${esc(name)}">${esc(initials(name))}</span>`;
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'et')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const allocineSearch = (title) => `https://www.allocine.fr/rechercher/?q=${encodeURIComponent(title)}`;
const familyAvg = (item) => {
  const r = Object.values(item?.ratings || {});
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
};

let genreMap = new Map();
genres().then((g) => (genreMap = g)).catch(() => {});
const genreNames = (m, n = 2) => (m.genres ? m.genres.map((g) => g.name) : (m.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean)).slice(0, n);

// ---------- Films qui passent dans nos cinémas ----------

// titre normalisé -> noms des cinémas (séances d'aujourd'hui et des 2 jours suivants)
let nearby = new Map();
let nearbyLoaded = null;
function loadNearby() {
  if (!settings.theaters.length) return Promise.resolve(nearby);
  if (nearbyLoaded) return nearbyLoaded;
  const days = nextDays(3).map((d) => d.iso);
  nearbyLoaded = Promise.all(settings.theaters.flatMap((t) => days.map((day) => seances(t.id, day).then((d) => ({ t, d })).catch(() => null)))).then((res) => {
    const map = new Map();
    for (const r of res.filter(Boolean)) {
      for (const mv of r.d.movies || []) {
        for (const key of [normalize(mv.title), normalize(mv.originalTitle)].filter(Boolean)) {
          if (!map.has(key)) map.set(key, new Set());
          map.get(key).add(r.t.name || r.d.theaterName || r.t.id);
        }
      }
    }
    nearby = map;
    markNearby(document);
    return map;
  });
  return nearbyLoaded;
}
function nearbyFor(m) {
  if (!m) return null;
  const set = nearby.get(normalize(m.title)) || nearby.get(normalize(m.original_title));
  return set ? [...set] : null;
}
const nearbyBadge = (names) => `<span class="badge near" title="${esc(names.join(', '))}">${icon('ticket')}<span>${esc(names.length === 1 ? names[0] : `${names.length} de vos cinémas`)}</span></span>`;
// Ajoute la pastille aux cartes déjà affichées une fois les séances chargées.
function markNearby(root) {
  if (!nearby.size) return;
  for (const card of $$('.card', root)) {
    const b = card.querySelector('[data-movie]');
    const badges = card.querySelector('.badges');
    if (!b || !badges || badges.querySelector('.near')) continue;
    const names = nearbyFor(movies.get(Number(b.dataset.movie)) || inList(Number(b.dataset.movie)));
    if (names) {
      badges.querySelector('.badge.red')?.remove();
      badges.insertAdjacentHTML('afterbegin', nearbyBadge(names));
    }
  }
}

// ---------- Petits composants ----------

const movies = new Map(); // films déjà affichés, pour l'ajout instantané
const remember = (arr) => (arr.forEach((m) => m?.id && !movies.has(m.id) && movies.set(m.id, m)), arr);

function posterBox(path, alt, size = 'w342') {
  return `<div class="poster-wrap">${path ? `<img loading="lazy" decoding="async" src="${IMG}${size}${path}" alt="${esc(alt)}">` : `<div class="ph">${esc(alt)}</div>`}</div>`;
}

function movieCard(m, { why = m._why, sub = '', fullDate = false, logos = false, noCine = false } = {}) {
  remember([m]);
  const saved = inList(m.id);
  const badges = [];
  if (saved?.status === 'seen') badges.push('<span class="badge green">Vu</span>');
  const near = nearbyFor(m);
  if (near) badges.push(nearbyBadge(near));
  else if (nowPlayingIds.has(m.id) && !noCine) badges.push('<span class="badge red">Au ciné</span>');
  else if (isFuture(m.release_date)) badges.push(`<span class="badge">${esc(shortDate(m.release_date))}</span>`);
  const inTodo = saved && saved.status !== 'hidden';
  const date = fullDate && m.release_date ? fmtDate(m.release_date, { day: 'numeric', month: 'short', year: 'numeric' }) : year(m.release_date);
  return `<div class="card">
    <button data-movie="${m.id}" style="display:block;width:100%;text-align:left">
      ${posterBox(m.poster_path, m.title)}
      <div class="t">${esc(m.title)}</div>
      <div class="s">${esc(date)}${m.vote_average ? ` · <svg class="star"><use href="#i-star"/></svg>${fr1(m.vote_average)}` : ''}${sub ? ` · ${esc(sub)}` : ''}</div>
      ${m._award ? `<div class="award">${icon('award')}${esc(m._award)}</div>` : why ? `<div class="why">${esc(why)}</div>` : ''}
      ${logos ? `<div class="logos" data-logos="${m.id}"></div>` : ''}
    </button>
    <div class="badges">${badges.join('')}</div>
    <button class="quick ${inTodo ? 'on' : ''}" data-quick="${m.id}" aria-label="${inTodo ? 'Dans notre liste' : 'Ajouter à notre liste'}">${icon(inTodo ? 'check' : 'plus')}</button>
  </div>`;
}

const gridHtml = (arr, opts) => (arr.length ? `<div class="grid">${arr.map((m) => movieCard(m, opts)).join('')}</div>` : '<div class="empty"><b>Aucun film trouvé</b>Essaie un autre filtre.</div>');
const railHtml = (arr, opts) => `<div class="rail">${arr.map((m) => movieCard(m, opts)).join('')}</div>`;
const topHtml = (arr) => `<div class="rail top">${arr.slice(0, 10).map((m, k) => `<div class="top-item"><span class="rank ${k === 9 ? 'two' : ''}">${k + 1}</span>${movieCard(m)}</div>`).join('')}</div>`;
const skItem = '<div><div class="sk" style="aspect-ratio:2/3"></div><div class="sk sk-line"></div></div>';
const skGrid = (n = 12) => `<div class="grid">${skItem.repeat(n)}</div>`;
const skRail = (n = 8) => `<div class="rail">${skItem.repeat(n)}</div>`;

// Sections avec « Tout voir » qui ouvre la liste complète.
const collections = new Map();
function sectionHtml(title, body, { sub = '', all = null } = {}) {
  let more = '';
  if (all && all.length > 6) {
    const key = `c${collections.size + 1}`;
    collections.set(key, { title, movies: all });
    more = `<button class="more" data-seeall="${key}">Tout voir${icon('chev')}</button>`;
  }
  return `<section class="section"><div class="section-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${more}</div>${body}</section>`;
}

function fillLogos(root) {
  const mine = new Set(settings.providers);
  for (const el of $$('[data-logos]:not([data-filled])', root)) {
    el.dataset.filled = '1';
    providersFor(Number(el.dataset.logos)).then((fr) => {
      const subs = [...new Map([...(fr?.flatrate || []), ...(fr?.free || []), ...(fr?.ads || [])].map((p) => [p.provider_id, p])).values()];
      subs.sort((a, b) => mine.has(b.provider_id) - mine.has(a.provider_id));
      el.innerHTML = subs.slice(0, 4).map((p) => `<img class="logo" src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('');
    });
  }
}

function fillSc(root) {
  for (const el of $$('[data-sc]:not([data-filled])', root)) {
    el.dataset.filled = '1';
    const m = inList(Number(el.dataset.sc)) || movies.get(Number(el.dataset.sc));
    if (m) senscritique(m).then((d) => d?.rating && el.isConnected && (el.outerHTML = `<span class="badge sc">SC ${fr1(d.rating)}</span>`));
  }
}

function hydrate(root) {
  markNearby(root);
  fillLogos(root);
  fillSc(root);
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => ((t.hidden = true), action.run());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 4500 : 2400);
}

const errorBox = (e) => `<div class="error">${esc(e.message || e)}</div>`;

// Rafraîchit les boutons + d'un film partout à l'écran après une action.
function refreshMovieUi(id) {
  const saved = inList(id);
  const inTodo = saved && saved.status !== 'hidden';
  for (const q of $$(`[data-quick="${id}"]`)) {
    q.classList.toggle('on', !!inTodo);
    q.innerHTML = q.dataset.heroQuick !== undefined ? `${icon(inTodo ? 'check' : 'plus')}${inTodo ? 'Dans la liste' : 'Ma liste'}` : icon(inTodo ? 'check' : 'plus');
  }
  updateSideCounts();
}

// Ajout / retrait instantané, avec annulation.
function quickToggle(id) {
  const m = movies.get(id) || inList(id);
  const saved = inList(id);
  const done = (e) => {
    if (e) toast(e.message);
    refreshMovieUi(id);
    if (currentTab === 'liste' && sheet.hidden) render(false);
  };
  if (saved && saved.status !== 'hidden') {
    const snapshot = { ...saved };
    listAction({ action: 'remove', movieId: id }, done);
    toast('Retiré de la liste', {
      label: 'Annuler',
      run: () => {
        listAction({ action: 'add', movie: snapshot, status: snapshot.status }, done);
        refreshMovieUi(id);
      },
    });
  } else if (m) {
    if (saved) listAction({ action: 'setStatus', movieId: id, status: 'todo' }, done);
    else listAction({ action: 'add', movie: m }, done);
    toast(`« ${m.title} » ajouté à la liste`);
  }
  refreshMovieUi(id);
}

// ---------- Thèmes ----------

const THEMES = [
  { key: 'famille', label: 'En famille', params: { with_genres: '10751' } },
  { key: 'animation', label: 'Animation', params: { with_genres: '16' } },
  { key: 'comedie', label: 'Comédie', params: { with_genres: '35' } },
  { key: 'aventure', label: 'Aventure', params: { with_genres: '12' } },
  { key: 'sf', label: 'Science-fiction', params: { with_genres: '878' } },
  { key: 'action', label: 'Action', params: { with_genres: '28' } },
  { key: 'thriller', label: 'Thriller', params: { with_genres: '53' } },
  { key: 'polar', label: 'Polar et enquêtes', params: { with_genres: '80|9648' } },
  { key: 'drame', label: 'Drame', params: { with_genres: '18' } },
  { key: 'romance', label: 'Romance', params: { with_genres: '10749' } },
  { key: 'horreur', label: 'Horreur', params: { with_genres: '27' } },
  { key: 'docu', label: 'Documentaire', params: { with_genres: '99' } },
  { key: 'francais', label: 'Cinéma français', params: { with_origin_country: 'FR' } },
  { key: 'classiques', label: 'Grands classiques', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 5000 } },
  { key: 'vrai', label: 'Histoires vraies', keyword: 'based on true story' },
  { key: 'livres', label: 'Adaptés de livres', keyword: 'based on novel or book' },
  { key: 'heros', label: 'Super-héros', keyword: 'superhero' },
  { key: 'temps', label: 'Voyage dans le temps', keyword: 'time travel' },
  { key: 'braquage', label: 'Casses et braquages', keyword: 'heist' },
  { key: 'noel', label: 'Noël', keyword: 'christmas' },
];

async function themeParams(theme) {
  if (theme.params) return theme.params;
  const id = await keywordId(theme.keyword);
  if (!id) throw new Error('Thème introuvable');
  return { with_keywords: String(id) };
}

// ---------- Thème clair / sombre ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && darkQuery.matches);
  $('meta[name="theme-color"]').content = dark ? '#0b0b0d' : '#ffffff';
  if (settings.font && settings.font !== 'host') document.documentElement.dataset.font = settings.font;
  else delete document.documentElement.dataset.font;
}
darkQuery.addEventListener('change', applyTheme);
applyTheme();

// ---------- Navigation et rendu ----------

const TITLES = { accueil: 'Accueil', liste: 'Notre liste', cine: 'Au cinéma', streaming: 'Streaming', prix: 'Récompenses', explorer: 'Explorer', reglages: 'Réglages' };
let currentTab = 'accueil';
const vs = {
  listeStatus: 'todo', listeFilter: 'all', listeSort: 'wants', listeView: 'rows', listeGroup: false,
  cineMode: 'now', cineDay: today(),
  streamProvider: 'mine', streamSort: 'popular', streamGenre: '',
  prixFest: 'cannes', prixYear: 0, cineFr: false, cineNear: false,
};

function setTools(html, onClick) {
  const tools = $('#view-tools');
  tools.innerHTML = html;
  tools.hidden = !html;
  tools.onclick = onClick || null;
}

function updateSideCounts() {
  const n = list.items.filter((i) => i.status === 'todo').length;
  $('#count-todo').textContent = n || '';
  $('#count-cine').textContent = nowPlayingIds.size || '';
  drawSideList();
}

// Barre latérale (ordinateur) : à voir ce soir, plateformes, famille.
let sideToken = 0;
async function drawSideList() {
  if (!matchMedia('(min-width: 1024px)').matches) return;
  const token = ++sideToken;
  const todo = list.items.filter((i) => i.status === 'todo');
  const box = $('#side-tonight');
  if (!todo.length) {
    box.innerHTML = listLoaded ? `<div class="side-label">À voir</div><button class="side-mini" data-tab="explorer"><span class="poster-wrap" style="display:grid;place-items:center">${icon('plus')}</span><span><b>Ajouter un film</b><small>Explorez les tendances</small></span></button>` : '';
  } else {
    const mine = new Set(settings.providers);
    const avail = await Promise.all(todo.map((i) => providersFor(i.id)));
    if (token !== sideToken) return;
    const rows = todo.map((i, k) => ({ i, p: (avail[k]?.flatrate || []).find((p) => mine.has(p.provider_id)) }));
    const score = (r) => (r.p ? 3 : 0) + (nowPlayingIds.has(r.i.id) ? 2 : 0) + (r.i.wants?.length || 0);
    rows.sort((a, b) => score(b) - score(a));
    const sub = ({ i, p }) =>
      p
        ? `<img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}`
        : nowPlayingIds.has(i.id)
          ? '<span class="hot">Au cinéma</span>'
          : isFuture(i.release_date)
            ? `<span class="soon">Sortie J-${daysUntil(i.release_date)}</span>`
            : esc([year(i.release_date), ...genreNames(i, 1)].filter(Boolean).join(' · '));
    box.innerHTML =
      `<div class="side-label">À voir ce soir<button class="side-edit" data-tab="liste">Tout (${todo.length})</button></div>` +
      rows
        .slice(0, 5)
        .map((r) => `<button class="side-mini" data-movie="${r.i.id}">${posterBox(r.i.poster_path, '', 'w92')}<span><b>${esc(r.i.title)}</b><small>${sub(r)}</small></span></button>`)
        .join('');
  }
  const names = [...new Set(list.items.flatMap((i) => [i.addedBy, ...(i.wants || [])]).filter((n) => n && n !== '?'))];
  const seen = list.items.filter((i) => i.status === 'seen').length;
  $('#side-family').innerHTML = names.length
    ? `<div class="side-label">La famille</div><div class="side-family"><span class="avatars">${names.map(avatar).join('')}</span><span>${names.length} membre${names.length > 1 ? 's' : ''} · ${seen} vu${seen > 1 ? 's' : ''}</span></div>`
    : '';
}

function drawSidebar() {
  $('#side-name').textContent = settings.name || 'Profil';
  $('#side-avatar').innerHTML = settings.name ? avatar(settings.name) : '';
  loadAllProviders()
    .then((all) => {
      const mine = all.filter((p) => settings.providers.includes(p.provider_id));
      const el = $('#side-providers');
      el.classList.toggle('empty-pick', !mine.length);
      el.innerHTML = mine.length
        ? mine.map((p) => `<button data-provider="${p.provider_id}" title="${esc(p.provider_name)}"><img src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}"></button>`).join('')
        : all.slice(0, 5).map((p) => `<button data-tab="reglages" title="${esc(p.provider_name)}"><img src="${IMG}w92${p.logo_path}" alt=""></button>`).join('') +
          '<button class="side-cta" data-tab="reglages">Choisir vos abonnements →</button>';
    })
    .catch(() => {});
  drawSideList();
}

let renderToken = 0;
async function render(animate = true) {
  const token = ++renderToken;
  const alive = () => token === renderToken;
  const hour = new Date().getHours();
  $('#view-title').innerHTML =
    currentTab === 'accueil' && settings.name
      ? `<span class="greet"><span><small>${hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'} ${esc(settings.name)}</small><b>Qu'est-ce qu'on regarde ?</b></span></span>`
      : esc(TITLES[currentTab]);
  $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  document.body.dataset.view = currentTab;
  const view = $('#view');
  if (animate) {
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  }
  if (!settings.name && currentTab !== 'reglages') return renderWelcome(view);
  try {
    await { accueil: renderAccueil, liste: renderListe, cine: renderCine, streaming: renderStreaming, prix: renderPrix, explorer: renderExplorer, reglages: renderReglages }[currentTab](view, alive);
  } catch (e) {
    if (alive()) view.innerHTML = errorBox(e);
  }
}

function go(tab) {
  if (!sheet.hidden) closeSheet(false);
  if (tab === currentTab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  const run = () => {
    currentTab = tab;
    window.scrollTo(0, 0);
    render(!document.startViewTransition);
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run);
  else run();
}

function renderWelcome(view) {
  setTools('');
  view.innerHTML = `
    <div class="empty" style="padding-top:30px"><b>Bienvenue dans Nos films</b>La watchlist de la famille : streaming, cinéma et séances près de chez vous.</div>
    <form id="welcome" class="form" style="margin:0 auto">
      <div class="field"><label for="w-name">Ton prénom</label><input class="input" id="w-name" required autocomplete="given-name" placeholder="Jean-Baptiste"></div>
      <div class="field"><label for="w-code">Code famille</label><input class="input" id="w-code" autocomplete="off" placeholder="Laisse vide s'il n'y en a pas"></div>
      <button class="btn block">Commencer</button>
    </form>`;
  $('#welcome').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ name: $('#w-name').value.trim(), familyCode: $('#w-code').value.trim() });
    drawSidebar();
    render();
  });
}

// ---------- Accueil ----------

let heroTimer;
async function renderAccueil(view, alive) {
  setTools('');
  clearInterval(heroTimer);
  view.innerHTML = `
    <div id="hero" class="hero"><div class="hero-body" style="width:100%"><div class="sk" style="height:46px;width:70%"></div><div class="sk sk-line" style="width:50%"></div></div></div>
    <section class="section"><div id="bento" class="bento">${'<div class="tile sk"></div>'.repeat(4)}</div></section>
    <div id="home-rows">${sectionHtml('Recommandés pour vous', skRail())}${sectionHtml('Top 10 de la semaine', skRail())}</div>`;

  const [, , trend] = await Promise.all([
    listLoaded ? null : fetchList().catch(() => {}),
    nowPlayingIds.size ? null : loadNowPlaying().catch(() => {}),
    tmdb('trending/movie/week').then((d) => remember(d.results)).catch(() => []),
  ]);
  if (!alive()) return;
  updateSideCounts();

  const items = list.items;
  const todo = items.filter((i) => i.status === 'todo');
  const profile = items.length ? await buildProfile(items).catch(() => null) : null;
  if (!alive()) return;
  const recos = profile ? remember(await recommendationsFrom(profile, 30)) : [];

  // Bannière : recommandations d'abord, sinon tendances.
  const useRecos = recos.filter((m) => m.backdrop_path).length >= 3;
  drawHero((useRecos ? recos : trend).filter((m) => m.backdrop_path).slice(0, 5), useRecos ? 'Recommandé pour vous' : 'Tendance cette semaine', alive);

  drawBento(todo, alive);

  const rows = $('#home-rows');
  const blocks = [];
  if (todo.length) blocks.push({ id: 'tonight', title: 'À voir ce soir', sub: 'Dans votre liste et sur vos plateformes' });
  blocks.push({ id: 'reco', title: 'Recommandés pour vous', sub: profile ? 'D’après vos envies et vos notes' : 'Ajoutez et notez des films pour les affiner' });
  blocks.push({ id: 'top', title: 'Top 10 de la semaine', sub: 'Les films les plus regardés en ce moment' });
  blocks.push({ id: 'stream', title: 'Sur vos plateformes', sub: settings.providers.length ? 'Choisis pour vous' : '' });
  blocks.push({ id: 'soon', title: 'Bientôt au cinéma', sub: profile ? 'Les sorties qui vous ressemblent' : 'Les prochaines sorties' });
  blocks.push({ id: 'now', title: 'À l’affiche', sub: profile ? 'Classés selon vos goûts' : '' });
  blocks.push({ id: 'fr', title: 'Cinéma français', sub: 'Les films français du moment, en salles et en streaming' });
  (profile?.liked || []).slice(0, 2).forEach((l, k) => blocks.push({ id: `because${k}`, title: `Parce que vous avez aimé ${l.title}`, seed: l }));
  rows.innerHTML = blocks.map((b) => `<div data-sec="${b.id}">${sectionHtml(b.title, skRail(), { sub: b.sub })}</div>`).join('');

  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const fill = (id, html) => {
    const el = rows.querySelector(`[data-sec="${id}"]`);
    if (!el || !alive()) return;
    el.innerHTML = html;
    hydrate(el);
  };
  const fillRail = (id, arr, opts = {}, empty = '') =>
    fill(id, arr.length ? sectionHtml(byId[id].title, railHtml(arr.slice(0, 14), opts), { sub: byId[id].sub, all: arr }) : empty ? sectionHtml(byId[id].title, `<p class="hint">${empty}</p>`) : '');
  const safe = (id, fn) => fn().catch((e) => fill(id, sectionHtml(byId[id].title, errorBox(e))));

  if (byId.tonight)
    safe('tonight', async () => {
      const mine = new Set(settings.providers);
      const avail = await Promise.all(todo.map((i) => providersFor(i.id)));
      const ok = todo.filter((_, k) => (avail[k]?.flatrate || []).some((p) => mine.has(p.provider_id)));
      fillRail('tonight', ok, { logos: true }, settings.providers.length ? 'Aucun film de la liste n’est sur vos plateformes pour l’instant.' : 'Choisissez vos plateformes dans Réglages.');
    });
  fillRail('reco', recos.length ? recos : trend);
  fill('top', sectionHtml(byId.top.title, topHtml(trend), { sub: byId.top.sub }));
  safe('stream', async () => {
    if (!settings.providers.length) return fill('stream', sectionHtml(byId.stream.title, '<button class="btn secondary" data-tab="reglages">Choisir nos plateformes</button>'));
    const base = { watch_region: 'FR', with_watch_providers: settings.providers.join('|'), with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', 'vote_count.gte': 50 };
    const topGenres = profile ? topEntries(profile.genres, 3).map((g) => g.id).join('|') : '';
    const pool = await Promise.all([pages('discover/movie', { ...base, ...(topGenres ? { with_genres: topGenres } : {}) }, 2), pages('discover/movie', base, 2)]);
    const all = remember([...new Map(pool.flat().map((m) => [m.id, m])).values()]);
    fillRail('stream', profile ? remember(await deepRank(all, profile, { limit: 24, deep: 16 })) : all, { logos: true });
  });
  safe('soon', async () => {
    const up = remember((await pages('movie/upcoming', {}, 4)).filter((m) => isFuture(m.release_date)));
    const picks = profile ? remember(await deepRank(up, profile, { limit: 24, deep: 18 })) : up.sort((a, b) => a.release_date.localeCompare(b.release_date));
    fillRail('soon', picks, { fullDate: true });
  });
  safe('now', async () => {
    const now = remember(await pages('movie/now_playing', {}, 3));
    fillRail('now', profile ? remember(await deepRank(now, profile, { limit: 24, deep: 14 })) : now);
  });
  safe('fr', async () => {
    const recent = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const base = { with_origin_country: 'FR', with_original_language: 'fr', sort_by: 'popularity.desc', 'primary_release_date.gte': recent, 'vote_count.gte': 5 };
    const fr = remember(await pages('discover/movie', base, 3));
    fillRail('fr', profile ? remember(await deepRank(fr, profile, { limit: 30, deep: 12 })) : fr, { logos: true });
  });
  for (const b of blocks.filter((x) => x.seed))
    safe(b.id, async () => {
      const d = await movieDetails(b.seed.id);
      fillRail(b.id, remember((d.recommendations?.results || []).filter((m) => !profile.exclude.has(m.id))), { why: '' });
    });
}

function drawHero(arr, eyebrow, alive) {
  const el = $('#hero');
  if (!el) return;
  if (!arr.length) return el.remove();
  let k = 0;
  const show = () => {
    if (!alive() || !el.isConnected) return clearInterval(heroTimer);
    const m = arr[k];
    const saved = inList(m.id);
    const inTodo = saved && saved.status !== 'hidden';
    el.innerHTML = `
      <div class="hero-bg"><img src="${IMG}w1280${m.backdrop_path}" alt="" fetchpriority="high"></div>
      <div class="hero-body">
        <div class="hero-eyebrow">${esc(m._why && useWhy(eyebrow) ? m._why.split(' et ')[0] : eyebrow)}</div>
        <h2>${esc(m.title)}</h2>
        <div class="meta">${[year(m.release_date), ...genreNames(m, 2), m.vote_average ? `★ ${fr1(m.vote_average)}` : ''].filter(Boolean).map(esc).join('<span class="dot"></span>')}${nowPlayingIds.has(m.id) ? '<span class="badge red">Au cinéma</span>' : ''}</div>
        <p>${esc(m.overview || '')}</p>
        <div class="btn-row">
          <button class="btn ${inTodo ? 'on' : ''}" data-quick="${m.id}" data-hero-quick>${icon(inTodo ? 'check' : 'plus')}${inTodo ? 'Dans la liste' : 'Ma liste'}</button>
          <button class="btn secondary" data-movie="${m.id}">Plus d'infos</button>
        </div>
        ${arr.length > 1 ? `<div class="hero-dots">${arr.map((_, i) => `<button data-hero="${i}" class="${i === k ? 'on' : ''}" aria-label="Film ${i + 1}"></button>`).join('')}</div>` : ''}
      </div>`;
  };
  const useWhy = (e) => e.startsWith('Recommandé');
  show();
  el.onclick = (e) => {
    const d = e.target.closest('[data-hero]');
    if (!d) return;
    k = Number(d.dataset.hero);
    clearInterval(heroTimer);
    show();
  };
  // Glisser sur la bannière pour changer de film.
  let x0 = null;
  el.ontouchstart = (e) => (x0 = e.touches[0].clientX);
  el.ontouchend = (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 50) return;
    k = (k + (dx < 0 ? 1 : arr.length - 1)) % arr.length;
    clearInterval(heroTimer);
    show();
  };
  clearInterval(heroTimer);
  if (arr.length > 1) heroTimer = setInterval(() => ((k = (k + 1) % arr.length), show()), 8000);
}

async function drawBento(todo, alive) {
  const el = $('#bento');
  if (!el) return;
  const seen = list.items.filter((i) => i.status === 'seen');
  const mine = new Set(settings.providers);
  const avail = await Promise.all(todo.map((i) => providersFor(i.id)));
  if (!alive()) return;
  const onMine = todo
    .map((i, k) => ({ i, p: (avail[k]?.flatrate || []).find((p) => mine.has(p.provider_id)) }))
    .filter((x) => x.p)
    .sort((a, b) => (b.i.wants?.length || 0) - (a.i.wants?.length || 0));
  const tonight = onMine[0];
  const nextOut = todo.filter((i) => isFuture(i.release_date)).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
  const avg = seen.map(familyAvg).filter(Boolean);
  const tiles = [];

  tiles.push(
    tonight
      ? `<button class="tile feature" data-movie="${tonight.i.id}">${tonight.i.backdrop_path ? `<img src="${IMG}w780${tonight.i.backdrop_path}" alt="">` : ''}<div class="in"><div class="k">Ce soir sur ${esc(tonight.p.provider_name)}</div><b>${esc(tonight.i.title)}</b></div></button>`
      : `<button class="tile" data-tab="explorer"><div class="k">${icon('search')}Ce soir</div><div class="d" style="margin-top:auto">Ajoutez des films à la liste : on vous dira lequel lancer ce soir.</div></button>`,
  );
  tiles.push(`<button class="tile" data-tab="liste"><div class="k">${icon('list')}À voir</div><div class="v">${todo.length}<small>films</small></div><div class="d">${onMine.length} sur vos plateformes · ${todo.filter((i) => nowPlayingIds.has(i.id)).length} au ciné</div></button>`);
  tiles.push(
    nextOut
      ? `<button class="tile" data-movie="${nextOut.id}"><div class="k">${icon('cine')}Prochaine sortie</div><div class="v">J-${daysUntil(nextOut.release_date)}</div><div class="d">${esc(nextOut.title)} · ${esc(shortDate(nextOut.release_date))}</div></button>`
      : `<button class="tile" data-tab="liste" data-status="seen"><div class="k">${icon('star')}Déjà vus</div><div class="v">${seen.length}<small>films</small></div><div class="d">${avg.length ? `Note moyenne ${fr1(avg.reduce((a, b) => a + b, 0) / avg.length)}/5` : 'Notez-les pour de meilleures suggestions'}</div></button>`,
  );
  tiles.push(`<button class="tile" id="tile-seances" data-tab="cine" data-cine="prog"><div class="k">${icon('ticket')}Séances aujourd'hui</div><div class="d" style="margin-top:auto">${settings.theaters.length ? 'Recherche…' : 'Ajoutez votre cinéma dans Réglages'}</div></button>`);
  el.innerHTML = tiles.join('');

  // Séances du jour pour les films de la liste.
  if (!settings.theaters.length) return;
  const wanted = todo.filter((i) => nowPlayingIds.has(i.id) || (i.release_date && Math.abs(daysUntil(i.release_date)) < 60));
  const res = await Promise.all(settings.theaters.map((t) => seances(t.id, today()).catch(() => null)));
  const tile = $('#tile-seances');
  if (!alive() || !tile) return;
  const now = new Date().toTimeString().slice(0, 5);
  const hits = [];
  res.forEach((d, k) => {
    if (!d) return;
    for (const i of wanted) {
      const keys = new Set([normalize(i.title), normalize(i.original_title)]);
      const mv = d.movies.find((x) => keys.has(normalize(x.title)) || keys.has(normalize(x.originalTitle)));
      if (mv) hits.push({ i, t: settings.theaters[k], times: mv.showtimes.filter((s) => s.time >= now) });
    }
  });
  const first = hits.find((h) => h.times.length);
  tile.innerHTML = first
    ? `<div class="k">${icon('ticket')}Séances aujourd'hui</div><div class="v" style="font-size:20px">${esc(first.i.title)}</div><div class="d">${esc(first.t.name)}</div><div class="mini-times">${first.times.slice(0, 4).map((s) => `<span>${esc(s.time)}${s.version ? ` ${esc(s.version)}` : ''}</span>`).join('')}</div>`
    : `<div class="k">${icon('ticket')}Séances aujourd'hui</div><div class="d" style="margin-top:auto">${res.some(Boolean) ? 'Aucun film de la liste dans vos cinémas aujourd’hui. Voir le programme.' : 'Séances indisponibles pour le moment.'}</div>`;
}

// ---------- Notre liste ----------

async function renderListe(view, alive) {
  if (!listLoaded) view.innerHTML = skGrid(9);
  await Promise.all([listLoaded ? null : fetchList(), nowPlayingIds.size ? null : loadNowPlaying().catch(() => {}), genres().then((g) => (genreMap = g)).catch(() => {})]);
  if (!alive()) return;
  updateSideCounts();

  const seg = (pairs, key, attr) => `<div class="seg">${pairs.map(([k, l]) => `<button class="${vs[key] === k ? 'on' : ''}" data-${attr}="${k}">${l}</button>`).join('')}</div>`;
  const counts = { todo: 0, seen: 0, hidden: 0 };
  list.items.forEach((i) => (counts[i.status || 'todo'] += 1));
  setTools(
    seg([['todo', `À voir${counts.todo ? ` <span class="n">${counts.todo}</span>` : ''}`], ['seen', `Vus${counts.seen ? ` <span class="n">${counts.seen}</span>` : ''}`], ['hidden', 'Écartés']], 'listeStatus', 'ls') +
      '<span class="sep"></span>' +
      [['all', 'Tout'], ['cine', 'Au ciné'], ['mine', 'Sur nos plateformes'], ['soon', 'Bientôt']].map(([k, l]) => `<button class="chip ${vs.listeFilter === k ? 'on' : ''}" data-lf="${k}">${l}</button>`).join('') +
      `<select class="chip" id="lsort" aria-label="Trier">${[['wants', 'Les plus attendus'], ['recent', 'Ajoutés récemment'], ['release', 'Date de sortie'], ['rating', 'Mieux notés']]
        .map(([k, l]) => `<option value="${k}" ${vs.listeSort === k ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>` +
      `<button class="chip ${vs.listeGroup ? 'on' : ''}" data-lg="1">Par genre</button>` +
      seg([['rows', 'Liste'], ['grid', 'Affiches']], 'listeView', 'lv'),
    (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ls) vs.listeStatus = b.dataset.ls;
      if (b.dataset.lf) vs.listeFilter = b.dataset.lf;
      if (b.dataset.lv) vs.listeView = b.dataset.lv;
      if (b.dataset.lg) vs.listeGroup = !vs.listeGroup;
      render(false);
    },
  );
  $('#lsort').onchange = (e) => {
    vs.listeSort = e.target.value;
    render(false);
  };

  let items = list.items.filter((i) => (i.status || 'todo') === vs.listeStatus);
  if (vs.listeFilter === 'cine') items = items.filter((i) => nowPlayingIds.has(i.id));
  if (vs.listeFilter === 'soon') items = items.filter((i) => isFuture(i.release_date));
  if (vs.listeFilter === 'mine') {
    const mine = new Set(settings.providers);
    const avail = await Promise.all(items.map((i) => providersFor(i.id)));
    if (!alive()) return;
    items = items.filter((_, k) => (avail[k]?.flatrate || []).some((p) => mine.has(p.provider_id)));
  }
  const sorters = {
    wants: (a, b) => (b.wants?.length || 0) - (a.wants?.length || 0) || familyAvg(b) - familyAvg(a) || (b.addedAt || '').localeCompare(a.addedAt || ''),
    recent: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
    release: (a, b) => (b.release_date || '').localeCompare(a.release_date || ''),
    rating: (a, b) => familyAvg(b) - familyAvg(a) || (b.vote_average || 0) - (a.vote_average || 0),
  };
  items.sort(sorters[vs.listeSort]);

  const people = new Set(list.items.flatMap((i) => [i.addedBy, ...(i.wants || [])]).filter(Boolean));
  const stats = `<div class="stats"><span><b>${counts.todo}</b>à voir</span><span><b>${counts.seen}</b>vus</span><span><b>${list.items.filter((i) => nowPlayingIds.has(i.id) && i.status === 'todo').length}</b>au ciné</span><span><b>${people.size}</b>dans la famille</span></div>`;

  if (!items.length) {
    view.innerHTML =
      stats +
      `<div class="empty"><b>${{ seen: 'Aucun film vu pour l’instant', hidden: 'Aucun film écarté', todo: 'Rien ici pour l’instant' }[vs.listeStatus]}</b>${
        vs.listeStatus === 'todo' && vs.listeFilter === 'all' ? 'Touchez + sur une affiche pour l’ajouter à la liste.' : 'Essayez un autre filtre.'
      }</div>${vs.listeStatus === 'todo' ? '<div style="text-align:center"><button class="btn" data-tab="explorer">Trouver des films</button></div>' : ''}`;
    return;
  }

  const rowHtml = (i) => {
    const status = nowPlayingIds.has(i.id) ? '<span class="badge red">Au ciné</span>' : isFuture(i.release_date) ? `<span class="badge plain">Sortie le ${esc(shortDate(i.release_date))}</span>` : '';
    const avg = familyAvg(i);
    const iWant = (i.wants || []).includes(settings.name);
    return `<div class="lrow">
      <button data-movie="${i.id}">${posterBox(i.poster_path, i.title, 'w185')}</button>
      <button data-movie="${i.id}" style="text-align:left;min-width:0">
        <h3>${esc(i.title)}</h3>
        <div class="meta">${[year(i.release_date), ...genreNames(i, 2)].filter(Boolean).map(esc).join(' · ')}${i.vote_average ? ` · ★ ${fr1(i.vote_average)}` : ''}</div>
        <div class="line">${status}<span data-sc="${i.id}"></span>${avg ? `<span class="badge plain">Nous ${fr1(avg)}/5</span>` : ''}<span class="avatars">${(i.wants || []).map(avatar).join('')}</span><span class="logos" data-logos="${i.id}" style="margin:0"></span></div>
        ${i.note ? `<div class="note">« ${esc(i.note)} »</div>` : ''}
      </button>
      <div class="acts">
        ${i.status === 'todo' ? `<button class="act ${iWant ? 'on' : ''}" data-want-row="${i.id}" title="Je veux le voir" aria-label="Je veux le voir">${icon('star')}</button>` : ''}
        <button class="act ${i.status === 'seen' ? 'on' : ''}" data-seen-row="${i.id}" title="${i.status === 'seen' ? 'Remettre à voir' : 'Marquer comme vu'}" aria-label="Vu">${icon('check')}</button>
      </div>
    </div>`;
  };
  const body = (its) => (vs.listeView === 'grid' ? gridHtml(its, { logos: true }) : `<div class="rows">${its.map(rowHtml).join('')}</div>`);

  if (vs.listeGroup) {
    const groups = new Map();
    for (const i of items) {
      const g = genreMap.get((i.genre_ids || [])[0]) || 'Autres';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    }
    view.innerHTML = stats + [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([g, its]) => `<div class="group-title">${esc(g)}<span>${its.length}</span></div>${body(its)}`).join('');
  } else {
    view.innerHTML = stats + body(items);
  }
  hydrate(view);
}

// ---------- Cinéma ----------

function nextDays(n = 7) {
  const out = [];
  const d = new Date();
  for (let k = 0; k < n; k++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
    out.push({ iso: isoDay(day), label: k === 0 ? "Aujourd'hui" : k === 1 ? 'Demain' : day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) });
  }
  return out;
}

async function renderCine(view, alive) {
  setTools(
    `<div class="seg">${[['now', "À l'affiche"], ['soon', 'Prochainement'], ['prog', 'Séances']].map(([k, l]) => `<button class="${vs.cineMode === k ? 'on' : ''}" data-cm="${k}">${l}</button>`).join('')}</div>` +
      (vs.cineMode === 'now' && settings.theaters.length ? `<button class="chip ${vs.cineNear ? 'on' : ''}" data-cnear="1">${icon('ticket')}Dans mes cinémas</button>` : '') +
      (vs.cineMode !== 'prog' ? `<button class="chip ${vs.cineFr ? 'on' : ''}" data-cfr="1">Films français</button>` : ''),
    (e) => {
      const b = e.target.closest('[data-cm], [data-cfr], [data-cnear]');
      if (!b) return;
      if (b.dataset.cm) vs.cineMode = b.dataset.cm;
      else if (b.dataset.cnear) vs.cineNear = !vs.cineNear;
      else vs.cineFr = !vs.cineFr;
      render(false);
    },
  );
  if (!listLoaded) fetchList().catch(() => {});
  if (vs.cineMode === 'prog') return renderProgramme(view, alive);
  view.innerHTML = skGrid(12);

  if (vs.cineMode === 'now') {
    let now = remember((await loadNowPlaying()).sort((a, b) => b.popularity - a.popularity));
    if (vs.cineFr) now = await frenchOnly(now);
    await loadNearby();
    if (!alive()) return;
    const nearCount = now.filter((m) => nearbyFor(m)).length;
    if (vs.cineNear) now = now.filter((m) => nearbyFor(m));
    // Les films qui passent près de chez nous d'abord.
    now.sort((a, b) => !!nearbyFor(b) - !!nearbyFor(a));
    const info = settings.theaters.length ? ` · ${nearCount} dans vos cinémas cette semaine` : ' · ajoutez vos cinémas dans Réglages pour voir ceux qui passent près de chez vous';
    view.innerHTML = `<p class="hint" style="margin:0 0 14px">${now.length} films ${vs.cineFr ? 'français ' : ''}à l’affiche${info}</p>` + gridHtml(now, { noCine: true });
    hydrate(view);
    return;
  }
  let up = remember((await pages('movie/upcoming', {}, 5)).filter((m) => isFuture(m.release_date)).sort((a, b) => a.release_date.localeCompare(b.release_date)));
  if (vs.cineFr) up = await frenchOnly(up);
  if (!alive()) return;
  const bucket = (d) => {
    const n = daysUntil(d);
    if (n <= 7) return 'Cette semaine';
    if (n <= 14) return 'La semaine prochaine';
    const s = fmtDate(d, { month: 'long', year: 'numeric' });
    return s[0].toUpperCase() + s.slice(1);
  };
  const groups = new Map();
  for (const m of up) {
    const b = bucket(m.release_date);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(m);
  }
  view.innerHTML = [...groups.entries()].map(([g, ms]) => sectionHtml(g, gridHtml(ms, { fullDate: true }), { sub: `${ms.length} sortie${ms.length > 1 ? 's' : ''}` })).join('') || '<div class="empty"><b>Aucune sortie annoncée</b></div>';
}

// Films de production française : langue originale française, pays vérifié sur la fiche.
async function frenchOnly(arr) {
  const cands = arr.filter((m) => !m.original_language || m.original_language === 'fr');
  const det = await Promise.all(cands.map((m) => movieDetails(m.id).catch(() => null)));
  return cands.filter((m, k) => !det[k] || (det[k].origin_country || det[k].production_countries?.map((c) => c.iso_3166_1) || []).includes('FR'));
}

async function renderProgramme(view, alive) {
  if (!settings.theaters.length) {
    view.innerHTML = `<div class="empty"><b>Aucun cinéma enregistré</b>Ajoutez vos cinémas pour voir leurs séances ici.</div><div style="text-align:center"><button class="btn" data-tab="reglages">Ajouter un cinéma</button></div>`;
    return;
  }
  view.innerHTML =
    `<div class="days">${nextDays(7).map((d) => `<button class="chip ${vs.cineDay === d.iso ? 'on' : ''}" data-day="${d.iso}">${esc(d.label)}</button>`).join('')}</div>` +
    settings.theaters.map((t) => `<section class="section" data-theater="${esc(t.id)}"><div class="section-head"><h2>${esc(t.name || t.id)}</h2></div><div class="sk" style="height:140px"></div></section>`).join('');
  $('.days', view).onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (b) {
      vs.cineDay = b.dataset.day;
      renderProgramme(view, alive);
    }
  };
  const listKeys = new Map(list.items.filter((i) => i.status === 'todo').flatMap((i) => [[normalize(i.title), i], [normalize(i.original_title), i]]));
  const mineOf = (m) => listKeys.get(normalize(m.title)) || listKeys.get(normalize(m.originalTitle));
  for (const t of settings.theaters) {
    const box = view.querySelector(`[data-theater="${CSS.escape(t.id)}"]`);
    seances(t.id, vs.cineDay)
      .then((d) => {
        if (!alive() || !box.isConnected) return;
        const sorted = [...d.movies].sort((a, b) => !!mineOf(b) - !!mineOf(a));
        box.innerHTML = `<div class="section-head"><div><h2>${esc(t.name || d.theaterName || t.id)}</h2><p>${d.movies.length} films</p></div><a class="more" href="${esc(d.url)}" target="_blank" rel="noopener">Allociné${icon('chev')}</a></div>${
          sorted.length
            ? sorted
                .map((m) => `<div class="theater"><div class="name"><button data-find="${esc(m.title)}" style="text-align:left">${esc(m.title)} ${mineOf(m) ? '<span class="badge green">Dans la liste</span>' : ''}</button></div><div class="times">${m.showtimes.map(timeChip).join('')}</div></div>`)
                .join('')
            : '<p class="hint">Pas de séance trouvée ce jour-là.</p>'
        }`;
      })
      .catch((e) => {
        if (!box.isConnected) return;
        box.innerHTML = `<div class="section-head"><h2>${esc(t.name || t.id)}</h2></div><p class="hint">${esc(e.message)}. <a class="link" href="https://www.allocine.fr/seance/salle_gen_csalle=${esc(t.id)}.html" target="_blank" rel="noopener">Voir sur Allociné</a></p>`;
      });
  }
}

function timeChip(s) {
  const extra = [s.version, ...(s.tags || [])].filter(Boolean).join(' ');
  const inner = `${esc(s.time)}${extra ? `<small>${esc(extra)}</small>` : ''}`;
  return s.bookingUrl ? `<a class="time" href="${esc(s.bookingUrl)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="time">${inner}</span>`;
}

// ---------- Streaming ----------

async function renderStreaming(view, alive) {
  view.innerHTML = skGrid(12);
  const all = await loadAllProviders().catch(() => []);
  await genres().then((g) => (genreMap = g)).catch(() => {});
  if (!alive()) return;
  const mine = all.filter((p) => settings.providers.includes(p.provider_id));
  const others = all.filter((p) => !settings.providers.includes(p.provider_id)).slice(0, 12);
  if (vs.streamProvider === 'mine' && !mine.length) vs.streamProvider = String(all[0]?.provider_id || 8);

  setTools(
    (mine.length ? `<button class="chip ${vs.streamProvider === 'mine' ? 'on' : ''}" data-sp="mine">Nos plateformes</button>` : '') +
      [...mine, ...others].map((p) => `<button class="chip ${String(vs.streamProvider) === String(p.provider_id) ? 'on' : ''}" data-sp="${p.provider_id}"><img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</button>`).join(''),
    (e) => {
      const b = e.target.closest('[data-sp]');
      if (!b) return;
      vs.streamProvider = b.dataset.sp;
      render(false);
    },
  );

  const provider = all.find((p) => String(p.provider_id) === String(vs.streamProvider));
  view.innerHTML = `
    <div class="subtools">
      <div class="seg">${[['popular', 'Populaires'], ['new', 'Nouveautés'], ['top', 'Mieux notés'], ['soon', 'Bientôt en VOD']].map(([k, l]) => `<button class="${vs.streamSort === k ? 'on' : ''}" data-ss="${k}">${l}</button>`).join('')}</div>
      <select class="chip" id="sgenre" aria-label="Genre"><option value="">Tous les genres</option>${[...genreMap.entries()].map(([id, name]) => `<option value="${id}" ${String(vs.streamGenre) === String(id) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      <span class="hint" id="stream-count"></span>
    </div>
    <div id="stream-note"></div>
    <div id="stream-grid">${skGrid(12)}</div>
    <div id="sentinel" style="height:40px"></div>`;
  $('.seg', view).onclick = (e) => {
    const b = e.target.closest('[data-ss]');
    if (b) {
      vs.streamSort = b.dataset.ss;
      render(false);
    }
  };
  $('#sgenre').onchange = (e) => {
    vs.streamGenre = e.target.value;
    render(false);
  };

  const params = { watch_region: 'FR', with_watch_monetization_types: 'flatrate|free|ads' };
  if (vs.streamSort === 'soon') {
    // TMDB ne donne pas la date d'arrivée sur une plateforme précise : on montre les sorties VOD françaises annoncées.
    delete params.with_watch_monetization_types;
    delete params.watch_region;
    Object.assign(params, { region: 'FR', with_release_type: '4', 'release_date.gte': today(), sort_by: 'popularity.desc' });
    $('#stream-note').innerHTML = `<p class="hint" style="margin:0 0 14px">Films dont la sortie en VOD est annoncée en France, toutes plateformes confondues. La fiche de chaque film indique où il sera disponible dès que c’est connu.</p>`;
  } else {
    params.with_watch_providers = vs.streamProvider === 'mine' ? settings.providers.join('|') : String(vs.streamProvider);
    if (vs.streamSort === 'popular') params.sort_by = 'popularity.desc';
    if (vs.streamSort === 'new') Object.assign(params, { sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today(), 'vote_count.gte': 3 });
    if (vs.streamSort === 'top') Object.assign(params, { sort_by: 'vote_average.desc', 'vote_count.gte': 400 });
  }
  if (vs.streamGenre) params.with_genres = vs.streamGenre;

  let page = 0;
  let total = 1;
  let loading = false;
  const load = async () => {
    if (loading || page >= Math.min(total, 40)) return;
    loading = true;
    page += 1;
    try {
      const d = await tmdb('discover/movie', { ...params, page });
      if (!alive()) return;
      total = d.total_pages || 1;
      let res = remember(d.results);
      if (vs.streamSort === 'soon') {
        const det = await Promise.all(res.map((m) => movieDetails(m.id).catch(() => null)));
        if (!alive()) return;
        res = res.map((m, k) => ({ ...m, _sub: det[k] && frRelease(det[k]).digital ? `VOD ${shortDate(frRelease(det[k]).digital)}` : '' }));
      }
      const html = res.map((m) => movieCard(m, { logos: vs.streamSort !== 'soon', fullDate: vs.streamSort === 'new' || vs.streamSort === 'soon', sub: m._sub || '' })).join('');
      const target = $('#stream-grid');
      if (page === 1) target.innerHTML = res.length ? `<div class="grid">${html}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>';
      else target.querySelector('.grid')?.insertAdjacentHTML('beforeend', html);
      $('#stream-count').textContent = `${(d.total_results || 0).toLocaleString('fr-FR')} films${provider && vs.streamProvider !== 'mine' && vs.streamSort !== 'soon' ? ` sur ${provider.provider_name}` : ''}`;
      hydrate(target);
    } finally {
      loading = false;
    }
  };
  await load();
  if (!alive()) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (!alive()) return io.disconnect();
      if (entries[0].isIntersecting) load().catch((e) => toast(e.message));
    },
    { rootMargin: '800px' },
  );
  io.observe($('#sentinel'));
}

// ---------- Récompenses ----------

const FESTS = [
  ['cannes', 'Cannes', 5], ['venise', 'Venise', 9], ['berlin', 'Berlinale', 2], ['oscars', 'Oscars', 3], ['cesar', 'César', 2], ['bafta', 'BAFTA', 2],
];
const lastEdition = (month) => {
  const d = new Date();
  return d.getMonth() + 1 >= month ? d.getFullYear() : d.getFullYear() - 1;
};

async function renderPrix(view, alive) {
  const fest = FESTS.find((f) => f[0] === vs.prixFest) || FESTS[0];
  const latest = lastEdition(fest[2]);
  if (!vs.prixYear || vs.prixYear > latest) vs.prixYear = latest;
  const years = Array.from({ length: latest - 1999 }, (_, k) => latest - k);
  setTools(
    FESTS.map(([k, l]) => `<button class="chip ${vs.prixFest === k ? 'on' : ''}" data-pf="${k}">${l}</button>`).join('') +
      '<span class="sep"></span>' +
      `<select class="chip" id="pyear" aria-label="Année">${years.map((y) => `<option ${y === vs.prixYear ? 'selected' : ''}>${y}</option>`).join('')}</select>`,
    (e) => {
      const b = e.target.closest('[data-pf]');
      if (!b) return;
      vs.prixFest = b.dataset.pf;
      vs.prixYear = 0;
      render(false);
    },
  );
  $('#pyear').onchange = (e) => {
    vs.prixYear = Number(e.target.value);
    render(false);
  };
  if (!listLoaded) fetchList().catch(() => {});
  view.innerHTML = `<div class="sk" style="height:180px;margin-top:18px"></div>${sectionHtml('Palmarès', skRail())}${sectionHtml('Sélection', skGrid(9))}`;
  const d = await awards(fest[0], vs.prixYear);
  if (!alive()) return;
  remember([...d.winners, ...d.selection]);
  const top = d.winners[0];
  const others = d.winners.slice(1);
  const inSel = new Set(d.winners.map((w) => w.id));
  const rest = d.selection.filter((m) => !inSel.has(m.id)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const nav = `<div class="subtools" style="margin:16px calc(-1 * var(--gutter)) 0">${[vs.prixYear + 1, vs.prixYear - 1]
    .filter((y) => y <= latest && y >= 2000)
    .map((y) => `<button class="chip" data-py="${y}">${y > vs.prixYear ? `${y} →` : `← ${y}`}</button>`)
    .join('')}</div>`;
  if (!top && !d.selection.length) {
    view.innerHTML = `<div class="fest-head"><div><h2>${esc(d.festival)} ${d.year}</h2></div></div><div class="empty"><b>Pas encore de données</b>Le palmarès ${d.year} n’est pas (encore) renseigné dans Wikidata. Essayez une autre année.</div>${nav}`;
  } else {
    view.innerHTML = `
      <div class="fest-head"><div><h2>${esc(d.festival)} ${d.year}</h2><p>${d.winners.length} prix · ${d.selection.length} films en sélection</p></div></div>
      ${
        top
          ? `<button class="winner-top" data-movie="${top.id}">${posterBox(top.poster_path, top.title)}<div><div class="k">${icon('award')}${esc(top._award)}</div><h3>${esc(top.title)}</h3><p>${esc(top.overview || '')}</p><div class="logos" data-logos="${top.id}" style="margin-top:10px"></div></div></button>`
          : ''
      }
      ${others.length ? sectionHtml('Palmarès', railHtml(others, { logos: true })) : ''}
      ${rest.length ? sectionHtml(d.selectionLabel, gridHtml(rest, { logos: true }), { sub: `${rest.length} autres films` }) : ''}
      ${nav}
      <p class="hint" style="margin-top:24px">Données : Wikidata (palmarès et compétition) et TMDB.</p>`;
  }
  $$('[data-py]', view).forEach((b) => (b.onclick = () => ((vs.prixYear = Number(b.dataset.py)), render(false))));
  hydrate(view);
}

// ---------- Explorer ----------

async function renderExplorer(view, alive) {
  setTools('');
  const tiles = (arr) => `<div class="genres">${arr.map((t) => `<button class="genre" data-theme="${t.key}"><span><b>${esc(t.label)}</b></span></button>`).join('')}</div>`;
  view.innerHTML = `
    <button class="input" data-open-search style="width:100%;display:flex;align-items:center;gap:10px;color:var(--muted);text-align:left">${icon('search')}Un film, un acteur, une réalisatrice…</button>
    ${sectionHtml('Genres', tiles(THEMES.filter((t) => t.params)))}
    ${sectionHtml('Thèmes', tiles(THEMES.filter((t) => !t.params)))}
    <div id="ex-trend">${sectionHtml('Tendances de la semaine', skRail())}</div>
    <div id="ex-top">${sectionHtml('Les mieux notés de tous les temps', skRail())}</div>`;
  if (!listLoaded) fetchList().catch(() => {});

  // Une image représentative par genre ou thème.
  for (const t of THEMES) {
    themeParams(t)
      .then((p) => tmdb('discover/movie', { 'vote_count.gte': 300, sort_by: 'popularity.desc', ...p }))
      .then((d) => {
        const m = d.results.find((x) => x.backdrop_path);
        const el = view.querySelector(`[data-theme="${t.key}"]`);
        if (!m || !el || !alive()) return;
        el.insertAdjacentHTML('afterbegin', `<img loading="lazy" src="${IMG}w500${m.backdrop_path}" alt="">`);
        el.querySelector('span').insertAdjacentHTML('beforeend', `<small>${(d.total_results || 0).toLocaleString('fr-FR')} films</small>`);
      })
      .catch(() => {});
  }
  const [trend, top] = await Promise.all([tmdb('trending/movie/week').catch(() => ({ results: [] })), pages('movie/top_rated', {}, 2)]);
  if (!alive()) return;
  $('#ex-trend').innerHTML = sectionHtml('Tendances de la semaine', railHtml(remember(trend.results)), { all: trend.results });
  $('#ex-top').innerHTML = sectionHtml('Les mieux notés de tous les temps', railHtml(remember(top).slice(0, 20)), { all: top });
}

// ---------- Recherche (⌘K) ----------

const palette = $('#palette');
let paletteSel = -1;
const searchHint = '<p class="hint" style="padding:8px 12px">Tapez au moins deux lettres. Astuce : ⌘K ou / pour chercher de partout.</p>';
function openSearch() {
  palette.hidden = false;
  const input = $('#palette-q');
  input.value = '';
  $('#palette-results').innerHTML = searchHint;
  input.focus();
}
function closeSearch() {
  palette.hidden = true;
  $('#palette-q').blur();
}
let searchTimer;
$('#palette-q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value.trim()), 200);
});
$('#palette-q').addEventListener('keydown', (e) => {
  const items = $$('.p-item', palette);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    paletteSel = Math.max(0, Math.min(items.length - 1, paletteSel + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((it, k) => it.classList.toggle('sel', k === paletteSel));
    items[paletteSel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    (items[paletteSel] || items[0])?.click();
  }
});
async function runSearch(q) {
  const out = $('#palette-results');
  paletteSel = -1;
  if (q.length < 2) return (out.innerHTML = searchHint);
  try {
    const [films, people] = await Promise.all([tmdb('search/movie', { query: q, include_adult: 'false' }), tmdb('search/person', { query: q, include_adult: 'false' })]);
    if ($('#palette-q').value.trim() !== q) return;
    remember(films.results);
    const persons = people.results.filter((p) => p.profile_path || p.known_for?.length).slice(0, 5);
    const dept = (d) => ({ Acting: 'Acteur·rice', Directing: 'Réalisation', Writing: 'Scénario' })[d] || d || '';
    const filmRows = films.results
      .slice(0, 12)
      .map((m) => {
        const saved = inList(m.id);
        return `<button class="p-item" data-movie="${m.id}">${posterBox(m.poster_path, '', 'w92')}<span><b>${esc(m.title)}</b><small>${esc([year(m.release_date), ...genreNames(m, 2)].filter(Boolean).join(' · '))}</small></span>${
          saved ? `<span class="badge ${saved.status === 'seen' ? 'green' : 'plain'}">${saved.status === 'seen' ? 'Vu' : 'Dans la liste'}</span>` : ''
        }</button>`;
      })
      .join('');
    const personRows = persons
      .map((p) => `<button class="p-item" data-person="${p.id}"><span class="face">${p.profile_path ? `<img src="${IMG}w185${p.profile_path}" alt="">` : ''}</span><span><b>${esc(p.name)}</b><small>${esc(dept(p.known_for_department))}${p.known_for?.[0]?.title ? ` · ${esc(p.known_for[0].title)}` : ''}</small></span></button>`)
      .join('');
    out.innerHTML = (filmRows ? `<div class="p-group">Films</div>${filmRows}` : '') + (personRows ? `<div class="p-group">Personnes</div>${personRows}` : '') || '<p class="hint" style="padding:8px 12px">Aucun résultat.</p>';
  } catch (e) {
    out.innerHTML = errorBox(e);
  }
}

// ---------- Réglages ----------

async function renderReglages(view) {
  setTools('');
  view.innerHTML = `
    ${sectionHtml('Profil', `<form id="me" class="form">
      <div class="field"><label for="s-name">Ton prénom</label><input class="input" id="s-name" value="${esc(settings.name)}" required></div>
      <div class="field"><label for="s-code">Code famille</label><input class="input" id="s-code" value="${esc(settings.familyCode)}" autocomplete="off"></div>
      <div><button class="btn small">Enregistrer</button></div></form>`)}
    ${sectionHtml('Apparence', `<div class="seg" id="theme-seg">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button class="${(settings.theme || 'auto') === k ? 'on' : ''}" data-th="${k}">${l}</button>`).join('')}</div>`, { sub: 'Automatique suit le réglage de l’iPhone ou de l’ordinateur' })}
    ${sectionHtml('Police', `<div class="seg" id="font-seg">${[['host', 'Host Grotesk'], ['funnel', 'Funnel'], ['apple', 'Apple (SF Pro)']].map(([k, l]) => `<button class="${(settings.font || 'host') === k ? 'on' : ''}" data-fo="${k}" style="font-family:${{ host: '"Host Grotesk"', funnel: '"Funnel Display"', apple: '-apple-system, system-ui' }[k]}">${l}</button>`).join('')}</div>`, { sub: 'Essayez-les : le changement est immédiat' })}
    ${sectionHtml('Nos plateformes', `<div id="prov" class="provider-pick"><div class="sk" style="height:80px;grid-column:1/-1"></div></div>`, { sub: 'Mises en avant partout et utilisées pour les recommandations' })}
    ${sectionHtml(
      'Mes cinémas',
      `<form id="add-theater" class="form" style="margin-bottom:14px">
        <div class="field"><label for="t-url">Lien Allociné du cinéma</label><input class="input" id="t-url" placeholder="https://www.allocine.fr/seance/salle_gen_csalle=…" autocomplete="off"></div>
        <div class="field"><label for="t-name">Nom (facultatif)</label><input class="input" id="t-name" placeholder="Pathé Wilson" autocomplete="off"></div>
        <div><button class="btn small">Ajouter ce cinéma</button></div></form><div id="theaters" class="list-plain"></div>`,
      { sub: 'Sur allocine.fr, ouvrez la page de votre cinéma et copiez son adresse.' },
    )}
    ${sectionHtml('Installer sur l’iPhone', '<p class="hint">Dans Safari, bouton Partager puis « Sur l’écran d’accueil ». L’app s’ouvre alors en plein écran.</p>')}
    <p class="hint" style="margin-top:30px">Films et plateformes : TMDB et JustWatch. Séances : Allociné. Notes : SensCritique.<br>Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</p>`;

  $('#font-seg').onclick = (e) => {
    const b = e.target.closest('[data-fo]');
    if (!b) return;
    saveSettings({ font: b.dataset.fo });
    applyTheme();
    $$('#font-seg button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#theme-seg').onclick = (e) => {
    const b = e.target.closest('[data-th]');
    if (!b) return;
    saveSettings({ theme: b.dataset.th });
    applyTheme();
    $$('#theme-seg button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#me').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ name: $('#s-name').value.trim(), familyCode: $('#s-code').value.trim() });
    resetList();
    drawSidebar();
    toast('Enregistré');
  });
  const drawTheaters = () => {
    $('#theaters').innerHTML = settings.theaters.length
      ? settings.theaters.map((t) => `<div><span><b>${esc(t.name || t.id)}</b> <span class="hint">${esc(t.id)}</span></span><button class="btn danger small" data-del-theater="${esc(t.id)}">Retirer</button></div>`).join('')
      : '<div class="hint">Aucun cinéma pour l’instant.</div>';
  };
  drawTheaters();
  $('#theaters').onclick = (e) => {
    const b = e.target.closest('[data-del-theater]');
    if (!b) return;
    saveSettings({ theaters: settings.theaters.filter((t) => t.id !== b.dataset.delTheater) });
    nearbyLoaded = null;
    nearby = new Map();
    loadNearby();
    drawTheaters();
  };
  $('#add-theater').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#t-url').value.trim();
    const m = raw.match(/csalle=([A-Z0-9]+)/i) || raw.match(/theater-([A-Z0-9]+)/i) || raw.match(/^([A-Z][A-Z0-9]{3,6})$/i);
    if (!m) return toast('Lien Allociné non reconnu');
    const id = m[1].toUpperCase();
    if (settings.theaters.some((t) => t.id === id)) return toast('Déjà ajouté');
    let name = $('#t-name').value.trim();
    if (!name) {
      try {
        name = (await seances(id, today())).theaterName || '';
      } catch {}
    }
    saveSettings({ theaters: [...settings.theaters, { id, name: name || id }] });
    nearbyLoaded = null;
    loadNearby();
    $('#t-url').value = '';
    $('#t-name').value = '';
    drawTheaters();
    toast('Cinéma ajouté');
  });
  try {
    const top = (await loadAllProviders()).slice(0, 40);
    const draw = () => {
      $('#prov').innerHTML = top.map((p) => `<button class="${settings.providers.includes(p.provider_id) ? 'on' : ''}" data-prov="${p.provider_id}"><img src="${IMG}w92${p.logo_path}" alt=""><span>${esc(p.provider_name)}</span></button>`).join('');
    };
    draw();
    $('#prov').onclick = (e) => {
      const b = e.target.closest('[data-prov]');
      if (!b) return;
      const id = Number(b.dataset.prov);
      const set = new Set(settings.providers);
      set.has(id) ? set.delete(id) : set.add(id);
      saveSettings({ providers: [...set] });
      draw();
      drawSidebar();
    };
  } catch (e) {
    $('#prov').innerHTML = errorBox(e);
  }
}

// ---------- Fiches (film, personne, thème, liste) ----------

const sheet = $('#sheet');
const panel = $('.sheet-panel');
const stack = [];

function closeSheet(rerender = true) {
  sheet.hidden = true;
  stack.length = 0;
  document.documentElement.style.overflow = '';
  panel.style.transform = '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (rerender && (currentTab === 'liste' || currentTab === 'accueil')) render(false);
}

function pushSheet(entry) {
  stack.push(entry);
  showTop();
}

function showTop() {
  const entry = stack[stack.length - 1];
  if (!entry) return closeSheet();
  sheet.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  $('#sheet-back').hidden = stack.length < 2;
  panel.scrollTop = 0;
  const content = $('#sheet-content');
  content.innerHTML = `<div class="d-hero none"></div><div class="d-body" style="padding-top:20px"><div class="sk" style="height:220px"></div><div class="sk sk-line"></div><div class="sk sk-line" style="width:40%"></div></div>`;
  const ok = () => stack[stack.length - 1] === entry && !sheet.hidden;
  if (entry.type === 'movie') history.replaceState(null, '', `#film-${entry.id}`);
  ({ movie: showMovie, person: showPerson, theme: showTheme, grid: showGrid })[entry.type](entry, content, ok).catch((e) => {
    if (ok()) content.innerHTML = `<div class="d-body" style="padding-top:70px">${errorBox(e)}</div>`;
  });
}

$('#sheet-back').addEventListener('click', () => {
  stack.pop();
  showTop();
});

// Glisser vers le bas pour fermer (mobile).
let drag = null;
panel.addEventListener('pointerdown', (e) => {
  if (window.innerWidth >= 1024 || panel.scrollTop > 0 || e.pointerType === 'mouse') return;
  drag = { y: e.clientY, dy: 0 };
});
panel.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.clientY - drag.y);
  if (drag.dy > 6) {
    panel.classList.add('dragging');
    panel.style.transform = `translateY(${drag.dy}px)`;
  }
});
const endDrag = () => {
  if (!drag) return;
  panel.classList.remove('dragging');
  if (drag.dy > 130) closeSheet();
  else {
    panel.classList.add('settle');
    panel.style.transform = '';
    setTimeout(() => panel.classList.remove('settle'), 300);
  }
  drag = null;
};
panel.addEventListener('pointerup', endDrag);
panel.addEventListener('pointercancel', endDrag);

// --- Film ---

function frRelease(m) {
  const fr = m.release_dates?.results?.find((r) => r.iso_3166_1 === 'FR')?.release_dates || [];
  const pick = (type) => fr.filter((r) => r.type === type).map((r) => r.release_date.slice(0, 10)).sort()[0];
  const cert = fr.map((r) => r.certification).find(Boolean);
  return { theatrical: pick(3) || pick(2), digital: pick(4), physical: pick(5), tv: pick(6), cert };
}

const certLabel = (c) => (!c ? '' : /^(U|TP|0|Tous publics)$/i.test(c) ? 'Tous publics' : /^\d+$/.test(c) ? `-${c}` : c);

async function showMovie(entry, content, ok) {
  const m = await movieDetails(entry.id);
  if (!ok()) return;
  remember([m]);
  const draw = () => {
    const y = panel.scrollTop;
    content.innerHTML = movieHtml(m);
    panel.scrollTop = y;
    wireMovie(content, m, draw);
    hydrate(content);
  };
  draw();
}

function movieHtml(m) {
  const saved = inList(m.id);
  const inTodo = saved && saved.status !== 'hidden';
  const rel = frRelease(m);
  const fr = m['watch/providers']?.results?.FR;
  const mine = new Set(settings.providers);
  const crew = m.credits?.crew || [];
  const uniq = (arr) => [...new Map(arr.map((p) => [p.id, p])).values()];
  const directors = uniq(crew.filter((c) => c.job === 'Director'));
  const writers = uniq(crew.filter((c) => c.department === 'Writing')).slice(0, 3);
  const composers = uniq(crew.filter((c) => c.job === 'Original Music Composer'));
  const dop = uniq(crew.filter((c) => c.job === 'Director of Photography'));
  const cast = (m.credits?.cast || []).slice(0, 16);
  const videos = m.videos?.results || [];
  const trailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.iso_639_1 === 'fr') || videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const theatrical = rel.theatrical || m.release_date;
  const inCinema = nowPlayingIds.has(m.id);
  const avg = familyAvg(saved);
  const names = [...new Set([settings.name, ...list.items.flatMap((i) => [i.addedBy, ...(i.wants || [])])].filter((n) => n && n !== '?'))];
  const keywords = (m.keywords?.keywords || []).slice(0, 12);
  const provRow = (label, arr) =>
    arr?.length ? `<div class="where-row"><span class="lbl">${label}</span><div class="prov-list">${arr.map((p) => `<span class="prov ${mine.has(p.provider_id) ? 'mine' : ''}"><img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</span>`).join('')}</div></div>` : '';
  const people = (arr) => arr.map((p) => `<button data-person="${p.id}">${esc(p.name)}</button>`).join(', ');
  const hasStreaming = fr && (fr.flatrate || fr.rent || fr.buy || fr.free || fr.ads);

  const main = `
    <div class="d-actions">
      <button class="btn ${inTodo ? 'on' : ''} wide" data-act="${inTodo ? 'remove' : saved ? 'todo' : 'add'}">${icon(inTodo ? 'check' : 'plus')}${inTodo ? 'Dans notre liste' : 'Ajouter à notre liste'}</button>
      ${trailer ? `<a class="btn secondary" href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">${icon('play')}Bande-annonce</a>` : ''}
    </div>
    <div class="d-icons">
      <button data-act="seen" class="${saved?.status === 'seen' ? 'on' : ''}">${icon('check')}${saved?.status === 'seen' ? 'Vu' : 'Déjà vu'}</button>
      <button data-act="hide" class="${saved?.status === 'hidden' ? 'on' : ''}">${icon('eye-off')}${saved?.status === 'hidden' ? 'Écarté' : 'Pas pour nous'}</button>
      ${fr?.link ? `<a href="${esc(fr.link)}" target="_blank" rel="noopener">${icon('tv')}JustWatch</a>` : ''}
      <button data-act="share">${icon('chev')}Partager</button>
    </div>

    ${rateCard(m, saved)}

    <div class="scores">
      <a class="score sc" id="sc-score" href="#" target="_blank" rel="noopener"><span class="lbl">SensCritique</span><b>…</b><span class="sub">&nbsp;</span></a>
      <div class="score"><span class="lbl">TMDB</span><b>${m.vote_average ? fr1(m.vote_average) : '–'}<small>/10</small></b><span class="sub">${(m.vote_count || 0).toLocaleString('fr-FR')} votes</span></div>
      <div class="score us"><span class="lbl">Nous</span><b>${avg ? fr1(avg) : '–'}<small>/5</small></b><span class="sub">${(() => { const n = Object.keys(saved?.ratings || {}).length; return n ? `${n} note${n > 1 ? 's' : ''} de la famille` : 'Pas encore noté'; })()}</span></div>
    </div>

    ${m.tagline ? `<p class="hint" style="font-style:italic;margin:16px 0 0">${esc(m.tagline)}</p>` : ''}
    ${m.overview ? `<div class="block" style="margin-top:8px"><p class="synopsis" style="margin:0">${esc(m.overview)}</p></div>` : ''}

    <div class="block"><h3>Où le regarder</h3>${
      hasStreaming
        ? `<div class="where">${provRow('Abonnement', fr.flatrate)}${provRow('Gratuit', [...(fr.free || []), ...(fr.ads || [])])}${provRow('Location', fr.rent)}${provRow('Achat', fr.buy)}</div>`
        : `<p class="hint" style="margin:0">Pas encore en streaming en France.${rel.digital ? ` Sortie VOD prévue le <b style="color:var(--text)">${esc(fmtDate(rel.digital))}</b>.` : ''}</p>`
    }</div>

    <div class="block"><h3>Au cinéma <a href="${esc(allocineSearch(m.title))}" target="_blank" rel="noopener">Allociné</a></h3>
      ${
        isFuture(theatrical)
          ? `<p style="margin:0 0 10px">Sortie en salles le <b>${esc(fmtDate(theatrical))}</b> · J-${daysUntil(theatrical)}</p>`
          : theatrical
            ? `<p class="hint" style="margin:0 0 10px">${inCinema ? 'En salles depuis le' : 'Sorti en salles le'} ${esc(fmtDate(theatrical))}</p>`
            : ''
      }
      <div id="seances"></div>
    </div>

    ${
      cast.length
        ? `<div class="block"><h3>Distribution</h3><div class="cast">${cast
            .map((c) => `<button data-person="${c.id}"><div class="face">${c.profile_path ? `<img loading="lazy" src="${IMG}w185${c.profile_path}" alt="">` : ''}</div><b>${esc(c.name)}</b><span>${esc(c.character || '')}</span></button>`)
            .join('')}</div></div>`
        : ''
    }
    <div class="block"><h3>Équipe</h3><div class="crew">
      ${directors.length ? `<div><span class="lbl">Réalisation</span>${people(directors)}</div>` : ''}
      ${writers.length ? `<div><span class="lbl">Scénario</span>${people(writers)}</div>` : ''}
      ${composers.length ? `<div><span class="lbl">Musique</span>${people(composers)}</div>` : ''}
      ${dop.length ? `<div><span class="lbl">Image</span>${people(dop)}</div>` : ''}
    </div></div>
    ${keywords.length ? `<div class="block"><h3>Thèmes</h3><div class="tags">${keywords.map((k) => `<button class="chip" data-theme-kw="${k.id}" data-label="${esc(k.name)}">${esc(k.name)}</button>`).join('')}</div></div>` : ''}`;

  const family =
    saved && saved.status !== 'hidden'
      ? `<div class="block"><h3>En famille</h3>
          <div class="hint" style="margin-bottom:8px">Qui veut le voir ?</div>
          <div class="people">${names.map((n) => `<button class="person-chip ${(saved.wants || []).includes(n) ? 'on' : ''}" data-want="${esc(n)}">${avatar(n)}${esc(n)}</button>`).join('')}</div>
          <textarea class="note" id="note" placeholder="Une note pour la famille (VO, avec les filles…)">${esc(saved.note || '')}</textarea>
        </div>`
      : '';
  const side = `
    ${family}
    <div class="block"><h3>Infos</h3><div class="facts">
      ${theatrical ? `<div><span class="lbl">Sortie salles</span>${esc(fmtDate(theatrical))}</div>` : ''}
      ${rel.digital ? `<div><span class="lbl">Sortie VOD</span>${esc(fmtDate(rel.digital))}</div>` : ''}
      ${rel.physical ? `<div><span class="lbl">DVD / Blu-ray</span>${esc(fmtDate(rel.physical))}</div>` : ''}
      ${rel.tv ? `<div><span class="lbl">Diffusion TV</span>${esc(fmtDate(rel.tv))}</div>` : ''}
      ${m.runtime ? `<div><span class="lbl">Durée</span>${runtime(m.runtime)}</div>` : ''}
      ${rel.cert ? `<div><span class="lbl">Âge conseillé</span>${esc(certLabel(rel.cert))}${/^\d+$/.test(rel.cert) ? ' ans' : ''}</div>` : ''}
      ${m.production_countries?.length ? `<div><span class="lbl">Pays</span>${esc(m.production_countries.map((c) => c.name).join(', '))}</div>` : ''}
      ${m.original_language ? `<div><span class="lbl">Langue</span>${esc(langName(m.original_language))}</div>` : ''}
      ${m.budget ? `<div><span class="lbl">Budget</span>${(m.budget / 1e6).toFixed(0)} M$</div>` : ''}
      ${m.revenue ? `<div><span class="lbl">Box-office</span>${(m.revenue / 1e6).toFixed(0)} M$</div>` : ''}
    </div>
    <div class="ext">${m.imdb_id ? `<a class="chip" href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">IMDb</a>` : ''}<a class="chip" href="https://www.themoviedb.org/movie/${m.id}" target="_blank" rel="noopener">TMDB</a><a class="chip" id="sc-link" href="#" target="_blank" rel="noopener">SensCritique</a><a class="chip" href="${esc(allocineSearch(m.title))}" target="_blank" rel="noopener">Allociné</a></div>
    </div>`;

  const recs = remember(m.recommendations?.results || []);
  return `
    <div class="d-hero ${m.backdrop_path ? '' : 'none'}">${m.backdrop_path ? `<img src="${IMG}w1280${m.backdrop_path}" alt="">` : ''}</div>
    <div class="d-head">
      ${posterBox(m.poster_path, m.title, 'w342')}
      <div>
        <h2>${esc(m.title)}</h2>
        ${m.original_title && m.original_title !== m.title ? `<div class="orig">${esc(m.original_title)}</div>` : ''}
        <div class="d-meta">${[year(m.release_date), runtime(m.runtime), (m.genres || []).slice(0, 3).map((g) => g.name).join(', ')].filter(Boolean).map(esc).join('<span class="dot"></span>')}${rel.cert ? `<span class="age">${esc(certLabel(rel.cert))}</span>` : ''}${inCinema ? '<span class="badge red">Au cinéma</span>' : ''}</div>
        ${directors[0] ? `<div class="d-meta">De <button data-person="${directors[0].id}" style="font-weight:650;color:var(--text)">${esc(directors[0].name)}</button></div>` : ''}
      </div>
    </div>
    <div class="d-body"><div class="d-layout"><div>${main}</div><aside>${side}</aside></div>
      ${recs.length ? sectionHtml('Dans le même esprit', railHtml(recs.slice(0, 14), { why: '' }), { all: recs }) : ''}
    </div>`;
}

// Carte « Ta note » : bien visible, utilisable même si le film n'est pas encore dans la liste.
const RATE_LABELS = ['', 'Pas aimé', 'Bof', 'Pas mal', 'Très bien', 'Coup de cœur'];
function rateCard(m, saved) {
  const mine = saved?.ratings?.[settings.name] || 0;
  const others = Object.entries(saved?.ratings || {}).filter(([n]) => n !== settings.name);
  return `<div class="rate-card">
    <div class="rate-head"><div><b>Ta note</b><small>${mine ? RATE_LABELS[mine] : saved?.status === 'seen' ? 'Tu l’as vu : qu’en as-tu pensé ?' : 'Déjà vu ? Note-le, il passe dans « Vus »'}</small></div>
      <div class="stars big" role="radiogroup" aria-label="Ta note">${[1, 2, 3, 4, 5].map((v) => `<button class="${v <= mine ? 'on' : ''}" data-rate="${v}" aria-label="${v} sur 5 : ${RATE_LABELS[v]}" title="${RATE_LABELS[v]}">${icon('star')}</button>`).join('')}</div>
    </div>
    ${others.length ? `<div class="rate-others">${others.map(([n, v]) => `<span>${avatar(n)}<span class="mini-stars">${'★'.repeat(v)}<i>${'★'.repeat(5 - v)}</i></span></span>`).join('')}</div>` : ''}
  </div>`;
}

function langName(code) {
  try {
    const n = new Intl.DisplayNames(['fr'], { type: 'language' }).of(code);
    return n[0].toUpperCase() + n.slice(1);
  } catch {
    return code;
  }
}

function wireMovie(content, m, redraw) {
  const after = (e) => {
    if (e) toast(e.message);
    refreshMovieUi(m.id);
    if (e && stack[stack.length - 1]?.id === m.id) redraw();
  };
  content.onclick = (e) => {
    const b = e.target.closest('button[data-act], button[data-want], button[data-rate]');
    if (!b) return;
    const act = b.dataset.act;
    const saved = inList(m.id);
    if (act === 'add') {
      listAction({ action: 'add', movie: m }, after);
      toast('Ajouté à la liste');
    } else if (act === 'todo') listAction({ action: 'setStatus', movieId: m.id, status: 'todo' }, after);
    else if (act === 'remove') {
      const snap = { ...saved };
      listAction({ action: 'remove', movieId: m.id }, after);
      toast('Retiré de la liste', {
        label: 'Annuler',
        run: () => {
          listAction({ action: 'add', movie: snap, status: snap.status }, after);
          if (stack[stack.length - 1]?.id === m.id) redraw();
        },
      });
    } else if (act === 'seen') {
      if (!saved) {
        listAction({ action: 'add', movie: m, status: 'seen' }, after);
        toast('Marqué comme vu : notez-le !');
      } else listAction({ action: 'setStatus', movieId: m.id, status: saved.status === 'seen' ? 'todo' : 'seen' }, after);
    } else if (act === 'hide') {
      if (!saved) listAction({ action: 'add', movie: m, status: 'hidden' }, after);
      else listAction({ action: 'setStatus', movieId: m.id, status: saved.status === 'hidden' ? 'todo' : 'hidden' }, after);
      if (saved?.status !== 'hidden') toast('Noté, on vous proposera moins de films comme ça');
    } else if (act === 'share') {
      const url = `${location.origin}/#film-${m.id}`;
      if (navigator.share) navigator.share({ title: m.title, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('Lien copié'));
      return;
    } else if (b.dataset.want) listAction({ action: 'toggleWant', movieId: m.id, by: b.dataset.want }, after);
    else if (b.dataset.rate) {
      const v = Number(b.dataset.rate);
      const value = saved?.ratings?.[settings.name] === v ? 0 : v;
      listAction({ action: 'rate', movieId: m.id, movie: saved ? undefined : m, value }, after);
      if (value) toast(`${v}/5 · ${RATE_LABELS[v]}`);
    }
    redraw();
    refreshMovieUi(m.id);
  };
  const note = $('#note', content);
  if (note) note.addEventListener('change', () => listAction({ action: 'note', movieId: m.id, note: note.value }, (e) => toast(e ? e.message : 'Note enregistrée')));

  senscritique(m).then((d) => {
    const href = d?.url || d?.searchUrl || '#';
    const link = $('#sc-link', content);
    if (link) link.href = href;
    const box = $('#sc-score', content);
    if (!box) return;
    box.href = href;
    box.innerHTML = `<span class="lbl">SensCritique</span><b>${d?.rating ? fr1(d.rating) : '–'}<small>/10</small></b><span class="sub">${d?.count ? `${Number(d.count).toLocaleString('fr-FR')} notes` : d?.rating ? '' : 'Voir sur le site'}</span>`;
  });
  loadSeances(content, m);
}

async function loadSeances(content, m, day = today()) {
  const box = $('#seances', content);
  if (!box) return;
  const rel = frRelease(m);
  const theatrical = rel.theatrical || m.release_date;
  const plausible = nowPlayingIds.has(m.id) || (theatrical && Math.abs(daysUntil(theatrical)) < 90);
  if (!plausible) return;
  if (!settings.theaters.length) return (box.innerHTML = '<p class="hint" style="margin:0">Ajoutez vos cinémas dans Réglages pour voir les séances ici.</p>');
  box.innerHTML = `<div class="days">${nextDays(7).map((d) => `<button class="chip ${d.iso === day ? 'on' : ''}" data-sday="${d.iso}">${esc(d.label)}</button>`).join('')}</div><div id="seances-list"><div class="sk" style="height:90px"></div></div>`;
  $('.days', box).onclick = (e) => {
    const b = e.target.closest('[data-sday]');
    if (b) loadSeances(content, m, b.dataset.sday);
  };
  const keys = new Set([normalize(m.title), normalize(m.original_title)]);
  const results = await Promise.all(
    settings.theaters.map((t) =>
      seances(t.id, day)
        .then((d) => ({ t, d, movie: d.movies.find((x) => keys.has(normalize(x.title)) || keys.has(normalize(x.originalTitle))) }))
        .catch((err) => ({ t, err })),
    ),
  );
  const out = $('#seances-list', content);
  if (!out) return;
  const found = results.filter((r) => r.movie);
  const failed = results.filter((r) => r.err);
  out.innerHTML =
    (found.length
      ? found.map((r) => `<div class="theater"><div class="name">${esc(r.t.name || r.d.theaterName || r.t.id)}<a href="${esc(r.d.url)}" target="_blank" rel="noopener">Réserver</a></div><div class="times">${r.movie.showtimes.map(timeChip).join('')}</div></div>`).join('')
      : `<p class="hint" style="margin:0">Aucune séance ce jour-là dans vos cinémas.</p>`) +
    (failed.length ? `<p class="hint">Séances indisponibles pour ${esc(failed.map((r) => r.t.name || r.t.id).join(', '))}.</p>` : '');
}

// --- Personne ---

async function showPerson(entry, content, ok) {
  const p = await tmdb(`person/${entry.id}`, { append_to_response: 'movie_credits,external_ids' });
  if (!ok()) return;
  const cast = p.movie_credits?.cast || [];
  const crew = p.movie_credits?.crew || [];
  const dedupe = (arr) => [...new Map(arr.map((m) => [m.id, m])).values()];
  const directed = remember(dedupe(crew.filter((c) => c.job === 'Director')));
  const written = remember(dedupe(crew.filter((c) => c.department === 'Writing' && !directed.some((d) => d.id === c.id))));
  const acted = remember(dedupe(cast.filter((c) => !(c.genre_ids || []).includes(99) || cast.length < 10)));
  const isDirector = p.known_for_department === 'Directing' || directed.length > acted.length / 3;
  const byPop = (arr) => [...arr].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const byDate = (arr) => [...arr].sort((a, b) => (b.release_date || '9999').localeCompare(a.release_date || '9999'));
  const upcoming = dedupe([...directed, ...acted].filter((m) => isFuture(m.release_date))).sort((a, b) => a.release_date.localeCompare(b.release_date));
  const inOurList = dedupe([...directed, ...acted, ...written]).filter((m) => inList(m.id));
  const age = p.birthday ? Math.floor((new Date(p.deathday || Date.now()) - new Date(p.birthday)) / (365.25 * 864e5)) : null;
  const dept = { Acting: 'Acteur·rice', Directing: 'Réalisation', Writing: 'Scénario', Sound: 'Musique', Camera: 'Image', Production: 'Production' }[p.known_for_department] || p.known_for_department || '';
  const imdb = p.imdb_id || p.external_ids?.imdb_id;

  let mode = 'pop';
  const draw = () => {
    const sort = mode === 'pop' ? byPop : byDate;
    const credits = isDirector
      ? [['Réalisation', directed], ['Comme acteur·rice', acted.slice(0, 30)], ['Scénario', written.slice(0, 18)]]
      : [['Filmographie', acted.slice(0, 80).map((m) => ({ ...m, _why: m.character || '' }))], ['Réalisation', directed], ['Scénario', written.slice(0, 18)]];
    content.innerHTML = `
      <div class="p-head">
        <div class="face">${p.profile_path ? `<img src="${IMG}h632${p.profile_path}" alt="">` : ''}</div>
        <h2>${esc(p.name)}</h2>
        <div class="hint" style="margin-top:4px">${esc([dept, age ? (p.deathday ? `mort·e à ${age} ans` : `${age} ans`) : '', p.place_of_birth].filter(Boolean).join(' · '))}</div>
        <div class="stats" style="justify-content:center;margin-top:14px"><span><b>${acted.length}</b>rôles</span>${directed.length ? `<span><b>${directed.length}</b>réalisations</span>` : ''}${inOurList.length ? `<span><b>${inOurList.length}</b>dans la liste</span>` : ''}</div>
      </div>
      <div class="d-body">
        ${p.biography ? `<div class="block"><div class="bio" id="bio">${esc(p.biography)}</div><button class="link" id="bio-more" style="margin-top:6px">Lire la suite</button></div>` : ''}
        ${upcoming.length ? sectionHtml('À venir', railHtml(upcoming, { fullDate: true })) : ''}
        ${inOurList.length ? sectionHtml('Dans notre liste', railHtml(inOurList)) : ''}
        <div class="subtools" style="margin-top:28px"><div class="seg" id="pm"><button class="${mode === 'pop' ? 'on' : ''}" data-pm="pop">Les plus connus</button><button class="${mode === 'date' ? 'on' : ''}" data-pm="date">Par date</button></div>${imdb ? `<a class="chip" href="https://www.imdb.com/name/${esc(imdb)}/" target="_blank" rel="noopener">IMDb</a>` : ''}</div>
        ${credits.filter(([, arr]) => arr.length).map(([t, arr]) => sectionHtml(t, gridHtml(sort(arr)), { sub: `${arr.length} films` })).join('')}
      </div>`;
    $('#pm', content).onclick = (e) => {
      const b = e.target.closest('[data-pm]');
      if (b) {
        mode = b.dataset.pm;
        draw();
      }
    };
    const more = $('#bio-more', content);
    if (more)
      more.onclick = () => {
        $('#bio', content).classList.add('open');
        more.remove();
      };
  };
  draw();
}

// --- Thème ---

async function showTheme(entry, content, ok) {
  let sort = 'popularity.desc';
  let onlyMine = false;
  let page = 0;
  let total = 1;
  const base = entry.params || (await themeParams(entry.theme));
  if (!ok()) return;
  const draw = async (reset) => {
    if (reset) {
      page = 0;
      content.innerHTML = `
        <h2 class="sheet-title">${esc(entry.label)}</h2>
        <div class="d-body">
          <div class="subtools" style="margin-top:10px">
            <div class="seg" id="ts">${[['popularity.desc', 'Populaires'], ['vote_average.desc', 'Mieux notés'], ['primary_release_date.desc', 'Récents']].map(([k, l]) => `<button class="${sort === k ? 'on' : ''}" data-ts="${k}">${l}</button>`).join('')}</div>
            ${settings.providers.length ? `<button class="chip ${onlyMine ? 'on' : ''}" id="tm">Sur nos plateformes</button>` : ''}
          </div>
          <div id="theme-grid">${skGrid(9)}</div>
          <div style="text-align:center;margin-top:20px"><button class="btn secondary" id="theme-more" hidden>Voir plus</button></div>
        </div>`;
      $('#ts', content).onclick = (e) => {
        const b = e.target.closest('[data-ts]');
        if (b) {
          sort = b.dataset.ts;
          draw(true);
        }
      };
      const tm = $('#tm', content);
      if (tm)
        tm.onclick = () => {
          onlyMine = !onlyMine;
          draw(true);
        };
      $('#theme-more', content).onclick = () => draw(false);
    }
    page += 1;
    const params = { ...base, 'vote_count.gte': base['vote_count.gte'] ?? 30, sort_by: base.sort_by && sort === 'popularity.desc' ? base.sort_by : sort, page };
    if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(300, params['vote_count.gte']);
    if (sort === 'primary_release_date.desc') params['primary_release_date.lte'] = today();
    if (onlyMine) Object.assign(params, { watch_region: 'FR', with_watch_providers: settings.providers.join('|'), with_watch_monetization_types: 'flatrate|free|ads' });
    const d = await tmdb('discover/movie', params);
    if (!ok()) return;
    total = d.total_pages || 1;
    const target = $('#theme-grid', content);
    const html = remember(d.results).map((m) => movieCard(m, { logos: true })).join('');
    if (page === 1) target.innerHTML = d.results.length ? `<div class="grid">${html}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>';
    else target.querySelector('.grid')?.insertAdjacentHTML('beforeend', html);
    hydrate(target);
    $('#theme-more', content).hidden = page >= Math.min(total, 30);
  };
  await draw(true);
}

// --- Liste complète d'une section ---

async function showGrid(entry, content) {
  content.innerHTML = `<h2 class="sheet-title">${esc(entry.title)}</h2><div class="d-body" style="padding-top:14px">${gridHtml(entry.movies, { logos: true })}</div>`;
  hydrate(content);
}

// ---------- Événements globaux ----------

document.addEventListener('click', async (e) => {
  const t = e.target;
  const inPalette = !!t.closest('.palette');
  if (t.closest('[data-close-search]')) return closeSearch();
  const quick = t.closest('[data-quick]');
  if (quick) return quickToggle(Number(quick.dataset.quick));
  const wantRow = t.closest('[data-want-row]');
  if (wantRow) {
    listAction({ action: 'toggleWant', movieId: Number(wantRow.dataset.wantRow), by: settings.name }, (err) => err && toast(err.message));
    return render(false);
  }
  const seenRow = t.closest('[data-seen-row]');
  if (seenRow) {
    const id = Number(seenRow.dataset.seenRow);
    const seen = inList(id)?.status === 'seen';
    listAction({ action: 'setStatus', movieId: id, status: seen ? 'todo' : 'seen' }, (err) => err && toast(err.message));
    toast(seen ? 'Remis dans « À voir »' : 'Marqué comme vu', {
      label: 'Annuler',
      run: () => {
        listAction({ action: 'setStatus', movieId: id, status: seen ? 'seen' : 'todo' }, (err) => err && toast(err.message));
        render(false);
      },
    });
    return render(false);
  }
  if (t.closest('[data-open-search]')) return openSearch();
  const tab = t.closest('[data-tab]');
  if (tab) {
    if (tab.dataset.status) vs.listeStatus = tab.dataset.status;
    if (tab.dataset.cine) vs.cineMode = tab.dataset.cine;
    return go(tab.dataset.tab);
  }
  const prov = t.closest('[data-provider]');
  if (prov) {
    vs.streamProvider = prov.dataset.provider;
    vs.streamSort = 'popular';
    return currentTab === 'streaming' ? render(false) : go('streaming');
  }
  if (t.closest('[data-close]')) return closeSheet();
  const person = t.closest('[data-person]');
  if (person) {
    if (inPalette) closeSearch();
    return pushSheet({ type: 'person', id: Number(person.dataset.person) });
  }
  const card = t.closest('[data-movie]');
  if (card) {
    if (inPalette) closeSearch();
    return pushSheet({ type: 'movie', id: Number(card.dataset.movie) });
  }
  const all = t.closest('[data-seeall]');
  if (all && collections.has(all.dataset.seeall)) return pushSheet({ type: 'grid', ...collections.get(all.dataset.seeall) });
  const theme = t.closest('[data-theme]');
  if (theme) {
    const th = THEMES.find((x) => x.key === theme.dataset.theme);
    return pushSheet({ type: 'theme', label: th.label, theme: th });
  }
  const tk = t.closest('[data-theme-kw]');
  if (tk) return pushSheet({ type: 'theme', label: tk.dataset.label, params: { with_keywords: tk.dataset.themeKw } });
  const find = t.closest('[data-find]');
  if (find) {
    try {
      const d = await tmdb('search/movie', { query: find.dataset.find });
      const best = d.results.find((r) => nowPlayingIds.has(r.id)) || d.results[0];
      if (best) pushSheet({ type: 'movie', id: best.id });
      else toast('Film introuvable sur TMDB');
    } catch (err) {
      toast(err.message);
    }
  }
});

// Préchargement de la fiche au survol ou au toucher : elle s'ouvre instantanément.
const prefetched = new Set();
const prefetch = (e) => {
  const c = e.target.closest?.('[data-movie]');
  const id = c && Number(c.dataset.movie);
  if (!id || prefetched.has(id)) return;
  prefetched.add(id);
  movieDetails(id).catch(() => prefetched.delete(id));
};
document.addEventListener('pointerover', prefetch, { passive: true });
document.addEventListener('touchstart', prefetch, { passive: true });

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return palette.hidden ? openSearch() : closeSearch();
  }
  if (e.key === '/' && palette.hidden && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    return openSearch();
  }
  if (e.key === 'Escape') {
    if (!palette.hidden) return closeSearch();
    if (!sheet.hidden) {
      if (stack.length > 1) {
        stack.pop();
        return showTop();
      }
      return closeSheet();
    }
  }
});

// La liste peut avoir changé sur un autre téléphone.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !settings.name) return;
  fetchList()
    .then(() => {
      updateSideCounts();
      if (currentTab === 'liste' && sheet.hidden) render(false);
    })
    .catch(() => {});
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Hauteur réelle de l'en-tête, pour coller la barre de filtres juste dessous.
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--topbar-h', `${Math.round(e.target.getBoundingClientRect().height)}px`)).observe($('.topbar'));
drawSidebar();
loadNearby();
render();
Promise.all([listLoaded || !settings.name ? null : fetchList().catch(() => {}), loadNowPlaying().catch(() => {})]).then(updateSideCounts);
const hashFilm = location.hash.match(/^#film-(\d+)$/);
if (hashFilm && settings.name) pushSheet({ type: 'movie', id: Number(hashFilm[1]) });

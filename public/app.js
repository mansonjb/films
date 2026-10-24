// Nos films : watchlist familiale (TMDB pour les films et le streaming, Allociné pour les séances, SensCritique pour la note).

import {
  IMG, settings, saveSettings, tmdb, pages, movieDetails, genres, nowPlayingIds, loadNowPlaying, providersFor, loadAllProviders,
  keywordId, list, listLoaded, fetchList, listAction, inList, resetList, seances, senscritique,
} from './js/data.js';
import { buildProfile, topEntries, deepRank, recommendationsFrom } from './js/reco.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Utilitaires d'affichage ----------

const fmtDate = (d, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('fr-FR', opts) : '');
const shortDate = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const year = (d) => (d ? d.slice(0, 4) : '');
const isoDay = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const today = () => isoDay(new Date());
const isFuture = (d) => d && d > today();
const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();
const color = (name) => `hsl(${[...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 42%)`;
const avatar = (name) => `<span class="avatar" style="background:${color(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'et')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const allocineSearch = (title) => `https://www.allocine.fr/rechercher/?q=${encodeURIComponent(title)}`;
const fr1 = (n) => Number(n).toFixed(1).replace('.', ',');

function posterImg(path, alt, size = 'w342') {
  return path ? `<img class="poster" loading="lazy" src="${IMG}${size}${path}" alt="${esc(alt)}">` : `<div class="poster">${esc(alt)}</div>`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

const spinner = (txt = 'Chargement…') => `<div class="spinner">${esc(txt)}</div>`;
const errorBox = (e) => `<div class="error">${esc(e.message || e)}</div>`;

function familyNames() {
  const names = new Set(settings.name ? [settings.name] : []);
  for (const i of list.items) {
    if (i.addedBy && i.addedBy !== '?') names.add(i.addedBy);
    (i.wants || []).forEach((n) => names.add(n));
  }
  return [...names];
}

const familyAvg = (item) => {
  const r = Object.values(item?.ratings || {});
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
};

// Carte d'affiche. Options : date complète, logos des plateformes, raison de la recommandation, rôle.
function movieCard(m, { showLogos = false, fullDate = false, why = m._why, sub = '' } = {}) {
  const saved = inList(m.id);
  const badges = [];
  if (saved?.status === 'seen') badges.push('<span class="badge seen">Vu</span>');
  else if (saved?.status === 'todo') badges.push('<span class="badge">★</span>');
  if (nowPlayingIds.has(m.id)) badges.push('<span class="badge cine">Au ciné</span>');
  else if (isFuture(m.release_date)) badges.push(`<span class="badge">${esc(fmtDate(m.release_date, { day: 'numeric', month: 'short' }))}</span>`);
  const date = fullDate && m.release_date ? shortDate(m.release_date) : year(m.release_date);
  return `
    <button class="card" data-movie="${m.id}">
      ${posterImg(m.poster_path, m.title)}
      <div class="badges">${badges.join('')}</div>
      <div class="t">${esc(m.title)}</div>
      <div class="s">${esc(date)}${m.vote_average ? ` · ★ ${fr1(m.vote_average)}` : ''}</div>
      ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
      ${why ? `<div class="why">${esc(why)}</div>` : ''}
      ${showLogos ? `<div class="logos" data-logos="${m.id}"></div>` : ''}
    </button>`;
}

async function fillLogos(root) {
  const mine = new Set(settings.providers);
  for (const el of root.querySelectorAll('[data-logos]:not([data-filled])')) {
    el.dataset.filled = '1';
    providersFor(Number(el.dataset.logos)).then((fr) => {
      const subs = [...(fr?.flatrate || []), ...(fr?.free || []), ...(fr?.ads || [])];
      const sorted = [...new Map(subs.map((p) => [p.provider_id, p])).values()].sort((a, b) => mine.has(b.provider_id) - mine.has(a.provider_id));
      el.innerHTML = sorted
        .slice(0, 4)
        .map((p) => `<img class="logo" src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`)
        .join('');
    });
  }
}

function fillSc(root) {
  for (const el of root.querySelectorAll('[data-sc]:not([data-filled])')) {
    el.dataset.filled = '1';
    const item = inList(Number(el.dataset.sc));
    if (!item) continue;
    senscritique(item).then((d) => {
      if (d?.rating) el.innerHTML = `<span class="badge sc">SC ${fr1(d.rating)}</span>`;
    });
  }
}

const grid = (movies, opts) => (movies.length ? `<div class="grid">${movies.map((m) => movieCard(m, opts)).join('')}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>');
const row = (movies, opts) => `<div class="hscroll">${movies.map((m) => movieCard(m, opts)).join('')}</div>`;

// Thèmes proposés dans Explorer : genres TMDB ou mots-clés (résolus à la volée).
const THEMES = [
  { key: 'famille', label: 'En famille', em: '👨‍👩‍👧', tint: '#3c7d5a', params: { with_genres: '10751' } },
  { key: 'animation', label: 'Animation', em: '🎨', tint: '#5b5bd6', params: { with_genres: '16' } },
  { key: 'comedie', label: 'Comédies', em: '😂', tint: '#c9852b', params: { with_genres: '35' } },
  { key: 'romance', label: 'Romance', em: '💘', tint: '#c2456b', params: { with_genres: '10749' } },
  { key: 'aventure', label: 'Aventure', em: '🧭', tint: '#2f8f8a', params: { with_genres: '12' } },
  { key: 'sf', label: 'Science-fiction', em: '🚀', tint: '#3d63c9', params: { with_genres: '878' } },
  { key: 'frissons', label: 'Frissons', em: '😱', tint: '#6b2f3f', params: { with_genres: '27|53' } },
  { key: 'enquetes', label: 'Enquêtes et polars', em: '🕵️', tint: '#4a4f63', params: { with_genres: '9648|80' } },
  { key: 'drames', label: 'Drames', em: '🎭', tint: '#7a4a8f', params: { with_genres: '18' } },
  { key: 'francais', label: 'Cinéma français', em: '🇫🇷', tint: '#2d4f9e', params: { with_origin_country: 'FR' } },
  { key: 'vrai', label: 'Histoires vraies', em: '📰', tint: '#8a6a3a', keyword: 'based on true story' },
  { key: 'livres', label: 'Adaptés de livres', em: '📚', tint: '#6c5a3e', keyword: 'based on novel or book' },
  { key: 'heros', label: 'Super-héros', em: '🦸', tint: '#b0373a', keyword: 'superhero' },
  { key: 'temps', label: 'Voyage dans le temps', em: '⏳', tint: '#3e6f86', keyword: 'time travel' },
  { key: 'braquage', label: 'Casses et braquages', em: '💰', tint: '#5d6b2e', keyword: 'heist' },
  { key: 'noel', label: 'Films de Noël', em: '🎄', tint: '#2f7a46', keyword: 'christmas' },
  { key: 'sport', label: 'Sport', em: '⚽', tint: '#2d7f5f', keyword: 'sport' },
  { key: 'classiques', label: 'Grands classiques', em: '🏆', tint: '#8f7330', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 5000 } },
];

async function themeParams(theme) {
  if (theme.params) return theme.params;
  if (theme.keywordIdValue) return { with_keywords: String(theme.keywordIdValue) };
  const id = await keywordId(theme.keyword);
  if (!id) throw new Error('Thème introuvable');
  return { with_keywords: String(id) };
}

// ---------- Vues ----------

const TITLES = { liste: 'Notre liste', pourvous: 'Pour vous', cine: 'Au cinéma', streaming: 'Streaming', recherche: 'Explorer', reglages: 'Réglages' };
let currentTab = 'liste';
const vs = { listeFilter: 'todo', listeOnly: 'all', listeGroup: false, cineMode: 'now', cineDay: today(), streamProvider: 'mine', streamSort: 'popular', streamGenre: '', streamPage: 1, query: '' };

function setTools(html, onClick) {
  const tools = $('#view-tools');
  tools.innerHTML = html;
  tools.onclick = onClick || null;
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  $('#view-title').textContent = TITLES[currentTab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  const view = $('#view');
  if (!settings.name && currentTab !== 'reglages') return renderWelcome(view);
  try {
    await { liste: renderListe, pourvous: renderPourVous, cine: renderCine, streaming: renderStreaming, recherche: renderExplorer, reglages: renderReglages }[currentTab](view, () => token === renderToken);
  } catch (e) {
    if (token === renderToken) view.innerHTML = errorBox(e);
  }
}

function renderWelcome(view) {
  setTools('');
  view.innerHTML = `
    <div class="empty"><b>Bienvenue 👋</b>Dis-nous qui tu es pour partager la liste avec la famille.</div>
    <form id="welcome" class="box">
      <div class="field"><label for="w-name">Ton prénom</label><input id="w-name" required autocomplete="given-name" placeholder="Jean-Baptiste"></div>
      <div class="field"><label for="w-code">Code famille</label><input id="w-code" autocomplete="off" placeholder="Laisse vide s'il n'y en a pas"></div>
      <button class="btn block">C'est parti</button>
    </form>`;
  $('#welcome').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ name: $('#w-name').value.trim(), familyCode: $('#w-code').value.trim() });
    render();
  });
}

// --- Liste ---

async function renderListe(view, alive) {
  const chips = (pairs, key, attr) => pairs.map(([k, l]) => `<button class="chip ${vs[key] === k ? 'on' : ''}" data-${attr}="${k}">${l}</button>`).join('');
  setTools(
    chips([['todo', 'À voir'], ['seen', 'Déjà vus'], ['hidden', 'Écartés']], 'listeFilter', 'lf') +
      chips([['all', 'Tout'], ['cine', 'Au ciné'], ['mine', 'Sur nos plateformes'], ['soon', 'Bientôt']], 'listeOnly', 'lo') +
      `<button class="chip ${vs.listeGroup ? 'on' : ''}" data-lg>Par thème</button>`,
    (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.lf) vs.listeFilter = b.dataset.lf;
      if (b.dataset.lo) vs.listeOnly = b.dataset.lo;
      if (b.dataset.lg !== undefined) vs.listeGroup = !vs.listeGroup;
      render();
    },
  );

  if (!listLoaded) view.innerHTML = spinner();
  const [, gmap] = await Promise.all([fetchList(), genres().catch(() => new Map()), nowPlayingIds.size ? null : loadNowPlaying().catch(() => {})]);
  if (!alive()) return;

  let items = list.items.filter((i) => (i.status || 'todo') === vs.listeFilter);
  if (vs.listeOnly === 'cine') items = items.filter((i) => nowPlayingIds.has(i.id));
  if (vs.listeOnly === 'soon') items = items.filter((i) => isFuture(i.release_date));
  if (vs.listeOnly === 'mine') {
    const mine = new Set(settings.providers);
    const avail = await Promise.all(items.map((i) => providersFor(i.id)));
    items = items.filter((_, k) => (avail[k]?.flatrate || []).some((p) => mine.has(p.provider_id)));
  }
  items.sort((a, b) =>
    vs.listeFilter === 'seen'
      ? familyAvg(b) - familyAvg(a) || (b.seenAt || '').localeCompare(a.seenAt || '')
      : (b.wants?.length || 0) - (a.wants?.length || 0) || (b.addedAt || '').localeCompare(a.addedAt || ''),
  );

  if (!items.length) {
    const empty = { seen: 'Aucun film vu pour l’instant', hidden: 'Aucun film écarté', todo: 'Rien ici pour l’instant' }[vs.listeFilter];
    view.innerHTML = `<div class="empty"><b>${empty}</b>${
      vs.listeFilter === 'todo' && vs.listeOnly === 'all' ? 'Ajoute des films depuis Pour vous, Ciné, Streaming ou Explorer.' : 'Essaie un autre filtre.'
    }</div>`;
    return;
  }

  const rowHtml = (i) => {
    const status = nowPlayingIds.has(i.id)
      ? '<span class="badge cine">Au ciné</span>'
      : isFuture(i.release_date)
        ? `<span class="badge">Sortie ${esc(fmtDate(i.release_date, { day: 'numeric', month: 'short' }))}</span>`
        : '';
    const avg = familyAvg(i);
    return `
      <button class="row" data-movie="${i.id}">
        ${posterImg(i.poster_path, i.title, 'w185')}
        <div>
          <h3>${esc(i.title)}</h3>
          <div class="meta">${esc(year(i.release_date))}${i.vote_average ? ` · ★ ${fr1(i.vote_average)}` : ''} · ajouté par ${esc(i.addedBy)}</div>
          <div class="line">${status}<span data-sc="${i.id}"></span><span class="avatars">${(i.wants || []).map(avatar).join('')}</span>${
            avg ? `<span class="meta">Nous : ${'★'.repeat(Math.round(avg))}</span>` : ''
          }</div>
          <div class="logos" data-logos="${i.id}"></div>
          ${i.note ? `<div class="meta" style="margin-top:4px">📝 ${esc(i.note)}</div>` : ''}
        </div>
      </button>`;
  };

  if (vs.listeGroup) {
    const groups = new Map();
    for (const i of items) {
      const g = gmap.get((i.genre_ids || [])[0]) || 'Autres';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    }
    view.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([g, its]) => `<h2 class="section-title">${esc(g)} <small>${its.length} film${its.length > 1 ? 's' : ''}</small></h2><div class="rows">${its.map(rowHtml).join('')}</div>`)
      .join('');
  } else {
    view.innerHTML = `<div class="rows">${items.map(rowHtml).join('')}</div>`;
  }
  fillLogos(view);
  fillSc(view);
}

// --- Pour vous ---

async function renderPourVous(view, alive) {
  setTools('');
  view.innerHTML = spinner('On regarde vos goûts…');
  await Promise.all([listLoaded ? null : fetchList(), nowPlayingIds.size ? null : loadNowPlaying().catch(() => {})]);
  const seeds = list.items;
  if (!seeds.length) {
    const trend = (await tmdb('trending/movie/week')).results;
    if (!alive()) return;
    view.innerHTML = `<div class="box"><b>Les recommandations arrivent dès que la liste se remplit.</b><div class="hint">Ajoute des films, marque ceux que vous avez vus et notez-les : plus vous en mettez, plus les suggestions seront justes.</div></div>
      <h2 class="section-title">Tendances de la semaine</h2>${grid(trend)}`;
    return;
  }

  const profile = await buildProfile(seeds);
  if (!alive()) return;
  const sections = [
    { id: 'reco', title: 'Recommandés pour vous', sub: 'D’après votre liste et vos notes' },
    { id: 'stream', title: 'À voir sur vos plateformes', sub: settings.providers.length ? '' : 'Choisis vos plateformes dans Réglages' },
    { id: 'soon', title: 'Bientôt au cinéma pour vous', sub: 'Les prochaines sorties qui vous ressemblent' },
    { id: 'now', title: 'À l’affiche pour vous', sub: '' },
    { id: 'because', title: '', sub: '' },
    { id: 'themes', title: 'Vos thèmes', sub: 'Ce qui revient le plus dans vos films' },
  ];
  view.innerHTML = sections.map((s) => `<section data-sec="${s.id}">${s.title ? `<h2 class="section-title">${esc(s.title)} <small>${esc(s.sub)}</small></h2>` : ''}${s.id === 'because' ? '' : spinner()}</section>`).join('');
  const fill = (id, html) => {
    const el = view.querySelector(`[data-sec="${id}"]`);
    if (!el || !alive()) return;
    el.innerHTML = el.querySelector('h2') ? el.querySelector('h2').outerHTML + html : html;
    fillLogos(el);
  };
  const safe = (id, fn) => fn().catch((e) => fill(id, errorBox(e)));

  safe('reco', async () => {
    const recos = await recommendationsFrom(profile, 20);
    fill('reco', recos.length ? row(recos) : '<p class="hint">Ajoute et note quelques films pour affiner.</p>');
  });

  safe('stream', async () => {
    if (!settings.providers.length) return fill('stream', '<button class="btn ghost block" data-tab="reglages">Choisir nos plateformes</button>');
    const topGenres = topEntries(profile.genres, 3).map((g) => g.id).join('|');
    const base = { watch_region: 'FR', with_watch_providers: settings.providers.join('|'), with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', 'vote_count.gte': 50 };
    const [byTaste, popular] = await Promise.all([pages('discover/movie', { ...base, ...(topGenres ? { with_genres: topGenres } : {}) }, 3), pages('discover/movie', base, 2)]);
    const picks = await deepRank([...byTaste, ...popular], profile, { limit: 16, deep: 20 });
    fill('stream', row(picks, { showLogos: true }));
  });

  safe('soon', async () => {
    const upcoming = (await pages('movie/upcoming', {}, 4)).filter((m) => isFuture(m.release_date));
    const picks = await deepRank(upcoming, profile, { limit: 14, deep: 22 });
    fill('soon', picks.length ? row(picks, { fullDate: true }) : '<p class="hint">Pas de sortie annoncée pour l’instant.</p>');
  });

  safe('now', async () => {
    const now = await pages('movie/now_playing', {}, 3);
    const picks = await deepRank(now, profile, { limit: 12, deep: 18 });
    fill('now', row(picks));
  });

  safe('because', async () => {
    const liked = profile.liked.slice(0, 3);
    const blocks = await Promise.all(
      liked.map(async (l) => {
        const d = await movieDetails(l.id);
        const recs = (d.recommendations?.results || []).filter((m) => !profile.exclude.has(m.id)).slice(0, 12);
        return recs.length ? `<h2 class="section-title">Parce que vous avez aimé ${esc(l.title)}</h2>${row(recs, { why: '' })}` : '';
      }),
    );
    fill('because', blocks.join(''));
  });

  safe('themes', async () => {
    const g = topEntries(profile.genres, 5);
    const k = topEntries(profile.keywords, 8, 1);
    const chips = [
      ...g.map((x) => `<button class="chip" data-theme-genre="${x.id}" data-label="${esc(x.name)}">${esc(x.name)}</button>`),
      ...k.map((x) => `<button class="chip" data-theme-kw="${x.id}" data-label="${esc(x.name)}">#${esc(x.name)}</button>`),
    ];
    fill('themes', chips.length ? `<div class="btn-row">${chips.join('')}</div>` : '<p class="hint">Pas encore assez de films.</p>');
  });
}

// --- Ciné ---

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
    [['now', "À l'affiche"], ['soon', 'Bientôt'], ['prog', 'Mes cinémas']].map(([k, l]) => `<button class="chip ${vs.cineMode === k ? 'on' : ''}" data-cm="${k}">${l}</button>`).join(''),
    (e) => {
      const b = e.target.closest('[data-cm]');
      if (b) {
        vs.cineMode = b.dataset.cm;
        render();
      }
    },
  );
  view.innerHTML = spinner();
  if (!listLoaded) fetchList().catch(() => {});
  if (vs.cineMode === 'prog') return renderProgramme(view);

  if (vs.cineMode === 'now') {
    const movies = (await loadNowPlaying()).sort((a, b) => b.popularity - a.popularity);
    if (alive()) view.innerHTML = grid(movies);
  } else {
    const movies = (await pages('movie/upcoming', {}, 4)).filter((m) => isFuture(m.release_date)).sort((a, b) => a.release_date.localeCompare(b.release_date));
    if (!alive()) return;
    const byMonth = {};
    for (const m of movies) (byMonth[fmtDate(m.release_date, { month: 'long', year: 'numeric' })] ||= []).push(m);
    view.innerHTML =
      Object.entries(byMonth)
        .map(([month, ms]) => `<h2 class="section-title">${esc(month[0].toUpperCase() + month.slice(1))} <small>${ms.length} sorties</small></h2>${grid(ms, { fullDate: true })}`)
        .join('') || '<div class="empty"><b>Aucune sortie annoncée</b></div>';
  }
}

async function renderProgramme(view) {
  if (!settings.theaters.length) {
    view.innerHTML = `<div class="empty"><b>Aucun cinéma enregistré</b>Ajoute tes cinémas préférés dans Réglages pour voir leurs séances ici.</div>
      <button class="btn block" data-tab="reglages">Ajouter un cinéma</button>`;
    return;
  }
  const days = nextDays(7);
  view.innerHTML =
    `<div class="days">${days.map((d) => `<button class="chip ${vs.cineDay === d.iso ? 'on' : ''}" data-day="${d.iso}">${esc(d.label)}</button>`).join('')}</div>` +
    settings.theaters.map((t) => `<div class="box" data-theater="${esc(t.id)}"><h3>${esc(t.name || t.id)}</h3>${spinner()}</div>`).join('');
  view.querySelector('.days').onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (b) {
      vs.cineDay = b.dataset.day;
      renderProgramme(view);
    }
  };
  for (const t of settings.theaters) {
    const box = view.querySelector(`[data-theater="${CSS.escape(t.id)}"]`);
    seances(t.id, vs.cineDay)
      .then((d) => {
        box.innerHTML = `<h3>${esc(t.name || d.theaterName || t.id)} <a href="${esc(d.url)}" target="_blank" rel="noopener">Allociné ↗</a></h3>${
          d.movies.length
            ? d.movies.map((m) => `<div class="theater"><div class="name"><button class="link-btn" data-find="${esc(m.title)}">${esc(m.title)}</button></div><div class="times">${m.showtimes.map(timeChip).join('')}</div></div>`).join('')
            : '<div class="hint">Pas de séance trouvée ce jour-là.</div>'
        }`;
      })
      .catch((e) => {
        box.innerHTML = `<h3>${esc(t.name || t.id)}</h3><div class="hint">${esc(e.message)}. <a href="https://www.allocine.fr/seance/salle_gen_csalle=${esc(t.id)}.html" target="_blank" rel="noopener">Voir sur Allociné ↗</a></div>`;
      });
  }
}

function timeChip(s) {
  const extra = [s.version, ...(s.tags || [])].filter(Boolean).join(' ');
  const inner = `${esc(s.time)}${extra ? `<small>${esc(extra)}</small>` : ''}`;
  return s.bookingUrl ? `<a class="time" href="${esc(s.bookingUrl)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="time">${inner}</span>`;
}

// --- Streaming ---

async function renderStreaming(view, alive) {
  const all = await loadAllProviders().catch(() => []);
  if (!alive()) return;
  const mine = all.filter((p) => settings.providers.includes(p.provider_id));
  const others = all.filter((p) => !settings.providers.includes(p.provider_id)).slice(0, 14);
  const pchip = (p) =>
    `<button class="chip ${String(vs.streamProvider) === String(p.provider_id) ? 'on' : ''}" data-sp="${p.provider_id}"><img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</button>`;
  setTools(
    (mine.length ? `<button class="chip ${vs.streamProvider === 'mine' ? 'on' : ''}" data-sp="mine">Toutes nos plateformes</button>` : '') + [...mine, ...others].map(pchip).join(''),
    (e) => {
      const b = e.target.closest('[data-sp]');
      if (!b) return;
      vs.streamProvider = b.dataset.sp;
      vs.streamPage = 1;
      render();
    },
  );
  if (vs.streamProvider === 'mine' && !mine.length) vs.streamProvider = String(all[0]?.provider_id || 8);
  if (!listLoaded) fetchList().catch(() => {});

  const gmap = await genres().catch(() => new Map());
  const provider = all.find((p) => String(p.provider_id) === String(vs.streamProvider));
  const sorts = [
    ['popular', 'Populaires'],
    ['new', 'Nouveautés'],
    ['top', 'Mieux notés'],
    ['soon', 'Bientôt en VOD'],
  ];
  const head = `
    <div class="days">${sorts.map(([k, l]) => `<button class="chip sm ${vs.streamSort === k ? 'on' : ''}" data-ss="${k}">${l}</button>`).join('')}</div>
    <div class="days"><button class="chip sm ${!vs.streamGenre ? 'on' : ''}" data-sg="">Tous les genres</button>${[...gmap.entries()]
      .map(([id, name]) => `<button class="chip sm ${String(vs.streamGenre) === String(id) ? 'on' : ''}" data-sg="${id}">${esc(name)}</button>`)
      .join('')}</div>
    <div id="stream-note"></div>
    <div id="stream-grid">${spinner()}</div>
    <div style="text-align:center;margin-top:18px"><button class="btn ghost" id="more" hidden>Voir plus</button></div>`;
  view.innerHTML = head;
  view.querySelectorAll('.days').forEach(
    (d) =>
      (d.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.ss) vs.streamSort = b.dataset.ss;
        if (b.dataset.sg !== undefined) vs.streamGenre = b.dataset.sg;
        vs.streamPage = 1;
        render();
      }),
  );

  const providerIds = vs.streamProvider === 'mine' ? settings.providers.join('|') : String(vs.streamProvider);
  const params = { watch_region: 'FR', with_watch_monetization_types: 'flatrate|free|ads' };
  if (vs.streamSort === 'soon') {
    // TMDB ne dit pas quel jour un film arrive sur une plateforme : on montre les sorties VOD françaises à venir.
    Object.assign(params, { region: 'FR', with_release_type: '4', 'release_date.gte': today(), sort_by: 'popularity.desc' });
    delete params.with_watch_monetization_types;
    delete params.watch_region;
    $('#stream-note').innerHTML = `<p class="hint">Films dont la sortie en VOD est annoncée en France. Les plateformes ne communiquent pas toujours leur date d’arrivée à l’avance : la fiche de chaque film indique où il sera disponible dès que c’est connu.</p>`;
  } else {
    params.with_watch_providers = providerIds;
    if (vs.streamSort === 'popular') params.sort_by = 'popularity.desc';
    if (vs.streamSort === 'new') Object.assign(params, { sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today(), 'vote_count.gte': 3 });
    if (vs.streamSort === 'top') Object.assign(params, { sort_by: 'vote_average.desc', 'vote_count.gte': 400 });
    $('#stream-note').innerHTML = provider && vs.streamProvider !== 'mine' ? `<p class="hint">Tout le catalogue films de ${esc(provider.provider_name)} en France.</p>` : '';
  }
  if (vs.streamGenre) params.with_genres = vs.streamGenre;

  const load = async () => {
    const d = await tmdb('discover/movie', { ...params, page: vs.streamPage });
    if (!alive()) return;
    const target = $('#stream-grid');
    let movies = d.results;
    if (vs.streamSort === 'soon') {
      // Ajoute la date de sortie VOD française sur chaque carte.
      const det = await Promise.all(movies.map((m) => movieDetails(m.id).catch(() => null)));
      movies = movies.map((m, k) => {
        const rel = det[k] ? frRelease(det[k]) : {};
        return { ...m, _sub: rel.digital ? `VOD le ${shortDate(rel.digital)}` : '' };
      });
    }
    const html = movies.map((m) => movieCard(m, { showLogos: true, fullDate: true, sub: m._sub || '' })).join('');
    if (vs.streamPage === 1) target.innerHTML = movies.length ? `<div class="grid">${html}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>';
    else target.querySelector('.grid')?.insertAdjacentHTML('beforeend', html);
    fillLogos(target);
    const more = $('#more');
    more.hidden = vs.streamPage >= Math.min(d.total_pages || 1, 50);
    more.textContent = `Voir plus (${(d.total_results || 0).toLocaleString('fr-FR')} films)`;
    more.onclick = () => {
      vs.streamPage += 1;
      more.textContent = 'Chargement…';
      load().catch((e) => toast(e.message));
    };
  };
  await load();
}

// --- Explorer ---

async function renderExplorer(view, alive) {
  setTools('');
  view.innerHTML = `
    <input class="search" id="q" type="search" placeholder="Un film, un acteur, une réalisatrice…" value="${esc(vs.query)}" autocomplete="off" enterkeyhint="search">
    <div id="results" style="margin-top:16px"></div>
    <div id="explore-home"></div>`;
  const input = $('#q');
  const results = $('#results');
  const home = $('#explore-home');
  if (!listLoaded) fetchList().catch(() => {});

  const drawHome = async () => {
    home.innerHTML = `
      <h2 class="section-title">Explorer par thème</h2>
      <div class="theme-grid">${THEMES.map((t) => `<button class="theme" style="--tint:${t.tint}" data-theme="${t.key}"><span class="em">${t.em}</span>${esc(t.label)}</button>`).join('')}</div>
      <h2 class="section-title">Tendances de la semaine</h2><div id="trend">${spinner()}</div>`;
    const trend = await tmdb('trending/movie/week').catch(() => ({ results: [] }));
    if (alive() && $('#trend')) $('#trend').innerHTML = row(trend.results);
  };

  let timer;
  const run = async () => {
    const q = input.value.trim();
    vs.query = q;
    if (q.length < 2) {
      results.innerHTML = '';
      home.hidden = false;
      return;
    }
    home.hidden = true;
    results.innerHTML = spinner('Recherche…');
    try {
      const [films, people] = await Promise.all([tmdb('search/movie', { query: q, include_adult: 'false' }), tmdb('search/person', { query: q, include_adult: 'false' })]);
      if (q !== vs.query) return;
      const persons = people.results.filter((p) => p.profile_path || p.known_for?.length).slice(0, 8);
      results.innerHTML =
        (persons.length
          ? `<h2 class="section-title">Personnes</h2><div class="cast">${persons
              .map((p) => `<button data-person="${p.id}">${p.profile_path ? `<img loading="lazy" src="${IMG}w185${p.profile_path}" alt="">` : '<div class="ph"></div>'}<b>${esc(p.name)}</b>${esc(p.known_for_department === 'Directing' ? 'Réalisation' : p.known_for_department === 'Acting' ? 'Acteur·rice' : p.known_for_department || '')}</button>`)
              .join('')}</div>`
          : '') + `<h2 class="section-title">Films</h2>${grid(films.results, { showLogos: true })}`;
      fillLogos(results);
    } catch (e) {
      results.innerHTML = errorBox(e);
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  drawHome();
  if (vs.query) run();
}

// --- Réglages ---

async function renderReglages(view) {
  setTools('');
  view.innerHTML = `
    <form id="me" class="box">
      <div class="field"><label for="s-name">Ton prénom</label><input id="s-name" value="${esc(settings.name)}" required></div>
      <div class="field"><label for="s-code">Code famille</label><input id="s-code" value="${esc(settings.familyCode)}" autocomplete="off"></div>
      <button class="btn small">Enregistrer</button>
    </form>

    <h2 class="section-title">Nos plateformes</h2>
    <p class="hint">Touchez les abonnements que vous avez : ils seront mis en avant partout et serviront aux recommandations.</p>
    <div id="prov" class="provider-pick">${spinner()}</div>

    <h2 class="section-title">Mes cinémas</h2>
    <p class="hint">Sur <a href="https://www.allocine.fr/salle/" target="_blank" rel="noopener">allocine.fr</a>, ouvre la page de ton cinéma et copie son adresse (elle contient <code>csalle=</code>), puis colle-la ici.</p>
    <form id="add-theater" class="box" style="display:grid;gap:8px">
      <input class="search" id="t-url" placeholder="Lien Allociné du cinéma" autocomplete="off">
      <input class="search" id="t-name" placeholder="Nom (ex. Pathé Wilson)" autocomplete="off">
      <button class="btn small">Ajouter ce cinéma</button>
    </form>
    <div id="theaters" class="rows"></div>

    <h2 class="section-title">Installer sur l'iPhone</h2>
    <p class="hint">Dans Safari, touche le bouton Partager puis « Sur l'écran d'accueil ». L'app s'ouvrira en plein écran comme une vraie application.</p>
    <p class="hint" style="margin-top:28px">Films et plateformes : TMDB et JustWatch. Séances : Allociné. Notes : SensCritique.<br>Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.</p>`;

  $('#me').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ name: $('#s-name').value.trim(), familyCode: $('#s-code').value.trim() });
    resetList();
    toast('Enregistré');
  });

  const drawTheaters = () => {
    $('#theaters').innerHTML = settings.theaters.length
      ? settings.theaters
          .map(
            (t) => `<div class="row" style="grid-template-columns:1fr auto;align-items:center">
              <div><h3>${esc(t.name || t.id)}</h3><div class="meta">${esc(t.id)}</div></div>
              <button class="btn danger small" data-del-theater="${esc(t.id)}">Retirer</button></div>`,
          )
          .join('')
      : '<div class="hint">Aucun cinéma pour l’instant.</div>';
  };
  drawTheaters();
  $('#theaters').onclick = (e) => {
    const b = e.target.closest('[data-del-theater]');
    if (!b) return;
    saveSettings({ theaters: settings.theaters.filter((t) => t.id !== b.dataset.delTheater) });
    drawTheaters();
  };
  $('#add-theater').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#t-url').value.trim();
    const m = raw.match(/csalle=([A-Z0-9]+)/i) || raw.match(/^([A-Z][A-Z0-9]{3,6})$/i);
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
    $('#t-url').value = '';
    $('#t-name').value = '';
    drawTheaters();
    toast('Cinéma ajouté');
  });

  try {
    const top = (await loadAllProviders()).slice(0, 40);
    const draw = () => {
      $('#prov').innerHTML = top
        .map((p) => `<button class="${settings.providers.includes(p.provider_id) ? 'on' : ''}" data-prov="${p.provider_id}"><img src="${IMG}w92${p.logo_path}" alt=""><span>${esc(p.provider_name)}</span></button>`)
        .join('');
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
    };
  } catch (e) {
    $('#prov').innerHTML = errorBox(e);
  }
}

// ---------- Fiches (film, personne, thème) avec historique ----------

const sheet = $('#sheet');
const stack = [];

function setSheetBg(path) {
  $('#sheet-bg').innerHTML = path ? `<img src="${IMG}w300${path}" alt="">` : '';
}

function closeSheet() {
  sheet.hidden = true;
  stack.length = 0;
  document.body.style.overflow = '';
  if (location.hash) history.replaceState(null, '', location.pathname);
}

function pushSheet(entry) {
  stack.push(entry);
  showTop();
}

function showTop() {
  const entry = stack[stack.length - 1];
  if (!entry) return closeSheet();
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheet-back').hidden = stack.length < 2;
  $('.sheet-panel').scrollTop = 0;
  const content = $('#sheet-content');
  content.innerHTML = spinner();
  setSheetBg(null);
  const ok = () => stack[stack.length - 1] === entry;
  const run = { movie: showMovie, person: showPerson, theme: showTheme }[entry.type];
  if (entry.type === 'movie') history.replaceState(null, '', `#film-${entry.id}`);
  run(entry, content, ok).catch((e) => {
    if (ok()) content.innerHTML = `<div style="padding:70px 16px">${errorBox(e)}</div>`;
  });
}

$('#sheet-back').addEventListener('click', () => {
  stack.pop();
  showTop();
});

// --- Film ---

function frRelease(m) {
  const fr = m.release_dates?.results?.find((r) => r.iso_3166_1 === 'FR')?.release_dates || [];
  const pick = (type) => fr.filter((r) => r.type === type).map((r) => r.release_date.slice(0, 10)).sort()[0];
  const cert = fr.map((r) => r.certification).find(Boolean);
  return { theatrical: pick(3) || pick(2), digital: pick(4), physical: pick(5), tv: pick(6), cert };
}

function certLabel(c) {
  if (!c) return '';
  if (/^(U|TP|0|Tous publics)$/i.test(c)) return 'Tous publics';
  return /^\d+$/.test(c) ? `-${c} ans` : c;
}

function providerGroup(label, arr, mine) {
  if (!arr?.length) return '';
  return `<div class="prov-group"><div class="lbl">${label}</div><div class="prov-list">${arr
    .map((p) => `<span class="prov ${mine.has(p.provider_id) ? 'mine' : ''}"><img src="${IMG}w92${p.logo_path}" alt="">${esc(p.provider_name)}</span>`)
    .join('')}</div></div>`;
}

const personLink = (p) => `<button class="link-btn" data-person="${p.id}">${esc(p.name)}</button>`;

async function showMovie(entry, content, ok) {
  const m = await movieDetails(entry.id);
  if (!ok()) return;
  setSheetBg(m.poster_path);
  const draw = () => {
    content.innerHTML = movieHtml(m);
    wireMovie(content, m, draw);
  };
  draw();
}

function movieHtml(m) {
  const saved = inList(m.id);
  const rel = frRelease(m);
  const fr = m['watch/providers']?.results?.FR;
  const mine = new Set(settings.providers);
  const crew = m.credits?.crew || [];
  const uniq = (arr) => [...new Map(arr.map((p) => [p.id, p])).values()];
  const directors = uniq(crew.filter((c) => c.job === 'Director'));
  const writers = uniq(crew.filter((c) => c.department === 'Writing')).slice(0, 3);
  const composers = uniq(crew.filter((c) => c.job === 'Original Music Composer'));
  const dop = uniq(crew.filter((c) => c.job === 'Director of Photography'));
  const cast = (m.credits?.cast || []).slice(0, 15);
  const videos = m.videos?.results || [];
  const trailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.iso_639_1 === 'fr') || videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const theatrical = rel.theatrical || m.release_date;
  const inCinema = nowPlayingIds.has(m.id) || (theatrical && theatrical <= today() && Date.now() - new Date(theatrical) < 1000 * 60 * 60 * 24 * 70);
  const soonCinema = isFuture(theatrical);
  const hasStreaming = fr && (fr.flatrate || fr.rent || fr.buy || fr.free || fr.ads);
  const runtime = m.runtime ? `${Math.floor(m.runtime / 60)} h ${String(m.runtime % 60).padStart(2, '0')}` : '';
  const names = familyNames();
  const avg = familyAvg(saved);
  const keywords = (m.keywords?.keywords || []).slice(0, 10);

  const actions = saved
    ? saved.status === 'hidden'
      ? `<button class="btn ghost" data-act="todo">★ Remettre dans la liste</button>`
      : `<button class="btn ghost" data-act="seen">${saved.status === 'seen' ? '↺ Remettre à voir' : '✓ On l’a vu'}</button>
         <button class="btn danger" data-act="remove">Retirer</button>`
    : `<button class="btn" data-act="add">★ Ajouter à notre liste</button>
       <button class="btn ghost" data-act="seen-new">✓ Déjà vu</button>
       <button class="btn ghost" data-act="hide">Pas pour nous</button>`;

  return `
    ${m.backdrop_path ? `<div class="hero"><img src="${IMG}w780${m.backdrop_path}" alt=""></div>` : ''}
    <div class="detail-head ${m.backdrop_path ? '' : 'noimg'}">
      ${posterImg(m.poster_path, m.title)}
      <div>
        <h2>${esc(m.title)}</h2>
        ${m.original_title && m.original_title !== m.title ? `<div class="orig">${esc(m.original_title)}</div>` : ''}
        <div class="hint">${esc(year(m.release_date))}${runtime ? ` · ${runtime}` : ''}${directors[0] ? ` · ${esc(directors[0].name)}` : ''}</div>
      </div>
    </div>
    <div class="detail-body">
      <div class="scores">
        <div class="score sc" id="sc-score"><b>…</b><span>SensCritique</span></div>
        <div class="score"><b>${m.vote_average ? fr1(m.vote_average) : '–'}</b><span>TMDB · ${(m.vote_count || 0).toLocaleString('fr-FR')} votes</span></div>
        <div class="score us"><b>${avg ? fr1(avg) + '/5' : '–'}</b><span>Notre note</span></div>
      </div>
      <div class="facts">
        ${rel.cert ? `<span class="fact age">${esc(certLabel(rel.cert))}</span>` : ''}
        ${inCinema ? '<span class="fact age">Au cinéma</span>' : ''}
        ${(m.genres || []).map((g) => `<button class="fact" data-theme-genre="${g.id}" data-label="${esc(g.name)}">${esc(g.name)}</button>`).join('')}
      </div>
      ${m.tagline ? `<p class="hint"><i>${esc(m.tagline)}</i></p>` : ''}

      <div class="btn-row" style="margin:14px 0">
        ${actions}
        ${trailer ? `<a class="btn ghost" href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">▶ Bande-annonce</a>` : ''}
      </div>

      ${
        saved && saved.status !== 'hidden'
          ? `<div class="box"><h3>Qui veut le voir ?</h3><div class="people">${names
              .map((n) => `<button class="person ${(saved.wants || []).includes(n) ? 'on' : ''}" data-want="${esc(n)}">${avatar(n)}${esc(n)}</button>`)
              .join('')}</div>
              ${ratingHtml(saved)}
              <div class="field" style="margin:12px 0 0"><label for="note">Petite note</label><textarea id="note" rows="2" placeholder="Ex. à voir avec les filles, en VO…">${esc(saved.note || '')}</textarea></div>
            </div>`
          : ''
      }

      <div class="box"><h3>Où le voir en streaming ${fr?.link ? `<a href="${esc(fr.link)}" target="_blank" rel="noopener">JustWatch ↗</a>` : ''}</h3>${
        hasStreaming
          ? providerGroup('Inclus dans l’abonnement', fr.flatrate, mine) +
            providerGroup('Gratuit', [...(fr.free || []), ...(fr.ads || [])], mine) +
            providerGroup('Location', fr.rent, mine) +
            providerGroup('Achat', fr.buy, mine)
          : `<div class="hint">Pas encore disponible en streaming en France.${rel.digital ? ` Sortie en VOD prévue le <b>${esc(fmtDate(rel.digital))}</b>.` : ''}</div>`
      }</div>

      <div class="box"><h3>Au cinéma <a href="${esc(allocineSearch(m.title))}" target="_blank" rel="noopener">Allociné ↗</a></h3>${
        soonCinema ? `<div>Sortie en salles le <b>${esc(fmtDate(theatrical))}</b>.</div>` : theatrical ? `<div class="hint">Sorti en salles le ${esc(fmtDate(theatrical))}.</div>` : ''
      }
        <div id="seances"></div>
      </div>

      <div class="box"><h3>Synopsis</h3><div>${esc(m.overview || 'Pas de synopsis en français.')}</div></div>

      <div class="box"><h3>Équipe</h3>
        <div class="crew">
          ${directors.length ? `<div class="crew-line"><span class="hint">Réalisation</span> ${directors.map(personLink).join(', ')}</div>` : ''}
          ${writers.length ? `<div class="crew-line"><span class="hint">Scénario</span> ${writers.map(personLink).join(', ')}</div>` : ''}
          ${composers.length ? `<div class="crew-line"><span class="hint">Musique</span> ${composers.map(personLink).join(', ')}</div>` : ''}
          ${dop.length ? `<div class="crew-line"><span class="hint">Image</span> ${dop.map(personLink).join(', ')}</div>` : ''}
        </div>
        ${
          cast.length
            ? `<div class="cast" style="margin-top:14px">${cast
                .map((c) => `<button data-person="${c.id}">${c.profile_path ? `<img loading="lazy" src="${IMG}w185${c.profile_path}" alt="">` : '<div class="ph"></div>'}<b>${esc(c.name)}</b>${esc(c.character || '')}</button>`)
                .join('')}</div>`
            : ''
        }
      </div>

      ${keywords.length ? `<div class="box"><h3>Thèmes</h3><div class="btn-row">${keywords.map((k) => `<button class="chip sm" data-theme-kw="${k.id}" data-label="${esc(k.name)}">#${esc(k.name)}</button>`).join('')}</div></div>` : ''}

      <div class="box"><h3>Infos</h3>
        ${theatrical ? `<div><span class="hint">Sortie salles (FR)</span> ${esc(fmtDate(theatrical))}</div>` : ''}
        ${rel.digital ? `<div><span class="hint">Sortie VOD (FR)</span> ${esc(fmtDate(rel.digital))}</div>` : ''}
        ${rel.physical ? `<div><span class="hint">DVD / Blu-ray</span> ${esc(fmtDate(rel.physical))}</div>` : ''}
        ${rel.tv ? `<div><span class="hint">Diffusion TV</span> ${esc(fmtDate(rel.tv))}</div>` : ''}
        ${m.production_countries?.length ? `<div><span class="hint">Pays</span> ${esc(m.production_countries.map((c) => c.name).join(', '))}</div>` : ''}
        ${m.budget ? `<div><span class="hint">Budget</span> ${(m.budget / 1e6).toFixed(0)} M$</div>` : ''}
        ${m.revenue ? `<div><span class="hint">Box-office</span> ${(m.revenue / 1e6).toFixed(0)} M$</div>` : ''}
        <div style="margin-top:6px">${m.imdb_id ? `<a href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">IMDb ↗</a> · ` : ''}<a href="https://www.themoviedb.org/movie/${m.id}" target="_blank" rel="noopener">TMDB ↗</a> · <a id="sc-link" href="#" target="_blank" rel="noopener">SensCritique ↗</a></div>
      </div>

      ${m.recommendations?.results?.length ? `<h2 class="section-title">Dans le même esprit</h2>${row(m.recommendations.results.slice(0, 14), { why: '' })}` : ''}
    </div>`;
}

function ratingHtml(saved) {
  if (saved.status !== 'seen') return '';
  const my = saved.ratings?.[settings.name] || 0;
  const others = Object.entries(saved.ratings || {}).filter(([n]) => n !== settings.name);
  return `<div style="margin-top:14px"><div class="hint">Ta note (sert aux recommandations)</div><div class="stars">${[1, 2, 3, 4, 5]
    .map((v) => `<button class="${v <= my ? 'on' : ''}" data-rate="${v}" aria-label="${v} étoiles">★</button>`)
    .join('')}</div>${others.length ? `<div class="hint">${others.map(([n, v]) => `${esc(n)} : ${'★'.repeat(v)}`).join(' · ')}</div>` : ''}</div>`;
}

function wireMovie(content, m, redraw) {
  const refresh = () => {
    redraw();
    if (currentTab === 'liste') render();
  };
  content.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      const act = b.dataset.act;
      if (act === 'add') {
        await listAction({ action: 'add', movie: m });
        toast('Ajouté à votre liste');
      } else if (act === 'seen-new') {
        await listAction({ action: 'add', movie: m, status: 'seen' });
        toast('Ajouté aux films vus : notez-le !');
      } else if (act === 'hide') {
        await listAction({ action: 'add', movie: m, status: 'hidden' });
        toast('Noté, on vous en proposera moins comme ça');
      } else if (act === 'todo') {
        await listAction({ action: 'setStatus', movieId: m.id, status: 'todo' });
      } else if (act === 'remove') {
        if (!confirm(`Retirer « ${m.title} » de la liste ?`)) return;
        await listAction({ action: 'remove', movieId: m.id });
        toast('Retiré');
      } else if (act === 'seen') {
        const seen = inList(m.id)?.status === 'seen';
        await listAction({ action: 'setStatus', movieId: m.id, status: seen ? 'todo' : 'seen' });
        toast(seen ? 'Remis dans « À voir »' : 'Marqué comme vu : notez-le !');
      } else if (b.dataset.want) {
        await listAction({ action: 'toggleWant', movieId: m.id, by: b.dataset.want });
      } else if (b.dataset.rate) {
        const v = Number(b.dataset.rate);
        await listAction({ action: 'rate', movieId: m.id, value: inList(m.id)?.ratings?.[settings.name] === v ? 0 : v });
      } else {
        return;
      }
      refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  const note = $('#note', content);
  if (note) note.addEventListener('change', () => listAction({ action: 'note', movieId: m.id, note: note.value }).then(() => toast('Note enregistrée')).catch((err) => toast(err.message)));

  senscritique(m).then((d) => {
    const box = $('#sc-score', content);
    const link = $('#sc-link', content);
    if (link) link.href = d?.url || d?.searchUrl || '#';
    if (!box) return;
    box.innerHTML = d?.rating ? `<b>${fr1(d.rating)}</b><span>SensCritique${d.count ? ` · ${d.count.toLocaleString('fr-FR')}` : ''}</span>` : `<b>–</b><span>SensCritique</span>`;
    if (d?.url || d?.searchUrl) box.outerHTML = `<a class="score sc" id="sc-score" href="${esc(d.url || d.searchUrl)}" target="_blank" rel="noopener">${box.innerHTML}</a>`;
  });
  loadSeances(content, m);
}

// Séances du film dans les cinémas enregistrés.
async function loadSeances(content, m, day = today()) {
  const box = $('#seances', content);
  if (!box) return;
  const rel = frRelease(m);
  const theatrical = rel.theatrical || m.release_date;
  const plausible = nowPlayingIds.has(m.id) || (theatrical && Math.abs(Date.now() - new Date(theatrical)) < 1000 * 60 * 60 * 24 * 90);
  if (!plausible) return;
  if (!settings.theaters.length) {
    box.innerHTML = '<p class="hint">Ajoute tes cinémas dans Réglages pour voir les séances près de chez toi.</p>';
    return;
  }
  box.innerHTML = `<div class="days" style="margin-top:10px">${nextDays(7)
    .map((d) => `<button class="chip sm ${d.iso === day ? 'on' : ''}" data-sday="${d.iso}">${esc(d.label)}</button>`)
    .join('')}</div><div id="seances-list">${spinner('Recherche des séances…')}</div>`;
  box.querySelector('.days').onclick = (e) => {
    const b = e.target.closest('[data-sday]');
    if (b) {
      e.stopPropagation();
      loadSeances(content, m, b.dataset.sday);
    }
  };
  const targets = new Set([normalize(m.title), normalize(m.original_title)]);
  const results = await Promise.all(
    settings.theaters.map((t) =>
      seances(t.id, day)
        .then((d) => ({ t, d, movie: d.movies.find((x) => targets.has(normalize(x.title)) || targets.has(normalize(x.originalTitle))) }))
        .catch((err) => ({ t, err })),
    ),
  );
  const out = $('#seances-list', content);
  if (!out) return;
  const found = results.filter((r) => r.movie);
  const failed = results.filter((r) => r.err);
  out.innerHTML =
    (found.length
      ? found
          .map((r) => `<div class="theater"><div class="name">${esc(r.t.name || r.d.theaterName || r.t.id)}<a class="hint" href="${esc(r.d.url)}" target="_blank" rel="noopener">↗</a></div><div class="times">${r.movie.showtimes.map(timeChip).join('')}</div></div>`)
          .join('')
      : `<p class="hint">Aucune séance ce jour-là dans tes cinémas.</p>`) +
    (failed.length ? `<p class="hint">Séances indisponibles pour ${esc(failed.map((r) => r.t.name || r.t.id).join(', '))} (Allociné ne répond pas).</p>` : '');
}

// --- Personne (acteur, réalisateur…) ---

async function showPerson(entry, content, ok) {
  const p = await tmdb(`person/${entry.id}`, { append_to_response: 'movie_credits,external_ids' });
  if (!ok()) return;
  setSheetBg(p.profile_path);
  const cast = p.movie_credits?.cast || [];
  const crew = p.movie_credits?.crew || [];
  const dedupe = (arr) => [...new Map(arr.map((m) => [m.id, m])).values()];
  const directed = dedupe(crew.filter((c) => c.job === 'Director'));
  const written = dedupe(crew.filter((c) => c.department === 'Writing' && !directed.some((d) => d.id === c.id)));
  const acted = dedupe(cast.filter((c) => !(c.genre_ids || []).includes(99) || cast.length < 10));
  const isDirector = p.known_for_department === 'Directing' || directed.length > acted.length / 3;
  const byPop = (arr) => [...arr].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const byDate = (arr) => [...arr].sort((a, b) => (b.release_date || '9999').localeCompare(a.release_date || '9999'));
  const upcoming = dedupe([...directed, ...acted].filter((m) => isFuture(m.release_date) || !m.release_date)).filter((m) => m.release_date);
  const inOurList = dedupe([...directed, ...acted, ...written]).filter((m) => inList(m.id));
  const age = p.birthday ? Math.floor((new Date(p.deathday || Date.now()) - new Date(p.birthday)) / (365.25 * 864e5)) : null;
  const dept = { Acting: 'Acteur·rice', Directing: 'Réalisation', Writing: 'Scénario', Sound: 'Musique', Camera: 'Image', Production: 'Production' }[p.known_for_department] || p.known_for_department || '';

  let mode = 'pop';
  const draw = () => {
    const sort = mode === 'pop' ? byPop : byDate;
    const sections = [
      upcoming.length ? `<h2 class="section-title">À venir</h2>${row(upcoming.sort((a, b) => a.release_date.localeCompare(b.release_date)), { fullDate: true })}` : '',
      inOurList.length ? `<h2 class="section-title">Dans notre liste</h2>${row(inOurList)}` : '',
      ...(isDirector
        ? [
            directed.length ? `<h2 class="section-title">Réalisation <small>${directed.length} films</small></h2>${grid(sort(directed))}` : '',
            acted.length ? `<h2 class="section-title">Comme acteur·rice <small>${acted.length} films</small></h2>${grid(sort(acted).slice(0, 30), { sub: '' })}` : '',
          ]
        : [
            acted.length ? `<h2 class="section-title">Filmographie <small>${acted.length} films</small></h2>${grid(sort(acted).slice(0, 60).map((m) => ({ ...m, _why: m.character ? `Rôle : ${m.character}` : '' })))}` : '',
            directed.length ? `<h2 class="section-title">Réalisation <small>${directed.length} films</small></h2>${grid(sort(directed))}` : '',
          ]),
      written.length ? `<h2 class="section-title">Scénario <small>${written.length} films</small></h2>${grid(sort(written).slice(0, 18))}` : '',
    ];
    content.innerHTML = `
      <div class="person-head">
        ${p.profile_path ? `<img src="${IMG}w300${p.profile_path}" alt="">` : '<div class="ph"></div>'}
        <div>
          <h2>${esc(p.name)}</h2>
          <div class="hint">${esc(dept)}${age ? ` · ${p.deathday ? `mort·e à ${age} ans` : `${age} ans`}` : ''}</div>
          ${p.place_of_birth ? `<div class="hint">${esc(p.place_of_birth)}</div>` : ''}
        </div>
      </div>
      <div class="detail-body">
        ${p.biography ? `<div class="box"><h3>Biographie</h3><div class="bio" id="bio">${esc(p.biography)}</div><button class="link-btn hint" id="bio-more" style="margin-top:6px">Lire la suite</button></div>` : ''}
        <div class="days" style="margin-top:14px"><button class="chip sm ${mode === 'pop' ? 'on' : ''}" data-pm="pop">Les plus connus</button><button class="chip sm ${mode === 'date' ? 'on' : ''}" data-pm="date">Par date</button>
          ${p.imdb_id || p.external_ids?.imdb_id ? `<a class="chip sm" href="https://www.imdb.com/name/${esc(p.imdb_id || p.external_ids.imdb_id)}/" target="_blank" rel="noopener">IMDb ↗</a>` : ''}</div>
        ${sections.join('')}
      </div>`;
    content.querySelector('[data-pm="pop"]').parentElement.onclick = (e) => {
      const b = e.target.closest('[data-pm]');
      if (b) {
        mode = b.dataset.pm;
        draw();
      }
    };
    const more = $('#bio-more', content);
    if (more) more.onclick = () => ($('#bio', content).classList.toggle('open'), (more.textContent = $('#bio', content).classList.contains('open') ? 'Réduire' : 'Lire la suite'));
  };
  draw();
}

// --- Thème (genre ou mot-clé) ---

async function showTheme(entry, content, ok) {
  let sort = 'popularity.desc';
  let onlyMine = false;
  let page = 1;
  const base = entry.params || (await themeParams(entry.theme));
  if (!ok()) return;
  const draw = async () => {
    const params = { ...base, 'vote_count.gte': base['vote_count.gte'] ?? 30, sort_by: base.sort_by && sort === 'popularity.desc' ? base.sort_by : sort };
    if (sort === 'vote_average.desc') params['vote_count.gte'] = Math.max(300, params['vote_count.gte']);
    if (sort === 'primary_release_date.desc') params['primary_release_date.lte'] = today();
    if (onlyMine && settings.providers.length) Object.assign(params, { watch_region: 'FR', with_watch_providers: settings.providers.join('|'), with_watch_monetization_types: 'flatrate|free|ads' });
    if (page === 1) {
      content.innerHTML = `
        <div class="detail-body" style="padding-top:60px">
          <h2 style="font-size:28px;margin:0 0 14px;letter-spacing:-.03em">${esc(entry.label)}</h2>
          <div class="days">
            ${[['popularity.desc', 'Populaires'], ['vote_average.desc', 'Mieux notés'], ['primary_release_date.desc', 'Récents']]
              .map(([k, l]) => `<button class="chip sm ${sort === k ? 'on' : ''}" data-ts="${k}">${l}</button>`)
              .join('')}
            ${settings.providers.length ? `<button class="chip sm ${onlyMine ? 'on' : ''}" data-tm>Sur nos plateformes</button>` : ''}
          </div>
          <div id="theme-grid">${spinner()}</div>
          <div style="text-align:center;margin-top:18px"><button class="btn ghost" id="theme-more" hidden>Voir plus</button></div>
        </div>`;
      content.querySelector('.days').onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        if (b.dataset.ts) sort = b.dataset.ts;
        if (b.dataset.tm !== undefined) onlyMine = !onlyMine;
        page = 1;
        draw();
      };
    }
    const d = await tmdb('discover/movie', { ...params, page });
    if (!ok()) return;
    const target = $('#theme-grid', content);
    const html = d.results.map((m) => movieCard(m, { showLogos: true })).join('');
    if (page === 1) target.innerHTML = d.results.length ? `<div class="grid">${html}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>';
    else target.querySelector('.grid')?.insertAdjacentHTML('beforeend', html);
    fillLogos(target);
    const more = $('#theme-more', content);
    more.hidden = page >= Math.min(d.total_pages || 1, 30);
    more.onclick = (e) => {
      e.stopPropagation();
      page += 1;
      draw();
    };
  };
  await draw();
}

// ---------- Navigation ----------

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    if (!sheet.hidden) closeSheet();
    currentTab = tab.dataset.tab;
    window.scrollTo(0, 0);
    render();
    return;
  }
  if (e.target.closest('[data-close]')) return closeSheet();
  const person = e.target.closest('[data-person]');
  if (person) return pushSheet({ type: 'person', id: Number(person.dataset.person) });
  const card = e.target.closest('[data-movie]');
  if (card) return pushSheet({ type: 'movie', id: Number(card.dataset.movie) });
  const theme = e.target.closest('[data-theme]');
  if (theme) {
    const t = THEMES.find((x) => x.key === theme.dataset.theme);
    return pushSheet({ type: 'theme', label: t.label, theme: t });
  }
  const tg = e.target.closest('[data-theme-genre]');
  if (tg) return pushSheet({ type: 'theme', label: tg.dataset.label, params: { with_genres: tg.dataset.themeGenre } });
  const tk = e.target.closest('[data-theme-kw]');
  if (tk) return pushSheet({ type: 'theme', label: `#${tk.dataset.label}`, params: { with_keywords: tk.dataset.themeKw } });
  const find = e.target.closest('[data-find]');
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sheet.hidden) closeSheet();
});

// Rafraîchit la liste quand on revient sur l'app (un autre membre a pu ajouter un film).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentTab === 'liste' && settings.name && sheet.hidden) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

loadNowPlaying().catch(() => {});
render();
const hashFilm = location.hash.match(/^#film-(\d+)$/);
if (hashFilm && settings.name) pushSheet({ type: 'movie', id: Number(hashFilm[1]) });


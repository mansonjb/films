// Nos films : watchlist familiale (TMDB pour les films et le streaming, Allociné pour les séances).

const IMG = 'https://image.tmdb.org/t/p/';
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Réglages (gardés sur le téléphone) ----------

const DEFAULT_SETTINGS = { name: '', familyCode: '', providers: [], theaters: [] };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
let settings = loadSettings();
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch {}
}

// ---------- Accès aux données ----------

const memo = new Map();
async function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  if (memo.has(qs)) return memo.get(qs);
  const p = fetch(`/api/tmdb?${qs}`).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || data.status_message || `Erreur ${r.status}`);
    return data;
  });
  memo.set(qs, p);
  p.catch(() => memo.delete(qs));
  return p;
}

let list = { items: [] };
let listLoaded = false;

async function fetchList() {
  const r = await fetch('/api/list', { headers: { 'x-family-code': settings.familyCode } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  list = data;
  listLoaded = true;
  return list;
}

async function listAction(body) {
  const r = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-family-code': settings.familyCode },
    body: JSON.stringify({ by: settings.name, ...body }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  list = data;
  return list;
}

const inList = (id) => list.items.find((i) => i.id === id);

// Films à l'affiche en France, pour les badges « Au ciné ».
let nowPlayingIds = new Set();
async function loadNowPlaying() {
  try {
    const pages = await Promise.all([1, 2, 3].map((page) => tmdb('movie/now_playing', { page })));
    nowPlayingIds = new Set(pages.flatMap((p) => p.results.map((m) => m.id)));
  } catch {}
}

// Plateformes d'un film (France), mises en cache pour la session.
const providerCache = new Map();
function providersFor(id) {
  if (!providerCache.has(id)) {
    providerCache.set(id, tmdb(`movie/${id}/watch/providers`).then((d) => d.results?.FR || null).catch(() => null));
  }
  return providerCache.get(id);
}

let allProviders = null;
async function loadAllProviders() {
  if (!allProviders) {
    const d = await tmdb('watch/providers/movie', { watch_region: 'FR' });
    allProviders = d.results.sort((a, b) => (a.display_priorities?.FR ?? a.display_priority) - (b.display_priorities?.FR ?? b.display_priority));
  }
  return allProviders;
}

const seancesCache = new Map();
function seances(theaterId, date) {
  const key = `${theaterId}|${date}`;
  if (!seancesCache.has(key)) {
    seancesCache.set(
      key,
      fetch(`/api/seances?theater=${encodeURIComponent(theaterId)}&date=${date}`).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Object.assign(new Error(data.error || `Erreur ${r.status}`), { data });
        return data;
      }),
    );
    seancesCache.get(key).catch(() => seancesCache.delete(key));
  }
  return seancesCache.get(key);
}

// ---------- Utilitaires d'affichage ----------

const fmtDate = (d, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('fr-FR', opts) : '');
const year = (d) => (d ? d.slice(0, 4) : '');
const today = () => new Date().toISOString().slice(0, 10);
const isFuture = (d) => d && d > today();
const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();
const color = (name) => `hsl(${[...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 45% 38%)`;
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

function familyNames() {
  const names = new Set(settings.name ? [settings.name] : []);
  for (const i of list.items) {
    if (i.addedBy && i.addedBy !== '?') names.add(i.addedBy);
    (i.wants || []).forEach((n) => names.add(n));
  }
  return [...names];
}

function movieCard(m, { showLogos = false } = {}) {
  const saved = inList(m.id);
  const badges = [];
  if (saved?.status === 'seen') badges.push('<span class="badge seen">Vu</span>');
  else if (saved) badges.push('<span class="badge">★ Liste</span>');
  if (nowPlayingIds.has(m.id)) badges.push('<span class="badge cine">Au ciné</span>');
  else if (isFuture(m.release_date)) badges.push(`<span class="badge">${esc(fmtDate(m.release_date, { day: 'numeric', month: 'short' }))}</span>`);
  return `
    <button class="card" data-movie="${m.id}">
      ${posterImg(m.poster_path, m.title)}
      <div class="badges">${badges.join('')}</div>
      <div class="t">${esc(m.title)}</div>
      <div class="s">${esc(year(m.release_date))}${m.vote_average ? ` · ★ ${m.vote_average.toFixed(1)}` : ''}</div>
      ${showLogos ? `<div class="logos" data-logos="${m.id}"></div>` : ''}
    </button>`;
}

async function fillLogos(root) {
  const mine = new Set(settings.providers);
  for (const el of root.querySelectorAll('[data-logos]')) {
    providersFor(Number(el.dataset.logos)).then((fr) => {
      const subs = fr?.flatrate || [];
      const sorted = [...subs].sort((a, b) => mine.has(b.provider_id) - mine.has(a.provider_id));
      el.innerHTML = sorted
        .slice(0, 4)
        .map((p) => `<img class="logo" src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`)
        .join('');
    });
  }
}

const spinner = (txt = 'Chargement…') => `<div class="spinner">${esc(txt)}</div>`;
const errorBox = (e) => `<div class="error">${esc(e.message || e)}</div>`;

// ---------- Vues ----------

const TITLES = { liste: 'Notre liste', cine: 'Au cinéma', streaming: 'Streaming', recherche: 'Chercher', reglages: 'Réglages' };
let currentTab = 'liste';
const viewState = { listeFilter: 'todo', listeOnly: 'all', cineMode: 'now', cineDay: today(), streamMode: 'mine', query: '' };

function setTools(html) {
  $('#view-tools').innerHTML = html;
}

async function render() {
  $('#view-title').textContent = TITLES[currentTab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  const view = $('#view');
  if (!settings.name && currentTab !== 'reglages') return renderWelcome(view);
  try {
    await { liste: renderListe, cine: renderCine, streaming: renderStreaming, recherche: renderRecherche, reglages: renderReglages }[currentTab](view);
  } catch (e) {
    view.innerHTML = errorBox(e);
  }
}

function renderWelcome(view) {
  setTools('');
  view.innerHTML = `
    <div class="empty"><b>Bienvenue 👋</b>Dis-nous qui tu es pour partager la liste avec la famille.</div>
    <form id="welcome">
      <div class="field"><label for="w-name">Ton prénom</label><input id="w-name" required autocomplete="given-name" placeholder="Jean-Baptiste"></div>
      <div class="field"><label for="w-code">Code famille</label><input id="w-code" autocomplete="off" placeholder="Celui que tu as choisi à l'installation"></div>
      <button class="btn" style="width:100%">C'est parti</button>
    </form>`;
  $('#welcome').addEventListener('submit', async (e) => {
    e.preventDefault();
    saveSettings({ name: $('#w-name').value.trim(), familyCode: $('#w-code').value.trim() });
    render();
  });
}

async function renderListe(view) {
  const f = viewState;
  setTools(
    [
      ['todo', 'À voir'],
      ['seen', 'Déjà vus'],
    ]
      .map(([k, l]) => `<button class="chip ${f.listeFilter === k ? 'on' : ''}" data-lf="${k}">${l}</button>`)
      .join('') +
      [
        ['all', 'Tout'],
        ['cine', 'Au ciné'],
        ['mine', 'Sur nos plateformes'],
        ['soon', 'Bientôt'],
      ]
        .map(([k, l]) => `<button class="chip ${f.listeOnly === k ? 'on' : ''}" data-lo="${k}">${l}</button>`)
        .join(''),
  );
  $('#view-tools').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lf) f.listeFilter = b.dataset.lf;
    if (b.dataset.lo) f.listeOnly = b.dataset.lo;
    render();
  };

  if (!listLoaded) view.innerHTML = spinner();
  await Promise.all([fetchList(), nowPlayingIds.size ? null : loadNowPlaying()]);

  let items = list.items.filter((i) => (i.status || 'todo') === f.listeFilter);
  if (f.listeOnly === 'cine') items = items.filter((i) => nowPlayingIds.has(i.id));
  if (f.listeOnly === 'soon') items = items.filter((i) => isFuture(i.release_date));
  if (f.listeOnly === 'mine') {
    const mine = new Set(settings.providers);
    const avail = await Promise.all(items.map((i) => providersFor(i.id)));
    items = items.filter((_, k) => (avail[k]?.flatrate || []).some((p) => mine.has(p.provider_id)));
  }
  items.sort((a, b) => (b.wants?.length || 0) - (a.wants?.length || 0) || (b.addedAt || '').localeCompare(a.addedAt || ''));

  if (!items.length) {
    view.innerHTML = `<div class="empty"><b>${f.listeFilter === 'seen' ? 'Aucun film vu pour l’instant' : 'Rien ici pour l’instant'}</b>${
      f.listeFilter === 'todo' && f.listeOnly === 'all' ? 'Ajoute des films depuis Ciné, Streaming ou Chercher.' : 'Essaie un autre filtre.'
    }</div>`;
    return;
  }

  view.innerHTML = `<div class="rows">${items
    .map((i) => {
      const status = nowPlayingIds.has(i.id)
        ? '<span class="badge cine">Au ciné</span>'
        : isFuture(i.release_date)
          ? `<span class="badge">Sortie ${esc(fmtDate(i.release_date, { day: 'numeric', month: 'short' }))}</span>`
          : '';
      const ratings = Object.values(i.ratings || {});
      const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      return `
      <button class="row" data-movie="${i.id}">
        ${posterImg(i.poster_path, i.title, 'w185')}
        <div>
          <h3>${esc(i.title)}</h3>
          <div class="meta">${esc(year(i.release_date))}${i.vote_average ? ` · ★ ${Number(i.vote_average).toFixed(1)}` : ''} · ajouté par ${esc(i.addedBy)}</div>
          <div class="line">${status}<span class="avatars">${(i.wants || []).map(avatar).join('')}</span>${
            avg ? `<span class="meta">Notre note ${'★'.repeat(Math.round(avg))}</span>` : ''
          }</div>
          <div class="logos" data-logos="${i.id}"></div>
          ${i.note ? `<div class="meta" style="margin-top:4px">📝 ${esc(i.note)}</div>` : ''}
        </div>
      </button>`;
    })
    .join('')}</div>`;
  fillLogos(view);
}

function nextDays(n = 7) {
  const out = [];
  const d = new Date();
  for (let k = 0; k < n; k++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    out.push({ iso, label: k === 0 ? "Auj." : k === 1 ? 'Demain' : day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) });
  }
  return out;
}

async function renderCine(view) {
  const f = viewState;
  setTools(
    [
      ['now', "À l'affiche"],
      ['soon', 'Bientôt'],
      ['prog', 'Mes cinémas'],
    ]
      .map(([k, l]) => `<button class="chip ${f.cineMode === k ? 'on' : ''}" data-cm="${k}">${l}</button>`)
      .join(''),
  );
  $('#view-tools').onclick = (e) => {
    const b = e.target.closest('[data-cm]');
    if (b) {
      f.cineMode = b.dataset.cm;
      render();
    }
  };
  view.innerHTML = spinner();
  if (!listLoaded) fetchList().catch(() => {});

  if (f.cineMode === 'prog') return renderProgramme(view);

  if (f.cineMode === 'now') {
    const pages = await Promise.all([1, 2, 3].map((page) => tmdb('movie/now_playing', { page })));
    const seen = new Set();
    const movies = pages.flatMap((p) => p.results).filter((m) => !seen.has(m.id) && seen.add(m.id));
    nowPlayingIds = seen;
    movies.sort((a, b) => b.popularity - a.popularity);
    view.innerHTML = `<div class="grid">${movies.map((m) => movieCard(m)).join('')}</div>`;
  } else {
    const pages = await Promise.all([1, 2, 3].map((page) => tmdb('movie/upcoming', { page })));
    const seen = new Set();
    const movies = pages
      .flatMap((p) => p.results)
      .filter((m) => isFuture(m.release_date) && !seen.has(m.id) && seen.add(m.id))
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
    const byMonth = {};
    for (const m of movies) (byMonth[fmtDate(m.release_date, { month: 'long', year: 'numeric' })] ||= []).push(m);
    view.innerHTML =
      Object.entries(byMonth)
        .map(([month, ms]) => `<h2 class="section-title">${esc(month[0].toUpperCase() + month.slice(1))}</h2><div class="grid">${ms.map((m) => movieCard(m)).join('')}</div>`)
        .join('') || '<div class="empty"><b>Aucune sortie annoncée</b></div>';
  }
}

async function renderProgramme(view) {
  const f = viewState;
  if (!settings.theaters.length) {
    view.innerHTML = `<div class="empty"><b>Aucun cinéma enregistré</b>Ajoute tes cinémas préférés dans Réglages pour voir leurs séances ici.</div>
      <button class="btn" style="width:100%" data-goto="reglages">Ajouter un cinéma</button>`;
    return;
  }
  const days = nextDays(7);
  const dayChips = `<div class="days">${days.map((d) => `<button class="chip ${f.cineDay === d.iso ? 'on' : ''}" data-day="${d.iso}">${esc(d.label)}</button>`).join('')}</div>`;
  view.innerHTML = dayChips + `<div class="programme">${settings.theaters.map((t) => `<div class="box" data-theater="${esc(t.id)}"><h3>${esc(t.name || t.id)}</h3>${spinner()}</div>`).join('')}</div>`;
  view.querySelector('.days').onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (b) {
      f.cineDay = b.dataset.day;
      renderProgramme(view);
    }
  };
  for (const t of settings.theaters) {
    const box = view.querySelector(`[data-theater="${CSS.escape(t.id)}"]`);
    seances(t.id, f.cineDay)
      .then((d) => {
        box.innerHTML = `<h3>${esc(t.name || d.theaterName || t.id)} <a class="hint" href="${esc(d.url)}" target="_blank" rel="noopener">Allociné ↗</a></h3>${
          d.movies.length
            ? d.movies
                .map(
                  (m) => `<div class="theater">
                    <div class="name"><button class="btn ghost small" data-find="${esc(m.title)}">${esc(m.title)}</button></div>
                    <div class="times">${m.showtimes.map(timeChip).join('')}</div>
                  </div>`,
                )
                .join('')
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

async function renderStreaming(view) {
  const f = viewState;
  const modes = [
    ['mine', 'Sur nos plateformes'],
    ['new', 'Nouveautés'],
    ['trend', 'Tendances'],
    ['top', 'Les mieux notés'],
  ];
  setTools(modes.map(([k, l]) => `<button class="chip ${f.streamMode === k ? 'on' : ''}" data-sm="${k}">${l}</button>`).join(''));
  $('#view-tools').onclick = (e) => {
    const b = e.target.closest('[data-sm]');
    if (b) {
      f.streamMode = b.dataset.sm;
      render();
    }
  };
  view.innerHTML = spinner();
  if (!listLoaded) fetchList().catch(() => {});

  const providers = settings.providers.join('|');
  let movies;
  if (f.streamMode === 'trend') {
    movies = (await tmdb('trending/movie/week')).results;
  } else {
    if (f.streamMode !== 'top' && !providers) {
      view.innerHTML = `<div class="empty"><b>Choisis vos plateformes</b>Indique dans Réglages les abonnements que vous avez (Netflix, Prime Video…).</div>
        <button class="btn" style="width:100%" data-goto="reglages">Choisir nos plateformes</button>`;
      return;
    }
    const params = { watch_region: 'FR', with_watch_monetization_types: 'flatrate', 'vote_count.gte': f.streamMode === 'top' ? 300 : 20 };
    if (providers) params.with_watch_providers = providers;
    if (f.streamMode === 'mine') params.sort_by = 'popularity.desc';
    if (f.streamMode === 'new') {
      params.sort_by = 'primary_release_date.desc';
      params['primary_release_date.lte'] = today();
      params['vote_count.gte'] = 5;
    }
    if (f.streamMode === 'top') params.sort_by = 'vote_average.desc';
    const pages = await Promise.all([1, 2].map((page) => tmdb('discover/movie', { ...params, page })));
    movies = pages.flatMap((p) => p.results);
  }
  view.innerHTML = movies.length ? `<div class="grid">${movies.map((m) => movieCard(m, { showLogos: true })).join('')}</div>` : '<div class="empty"><b>Aucun film trouvé</b></div>';
  fillLogos(view);
}

async function renderRecherche(view) {
  setTools('');
  view.innerHTML = `<input class="search" id="q" type="search" placeholder="Titre d'un film…" value="${esc(viewState.query)}" autocomplete="off" enterkeyhint="search"><div id="results" style="margin-top:14px"></div>`;
  const input = $('#q');
  const results = $('#results');
  let timer;
  const run = async () => {
    const q = input.value.trim();
    viewState.query = q;
    if (q.length < 2) {
      results.innerHTML = '<div class="hint">Tape au moins deux lettres.</div>';
      return;
    }
    results.innerHTML = spinner('Recherche…');
    try {
      const d = await tmdb('search/movie', { query: q, include_adult: 'false' });
      results.innerHTML = d.results.length ? `<div class="grid">${d.results.map((m) => movieCard(m, { showLogos: true })).join('')}</div>` : '<div class="empty"><b>Aucun résultat</b></div>';
      fillLogos(results);
    } catch (e) {
      results.innerHTML = errorBox(e);
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  if (!listLoaded) fetchList().catch(() => {});
  if (viewState.query) run();
  else setTimeout(() => input.focus(), 50);
}

async function renderReglages(view) {
  setTools('');
  view.innerHTML = `
    <form id="me">
      <div class="field"><label for="s-name">Ton prénom</label><input id="s-name" value="${esc(settings.name)}" required></div>
      <div class="field"><label for="s-code">Code famille</label><input id="s-code" value="${esc(settings.familyCode)}" autocomplete="off"></div>
      <button class="btn small">Enregistrer</button>
    </form>

    <h2 class="section-title">Nos plateformes</h2>
    <p class="hint">Touchez les abonnements que vous avez : ils seront mis en avant partout.</p>
    <div id="prov" class="provider-pick">${spinner()}</div>

    <h2 class="section-title">Mes cinémas</h2>
    <p class="hint">Sur <a href="https://www.allocine.fr/salle/" target="_blank" rel="noopener">allocine.fr</a>, ouvre la page de ton cinéma et copie son adresse (elle contient <code>csalle=</code>), puis colle-la ici.</p>
    <form id="add-theater" style="display:grid;gap:8px">
      <input class="search" id="t-url" placeholder="Lien Allociné du cinéma" autocomplete="off">
      <input class="search" id="t-name" placeholder="Nom (ex. Pathé Wilson)" autocomplete="off">
      <button class="btn small">Ajouter ce cinéma</button>
    </form>
    <div id="theaters" class="rows" style="margin-top:12px"></div>

    <h2 class="section-title">Installer sur l'iPhone</h2>
    <p class="hint">Dans Safari, touche le bouton Partager puis « Sur l'écran d'accueil ». L'app s'ouvrira alors en plein écran comme une vraie application.</p>
    <p class="hint" style="margin-top:28px">Données films et plateformes : TMDB et JustWatch. Séances : Allociné.<br>Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.</p>`;

  $('#me').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ name: $('#s-name').value.trim(), familyCode: $('#s-code').value.trim() });
    listLoaded = false;
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
    const all = await loadAllProviders();
    const top = all.slice(0, 40);
    const draw = () => {
      $('#prov').innerHTML = top
        .map(
          (p) => `<button class="${settings.providers.includes(p.provider_id) ? 'on' : ''}" data-prov="${p.provider_id}">
            <img src="${IMG}w92${p.logo_path}" alt=""><span>${esc(p.provider_name)}</span></button>`,
        )
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

// ---------- Fiche film ----------

const sheet = $('#sheet');
let openMovieId = null;

function closeSheet() {
  sheet.hidden = true;
  openMovieId = null;
  document.body.style.overflow = '';
  if (location.hash.startsWith('#film-')) history.replaceState(null, '', location.pathname);
}

async function openMovie(id) {
  openMovieId = id;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  history.replaceState(null, '', `#film-${id}`);
  const content = $('#sheet-content');
  content.innerHTML = spinner();
  $('.sheet-panel').scrollTop = 0;
  try {
    const m = await tmdb(`movie/${id}`, { append_to_response: 'credits,videos,release_dates,watch/providers,recommendations' });
    if (openMovieId !== id) return;
    content.innerHTML = detailHtml(m);
    wireDetail(content, m);
  } catch (e) {
    content.innerHTML = `<div style="padding:60px 16px">${errorBox(e)}</div>`;
  }
}

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

function detailHtml(m) {
  const saved = inList(m.id);
  const rel = frRelease(m);
  const fr = m['watch/providers']?.results?.FR;
  const mine = new Set(settings.providers);
  const directors = (m.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const writers = [...new Set((m.credits?.crew || []).filter((c) => c.department === 'Writing').map((c) => c.name))].slice(0, 3);
  const composer = (m.credits?.crew || []).find((c) => c.job === 'Original Music Composer')?.name;
  const cast = (m.credits?.cast || []).slice(0, 12);
  const trailer =
    (m.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.iso_639_1 === 'fr') ||
    (m.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const theatrical = rel.theatrical || m.release_date;
  const inCinema = nowPlayingIds.has(m.id) || (theatrical && theatrical <= today() && Date.now() - new Date(theatrical) < 1000 * 60 * 60 * 24 * 70);
  const soonCinema = isFuture(theatrical);
  const hasStreaming = fr && (fr.flatrate || fr.rent || fr.buy || fr.free || fr.ads);
  const runtime = m.runtime ? `${Math.floor(m.runtime / 60)} h ${String(m.runtime % 60).padStart(2, '0')}` : '';
  const names = familyNames();

  return `
    <div class="hero" style="${m.backdrop_path ? `background-image:url('${IMG}w780${m.backdrop_path}')` : ''}"></div>
    <div class="detail-head">
      ${posterImg(m.poster_path, m.title)}
      <div>
        <h2>${esc(m.title)}</h2>
        ${m.original_title && m.original_title !== m.title ? `<div class="orig">${esc(m.original_title)}</div>` : ''}
        <div class="hint">${esc(year(m.release_date))}${runtime ? ` · ${runtime}` : ''}</div>
      </div>
    </div>
    <div class="detail-body">
      <div class="facts">
        ${rel.cert ? `<span class="fact age">${esc(certLabel(rel.cert))}</span>` : ''}
        ${m.vote_average ? `<span class="fact">★ ${m.vote_average.toFixed(1)}/10 <span class="hint">(${m.vote_count} votes)</span></span>` : ''}
        ${(m.genres || []).map((g) => `<span class="fact">${esc(g.name)}</span>`).join('')}
        ${inCinema ? '<span class="fact age">Au cinéma</span>' : ''}
      </div>
      ${m.tagline ? `<p class="hint"><i>${esc(m.tagline)}</i></p>` : ''}

      <div class="btn-row" style="margin:12px 0">
        ${
          saved
            ? `<button class="btn ghost" data-act="seen">${saved.status === 'seen' ? '↺ Remettre à voir' : '✓ On l’a vu'}</button>
               <button class="btn danger" data-act="remove">Retirer</button>`
            : '<button class="btn" data-act="add">★ Ajouter à notre liste</button>'
        }
        ${trailer ? `<a class="btn ghost" href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">▶ Bande-annonce</a>` : ''}
      </div>

      ${
        saved
          ? `<div class="box"><h3>Qui veut le voir ?</h3><div class="people">${names
              .map((n) => `<button class="person ${(saved.wants || []).includes(n) ? 'on' : ''}" data-want="${esc(n)}">${avatar(n)}${esc(n)}</button>`)
              .join('')}</div>
              ${n2(saved)}
              <div class="field" style="margin:12px 0 0"><label for="note">Petite note</label><textarea id="note" rows="2" placeholder="Ex. à voir avec les filles, en VO…">${esc(saved.note || '')}</textarea></div>
            </div>`
          : ''
      }

      <div class="box"><h3>Où le voir en streaming</h3>${
        hasStreaming
          ? providerGroup('Inclus dans l’abonnement', fr.flatrate, mine) +
            providerGroup('Gratuit', [...(fr.free || []), ...(fr.ads || [])], mine) +
            providerGroup('Location', fr.rent, mine) +
            providerGroup('Achat', fr.buy, mine) +
            (fr.link ? `<a class="hint" href="${esc(fr.link)}" target="_blank" rel="noopener">Détails et liens sur JustWatch ↗</a>` : '')
          : `<div class="hint">Pas encore disponible en streaming en France.${rel.digital ? ` Sortie en VOD prévue le ${esc(fmtDate(rel.digital))}.` : ''}</div>`
      }</div>

      <div class="box" id="cine-box"><h3>Au cinéma</h3>${
        soonCinema
          ? `<div>Sortie en salles le <b>${esc(fmtDate(theatrical))}</b>.</div>`
          : theatrical
            ? `<div class="hint">Sorti en salles le ${esc(fmtDate(theatrical))}.</div>`
            : ''
      }
        <div id="seances"></div>
        <a class="hint" href="${esc(allocineSearch(m.title))}" target="_blank" rel="noopener">Toutes les séances sur Allociné ↗</a>
      </div>

      <div class="box"><h3>Synopsis</h3><div>${esc(m.overview || 'Pas de synopsis en français.')}</div></div>

      <div class="box"><h3>Équipe</h3>
        ${directors.length ? `<div><span class="hint">Réalisation</span> ${esc(directors.join(', '))}</div>` : ''}
        ${writers.length ? `<div><span class="hint">Scénario</span> ${esc(writers.join(', '))}</div>` : ''}
        ${composer ? `<div><span class="hint">Musique</span> ${esc(composer)}</div>` : ''}
        ${
          cast.length
            ? `<div class="cast" style="margin-top:10px">${cast
                .map(
                  (c) => `<div>${c.profile_path ? `<img loading="lazy" src="${IMG}w185${c.profile_path}" alt="">` : '<div class="ph"></div>'}<b>${esc(c.name)}</b>${esc(c.character || '')}</div>`,
                )
                .join('')}</div>`
            : ''
        }
      </div>

      <div class="box"><h3>Infos</h3>
        ${theatrical ? `<div><span class="hint">Sortie salles (FR)</span> ${esc(fmtDate(theatrical))}</div>` : ''}
        ${rel.digital ? `<div><span class="hint">Sortie VOD (FR)</span> ${esc(fmtDate(rel.digital))}</div>` : ''}
        ${rel.physical ? `<div><span class="hint">DVD / Blu-ray</span> ${esc(fmtDate(rel.physical))}</div>` : ''}
        ${m.production_countries?.length ? `<div><span class="hint">Pays</span> ${esc(m.production_countries.map((c) => c.name).join(', '))}</div>` : ''}
        ${m.budget ? `<div><span class="hint">Budget</span> ${(m.budget / 1e6).toFixed(0)} M$</div>` : ''}
        ${m.revenue ? `<div><span class="hint">Box-office</span> ${(m.revenue / 1e6).toFixed(0)} M$</div>` : ''}
        ${m.imdb_id ? `<div><a href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">IMDb ↗</a> · <a href="https://www.themoviedb.org/movie/${m.id}" target="_blank" rel="noopener">TMDB ↗</a></div>` : ''}
      </div>

      ${
        m.recommendations?.results?.length
          ? `<h2 class="section-title">Dans le même genre</h2><div class="hscroll">${m.recommendations.results.slice(0, 12).map((r) => movieCard(r)).join('')}</div>`
          : ''
      }
    </div>`;
}

// Notes après visionnage.
function n2(saved) {
  if (saved.status !== 'seen') return '';
  const my = saved.ratings?.[settings.name] || 0;
  const others = Object.entries(saved.ratings || {}).filter(([n]) => n !== settings.name);
  return `<div style="margin-top:12px"><div class="hint">Ta note</div><div class="stars">${[1, 2, 3, 4, 5]
    .map((v) => `<button class="${v <= my ? 'on' : ''}" data-rate="${v}" aria-label="${v} étoiles">★</button>`)
    .join('')}</div>${others.length ? `<div class="hint">${others.map(([n, v]) => `${esc(n)} : ${'★'.repeat(v)}`).join(' · ')}</div>` : ''}</div>`;
}

function wireDetail(content, m) {
  const refresh = () => {
    content.innerHTML = detailHtml(m);
    wireDetail(content, m);
    if (currentTab === 'liste') render();
  };
  content.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.act === 'add') {
        await listAction({ action: 'add', movie: m });
        toast('Ajouté à votre liste');
        refresh();
      } else if (b.dataset.act === 'remove') {
        if (!confirm(`Retirer « ${m.title} » de la liste ?`)) return;
        await listAction({ action: 'remove', movieId: m.id });
        toast('Retiré');
        refresh();
      } else if (b.dataset.act === 'seen') {
        const seen = inList(m.id)?.status === 'seen';
        await listAction({ action: 'setStatus', movieId: m.id, status: seen ? 'todo' : 'seen' });
        toast(seen ? 'Remis dans « À voir »' : 'Marqué comme vu');
        refresh();
      } else if (b.dataset.want) {
        await listAction({ action: 'toggleWant', movieId: m.id, by: b.dataset.want });
        refresh();
      } else if (b.dataset.rate) {
        const v = Number(b.dataset.rate);
        await listAction({ action: 'rate', movieId: m.id, value: inList(m.id)?.ratings?.[settings.name] === v ? 0 : v });
        refresh();
      }
    } catch (err) {
      toast(err.message);
    }
  };
  const note = $('#note', content);
  if (note) note.addEventListener('change', () => listAction({ action: 'note', movieId: m.id, note: note.value }).then(() => toast('Note enregistrée')).catch((err) => toast(err.message)));
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
  const days = nextDays(7);
  box.innerHTML = `<div class="days" style="margin-top:8px">${days.map((d) => `<button class="chip ${d.iso === day ? 'on' : ''}" data-sday="${d.iso}">${esc(d.label)}</button>`).join('')}</div><div id="seances-list">${spinner('Recherche des séances…')}</div>`;
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
          .map(
            (r) => `<div class="theater"><div class="name">${esc(r.t.name || r.d.theaterName || r.t.id)}<a class="hint" href="${esc(r.d.url)}" target="_blank" rel="noopener">↗</a></div>
              <div class="times">${r.movie.showtimes.map(timeChip).join('')}</div></div>`,
          )
          .join('')
      : `<p class="hint">Aucune séance ce jour-là dans tes cinémas.</p>`) +
    (failed.length ? `<p class="hint">Séances indisponibles pour ${esc(failed.map((r) => r.t.name || r.t.id).join(', '))} (Allociné ne répond pas).</p>` : '');
}

// ---------- Navigation ----------

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    currentTab = tab.dataset.tab;
    window.scrollTo(0, 0);
    render();
    return;
  }
  const go = e.target.closest('[data-goto]');
  if (go) {
    currentTab = go.dataset.goto;
    render();
    return;
  }
  if (e.target.closest('[data-close]')) return closeSheet();
  const card = e.target.closest('[data-movie]');
  if (card) return openMovie(Number(card.dataset.movie));
  const find = e.target.closest('[data-find]');
  if (find) {
    try {
      const d = await tmdb('search/movie', { query: find.dataset.find });
      const best = d.results.find((r) => nowPlayingIds.has(r.id)) || d.results[0];
      if (best) openMovie(best.id);
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
  if (document.visibilityState === 'visible' && currentTab === 'liste' && settings.name) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

loadNowPlaying();
render();
const hashFilm = location.hash.match(/^#film-(\d+)$/);
if (hashFilm && settings.name) openMovie(Number(hashFilm[1]));

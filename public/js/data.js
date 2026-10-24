// Accès aux données : réglages locaux, TMDB, liste partagée, séances, SensCritique.

import { applyAction } from './list-actions.js';

export const IMG = 'https://image.tmdb.org/t/p/';

// ---------- Réglages (gardés sur le téléphone) ----------

const DEFAULT_SETTINGS = { name: '', familyCode: '', providers: [], theaters: [], theme: 'auto' };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export let settings = loadSettings();
export function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch {}
}

// ---------- TMDB ----------

const memo = new Map();
export function tmdb(path, params = {}) {
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

export async function pages(path, params = {}, count = 2) {
  const res = await Promise.all(Array.from({ length: count }, (_, k) => tmdb(path, { ...params, page: k + 1 }).catch(() => ({ results: [] }))));
  const seen = new Set();
  return res.flatMap((r) => r.results || []).filter((m) => !seen.has(m.id) && seen.add(m.id));
}

// Fiche complète d'un film (une seule requête, partagée par toutes les vues).
export const movieDetails = (id) => tmdb(`movie/${id}`, { append_to_response: 'credits,videos,release_dates,watch/providers,recommendations,keywords' });

let genreMap = null;
export async function genres() {
  if (!genreMap) {
    const d = await tmdb('genre/movie/list');
    genreMap = new Map(d.genres.map((g) => [g.id, g.name]));
  }
  return genreMap;
}

// Films à l'affiche en France, pour les badges « Au ciné ».
export let nowPlayingIds = new Set();
export async function loadNowPlaying() {
  // TMDB range dans « à l'affiche » des films qui sortent dans les jours qui viennent : on les garde pour « Prochainement ».
  const today = new Date().toISOString().slice(0, 10);
  const movies = (await pages('movie/now_playing', {}, 3)).filter((m) => !m.release_date || m.release_date <= today);
  nowPlayingIds = new Set(movies.map((m) => m.id));
  return movies;
}

// Plateformes d'un film en France.
const providerCache = new Map();
export function providersFor(id) {
  if (!providerCache.has(id)) {
    providerCache.set(id, tmdb(`movie/${id}/watch/providers`).then((d) => d.results?.FR || null).catch(() => null));
  }
  return providerCache.get(id);
}

let allProviders = null;
export async function loadAllProviders() {
  if (!allProviders) {
    const d = await tmdb('watch/providers/movie', { watch_region: 'FR' });
    allProviders = d.results.sort((a, b) => (a.display_priorities?.FR ?? a.display_priority) - (b.display_priorities?.FR ?? b.display_priority));
  }
  return allProviders;
}

const keywordIds = new Map();
export function keywordId(query) {
  if (!keywordIds.has(query)) {
    keywordIds.set(
      query,
      tmdb('search/keyword', { query }).then((d) => {
        const exact = d.results.find((k) => k.name.toLowerCase() === query.toLowerCase());
        return (exact || d.results[0])?.id || null;
      }),
    );
  }
  return keywordIds.get(query);
}

// ---------- Liste partagée ----------

export let list = { items: [] };
export let listLoaded = false;

export async function fetchList() {
  const r = await fetch('/api/list', { headers: { 'x-family-code': settings.familyCode } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  list = data;
  listLoaded = true;
  return list;
}

// Mise à jour optimiste : l'interface change tout de suite, le serveur confirme ensuite.
export async function listAction(body, onSettled) {
  const full = { by: settings.name, ...body };
  const before = list;
  try {
    list = applyAction(list, full);
  } catch {}
  const p = sendAction(full).then(
    (data) => {
      list = data;
      onSettled?.();
      return list;
    },
    (e) => {
      list = before;
      onSettled?.(e);
      throw e;
    },
  );
  return onSettled ? list : p;
}

async function sendAction(body) {
  const r = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-family-code': settings.familyCode },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

export const inList = (id) => list.items.find((i) => i.id === id);
export function resetList() {
  listLoaded = false;
}

// ---------- Séances (Allociné) ----------

const seancesCache = new Map();
export function seances(theaterId, date) {
  const key = `${theaterId}|${date}`;
  if (!seancesCache.has(key)) {
    const p = fetch(`/api/seances?theater=${encodeURIComponent(theaterId)}&date=${date}`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw Object.assign(new Error(data.error || `Erreur ${r.status}`), { data });
      return data;
    });
    seancesCache.set(key, p);
    p.catch(() => seancesCache.delete(key));
  }
  return seancesCache.get(key);
}

// ---------- SensCritique ----------

const scCache = new Map();
export function senscritique(m) {
  if (!scCache.has(m.id)) {
    const qs = new URLSearchParams({ title: m.title, original: m.original_title || '', year: (m.release_date || '').slice(0, 4) });
    scCache.set(m.id, fetch(`/api/senscritique?${qs}`).then((r) => r.json()).catch(() => ({ rating: null })));
  }
  return scCache.get(m.id);
}

// ---------- Récompenses (Wikidata) ----------

const awardsCache = new Map();
// Durée d'un film (les listes TMDB ne la donnent pas) : 6 requêtes à la fois au plus.
const runtimeCache = new Map();
const rtQueue = [];
let rtActive = 0;
function rtNext() {
  while (rtActive < 6 && rtQueue.length) {
    const { id, resolve } = rtQueue.shift();
    rtActive += 1;
    tmdb(`movie/${id}`)
      .then((d) => d.runtime || null, () => null)
      .then((v) => {
        rtActive -= 1;
        resolve(v);
        rtNext();
      });
  }
}
export function runtimeOf(m) {
  if (m?.runtime) return Promise.resolve(m.runtime);
  if (!runtimeCache.has(m.id)) {
    runtimeCache.set(m.id, new Promise((resolve) => rtQueue.push({ id: m.id, resolve })));
    rtNext();
  }
  return runtimeCache.get(m.id);
}

const pressCache = new Map();
export function critiques(m) {
  if (!pressCache.has(m.id)) {
    const qs = new URLSearchParams({ title: m.title, original: m.original_title || '', year: (m.release_date || '').slice(0, 4) });
    pressCache.set(m.id, fetch(`/api/critiques?${qs}`).then((r) => r.json()).catch(() => ({ reviews: [] })));
  }
  return pressCache.get(m.id);
}

export function awards(fest, year) {
  const key = `${fest}|${year}`;
  if (!awardsCache.has(key)) {
    const p = fetch(`/api/awards?fest=${fest}&year=${year}`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
      return data;
    });
    awardsCache.set(key, p);
    p.catch(() => awardsCache.delete(key));
  }
  return awardsCache.get(key);
}

// Moteur de recommandations : un profil de goûts construit à partir de la liste
// (envies, films vus et leurs notes, films écartés), puis un score pour chaque candidat.

import { movieDetails } from './data.js';

// Poids d'un film de la liste : positif s'il plaît, négatif s'il a déçu ou été écarté.
export function seedWeight(item) {
  if (item.status === 'hidden') return -2;
  const ratings = Object.values(item.ratings || {});
  if (item.status === 'seen') {
    if (!ratings.length) return 1.5;
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg >= 4) return 3 + (avg - 4) * 2;
    if (avg >= 3) return 1;
    return -2.5;
  }
  return 1 + 0.4 * Math.max(0, (item.wants || []).length - 1);
}

// Pas de recommandations de films sortis avant 2010 (les films sans date sont écartés aussi).
export const RECO_MIN_DATE = '2010-01-01';
export const isRecent = (m) => (m.release_date || '') >= RECO_MIN_DATE;

let cached = { key: '', profile: null };

export async function buildProfile(items) {
  const key = JSON.stringify(items.map((i) => [i.id, i.status, i.ratings, (i.wants || []).length]));
  if (cached.key === key) return cached.profile;

  const seeds = items
    .map((i) => ({ item: i, w: seedWeight(i) }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 18);
  const details = await Promise.all(seeds.map((s) => movieDetails(s.item.id).catch(() => null)));

  const profile = { genres: new Map(), keywords: new Map(), people: new Map(), candidates: new Map(), exclude: new Set(items.map((i) => i.id)), size: seeds.length, liked: [] };
  const add = (map, id, name, w, extra = {}) => {
    const cur = map.get(id) || { id, name, score: 0, ...extra };
    cur.score += w;
    map.set(id, cur);
  };

  seeds.forEach(({ item, w }, k) => {
    const d = details[k];
    if (!d) return;
    if (w >= 2) profile.liked.push({ id: d.id, title: d.title, w });
    for (const g of d.genres || []) add(profile.genres, g.id, g.name, w);
    for (const kw of (d.keywords?.keywords || []).slice(0, 15)) add(profile.keywords, kw.id, kw.name, w * 0.6);
    for (const c of (d.credits?.crew || []).filter((c) => c.job === 'Director')) add(profile.people, c.id, c.name, w * 2.5, { role: 'director' });
    for (const c of (d.credits?.cast || []).slice(0, 5)) add(profile.people, c.id, c.name, w, { role: 'cast' });
    if (w > 0) {
      (d.recommendations?.results || []).slice(0, 20).forEach((m, rank) => {
        if (profile.exclude.has(m.id) || !isRecent(m)) return;
        const cur = profile.candidates.get(m.id) || { movie: m, score: 0, because: [] };
        cur.score += w * (1 - rank / 30);
        if (cur.because.length < 2) cur.because.push(d.title);
        profile.candidates.set(m.id, cur);
      });
    }
  });
  profile.liked.sort((a, b) => b.w - a.w);
  cached = { key, profile };
  return profile;
}

export const topEntries = (map, n, min = 0.5) =>
  [...map.values()]
    .filter((e) => e.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

// Score rapide à partir des genres, de la popularité et des recommandations TMDB.
export function quickScore(m, profile) {
  const maxG = Math.max(1, ...[...profile.genres.values()].map((g) => g.score));
  let genreScore = 0;
  let bestGenre = null;
  for (const id of m.genre_ids || (m.genres || []).map((g) => g.id)) {
    const g = profile.genres.get(id);
    if (!g) continue;
    genreScore += g.score / maxG;
    if (g.score > 0 && (!bestGenre || g.score > bestGenre.score)) bestGenre = g;
  }
  const cand = profile.candidates.get(m.id);
  const score = genreScore + (cand ? 1.5 + cand.score / 4 : 0) + (m.vote_average || 0) / 20 + Math.min(1, (m.popularity || 0) / 200) * 0.3;
  const why = cand ? `Comme ${cand.because[0]}` : bestGenre ? `Vous aimez : ${bestGenre.name.toLowerCase()}` : '';
  return { score, why };
}

// Score fin : ajoute réalisateurs, acteurs et thèmes en commun (demande la fiche complète).
export async function deepRank(movies, profile, { limit = 12, deep = 18 } = {}) {
  const ranked = movies
    .filter((m) => !profile.exclude.has(m.id) && isRecent(m))
    .map((m) => ({ m, ...quickScore(m, profile) }))
    .sort((a, b) => b.score - a.score);
  const head = ranked.slice(0, deep);
  const details = await Promise.all(head.map((r) => movieDetails(r.m.id).catch(() => null)));
  head.forEach((r, k) => {
    const d = details[k];
    if (!d) return;
    let best = null;
    for (const c of (d.credits?.crew || []).filter((c) => c.job === 'Director')) {
      const p = profile.people.get(c.id);
      if (p && p.score > 0) {
        r.score += p.score / 3;
        if (!best || p.score > best.s) best = { s: p.score, why: `Réalisé par ${c.name}` };
      }
    }
    for (const c of (d.credits?.cast || []).slice(0, 8)) {
      const p = profile.people.get(c.id);
      if (p && p.score > 0) {
        r.score += p.score / 5;
        if (!best || p.score / 2 > best.s) best = { s: p.score / 2, why: `Avec ${c.name}` };
      }
    }
    let kwScore = 0;
    let bestKw = null;
    for (const kw of d.keywords?.keywords || []) {
      const p = profile.keywords.get(kw.id);
      if (!p) continue;
      kwScore += p.score;
      if (p.score > 0 && (!bestKw || p.score > bestKw.score)) bestKw = p;
    }
    r.score += Math.max(-2, Math.min(3, kwScore / 4));
    if (best) r.why = best.why;
    else if (bestKw && !r.why.startsWith('Comme')) r.why = `Thème : ${bestKw.name}`;
  });
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ ...r.m, _why: r.why }));
}

export async function recommendationsFrom(profile, limit = 20) {
  return [...profile.candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ ...c.movie, _why: `Comme ${c.because.join(' et ')}` }));
}


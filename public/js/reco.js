// Moteur de recommandations.
// 1. Chaque film de la liste devient un signal : les notes (centrées sur la moyenne de la famille, donc un 2/5 compte
//    contre), les envies, les films vus sans note et les « pas pour nous ».
// 2. On en tire un profil de goût sur tous ces films : genres, réalisateurs, acteurs, thèmes, époques, langues.
//    Chaque trait est une moyenne « prudente » (un trait vu sur un seul film pèse peu, un trait qui revient pèse plus).
// 3. Les candidats viennent de plusieurs sources : les recommandations TMDB d'une trentaine de films aimés (pas
//    seulement les deux mieux notés) et des recherches par réalisateurs, thèmes et genres préférés.
// 4. Chaque candidat est noté sur sa ressemblance au profil, l'accord entre sources et sa qualité, puis la liste
//    est diversifiée : pas plus de deux films grâce au même film aimé, au même réalisateur, peu de répétitions de genre.

import { movieDetails, tmdb } from './data.js';

// Pas de recommandations de films sortis avant 2010 (les films sans date sont écartés aussi).
export const RECO_MIN_DATE = '2010-01-01';
export const isRecent = (m) => (m.release_date || '') >= RECO_MIN_DATE;

// ---------- Signaux de la liste ----------

const avgOf = (r) => {
  const v = Object.values(r || {}).filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Moyenne des notes de la famille : un 3,5 n'a pas le même sens chez qui met 4 partout.
export function familyMean(items) {
  const avgs = items.map((i) => avgOf(i.ratings)).filter((x) => x !== null);
  if (avgs.length < 5) return 3.2;
  const m = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  return Math.min(4, Math.max(2.5, m));
}

// Poids d'un film de la liste : positif s'il plaît, négatif s'il a déçu ou été écarté.
export function itemWeight(item, mean = 3.2) {
  if (item.status === 'hidden') return -1.2;
  const avg = avgOf(item.ratings);
  if (avg !== null) return Math.max(-2.5, Math.min(2.5, 1.2 * (avg - mean) + 0.25));
  if (item.status === 'seen') return 0.3;
  return 0.5 + 0.2 * Math.max(0, (item.wants || []).length - 1);
}
// Ancien nom, gardé pour les autres écrans.
export const seedWeight = (item) => itemWeight(item);

// ---------- Traits d'un film ----------

// Version compacte d'une fiche TMDB : de quoi comparer deux films sans garder toute la fiche.
export function featuresOf(d) {
  const year = Number(String(d.release_date || '').slice(0, 4)) || null;
  return {
    t: d.title,
    g: (d.genres || []).map((g) => [g.id, g.name]),
    k: (d.keywords?.keywords || []).slice(0, 12).map((k) => [k.id, k.name]),
    d: (d.credits?.crew || []).filter((c) => c.job === 'Director').slice(0, 2).map((c) => [c.id, c.name]),
    a: (d.credits?.cast || []).slice(0, 6).map((c) => [c.id, c.name]),
    e: year ? Math.floor(year / 5) * 5 : null,
    l: d.original_language || null,
    b: Math.round((d.budget || 0) / 1e6),
    c: d.belongs_to_collection?.id || null,
    v: d.vote_count || 0,
  };
}

// Blockbusters : gros budget, ou grande saga d'action, d'aventure, de science-fiction ou de fantastique.
// La famille les a vus mais n'en veut pas en recommandation, ni comme point de départ.
const SPECTACLE = new Set([28, 12, 878, 14]);
export function isBlockbuster(f, m = {}) {
  const genres = f ? f.g.map((g) => g[0]) : m.genre_ids || [];
  const spectacle = genres.some((g) => SPECTACLE.has(g));
  if (!f) return spectacle && (m.vote_count || 0) >= 12000;
  if (f.b >= 90) return true;
  if (f.c && (f.b >= 40 || (spectacle && f.v >= 5000))) return true;
  return spectacle && !f.b && f.v >= 15000;
}

// Familles de traits : importance dans le score et façon de les nommer.
const KINDS = {
  g: { w: 1, label: (n) => `Vous aimez : ${n.toLowerCase()}` },
  k: { w: 0.9, label: (n) => `Thème : ${n}` },
  d: { w: 1.6, label: (n) => `Réalisé par ${n}` },
  a: { w: 0.8, label: (n) => `Avec ${n}` },
  e: { w: 0.4, label: () => '' },
  l: { w: 0.5, label: () => '' },
};
const PRIOR = 1.5; // un trait vu sur un seul film compte pour 40 %, sur cinq films pour 77 %

function traits(f) {
  const out = [];
  for (const kind of ['g', 'k', 'd', 'a']) for (const [id, name] of f[kind] || []) out.push({ key: `${kind}${id}`, kind, name });
  if (f.e) out.push({ key: `e${f.e}`, kind: 'e', name: `${f.e}` });
  if (f.l) out.push({ key: `l${f.l}`, kind: 'l', name: f.l });
  return out;
}

// Profil de goût : pour chaque trait, somme des poids, nombre de films et films qui l'ont apporté.
export function buildTaste(entries) {
  const taste = new Map();
  for (const { w, f } of entries) {
    if (!f || !w) continue;
    for (const t of traits(f)) {
      const cur = taste.get(t.key) || { ...t, sum: 0, n: 0, from: [] };
      cur.sum += w;
      cur.n += 1;
      if (w > 0 && cur.from.length < 3) cur.from.push(f.t);
      taste.set(t.key, cur);
    }
  }
  for (const t of taste.values()) t.aff = t.sum / (t.n + PRIOR);
  return taste;
}

// Ressemblance d'un film au profil, et le trait qui l'explique le mieux.
export function contentScore(f, taste) {
  const byKind = {};
  let best = null;
  for (const t of traits(f)) {
    const p = taste.get(t.key);
    if (!p) continue;
    (byKind[t.kind] ||= []).push(p.aff);
    const s = p.aff * KINDS[t.kind].w;
    if (KINDS[t.kind].label(t.name) && p.aff > 0.2 && p.n >= (t.kind === 'g' ? 2 : 1) && (!best || s > best.s)) best = { s, why: KINDS[t.kind].label(p.name) };
  }
  let score = 0;
  for (const [kind, affs] of Object.entries(byKind)) {
    // Moyenne amortie : un film avec beaucoup de mots-clés n'est pas avantagé pour autant.
    score += (KINDS[kind].w * affs.reduce((a, b) => a + b, 0)) / Math.sqrt(Math.max(affs.length, (f[kind] || []).length || 1));
  }
  return { score, why: best?.why || '' };
}

// Qualité : note TMDB pondérée par le nombre de votes (un 8/10 sur 12 votes ne vaut pas un 8/10 sur 5 000).
export const quality = (m) => {
  const v = m.vote_count || 0;
  const q = (v * (m.vote_average || 0) + 300 * 6.4) / (v + 300);
  return (q - 6.4) * 0.5;
};

// ---------- Diversité ----------

// Choix glouton : à chaque tour, le meilleur film une fois pénalisé par ce qui ressemble déjà à la sélection.
export function diversify(scored, limit, { maxPerSeed = 2, maxPerDirector = 2 } = {}) {
  const seedN = new Map();
  const dirN = new Map();
  const genreN = new Map();
  const left = [...scored];
  const out = [];
  while (out.length < limit && left.length) {
    let bestK = -1;
    let bestV = -Infinity;
    left.forEach((r, k) => {
      const seeds = r.seeds || [];
      const dirs = (r.f?.d || []).map((d) => d[0]);
      if (seeds.length && seeds.every((s) => (seedN.get(s) || 0) >= maxPerSeed)) return;
      if (dirs.some((d) => (dirN.get(d) || 0) >= maxPerDirector)) return;
      const g0 = r.f?.g?.[0]?.[0] ?? r.m.genre_ids?.[0];
      const pen = 0.6 * Math.min(...(seeds.length ? seeds.map((s) => seedN.get(s) || 0) : [0])) + 0.35 * (genreN.get(g0) || 0) + 0.8 * dirs.reduce((a, d) => a + (dirN.get(d) || 0), 0);
      const v = r.score - pen;
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    });
    if (bestK === -1) break;
    const [r] = left.splice(bestK, 1);
    out.push(r);
    (r.seeds || []).forEach((s) => seedN.set(s, (seedN.get(s) || 0) + 1));
    (r.f?.d || []).forEach((d) => dirN.set(d[0], (dirN.get(d[0]) || 0) + 1));
    const g0 = r.f?.g?.[0]?.[0] ?? r.m.genre_ids?.[0];
    genreN.set(g0, (genreN.get(g0) || 0) + 1);
  }
  return out;
}

// ---------- Cache des traits (sur le téléphone, pour ne pas relire les fiches à chaque visite) ----------

const FKEY = 'recoFeatures:v2';
let fcache = null;
function featCache() {
  if (fcache) return fcache;
  try {
    fcache = new Map(Object.entries(JSON.parse(localStorage.getItem(FKEY) || '{}')));
  } catch {
    fcache = new Map();
  }
  return fcache;
}
let saveTimer = null;
function saveFeat() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = [...featCache().entries()].slice(-900);
      localStorage.setItem(FKEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }, 500);
}

// Lance au plus `n` requêtes à la fois.
async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (next < list.length) {
        const k = next++;
        out[k] = await fn(list[k]).catch(() => null);
      }
    }),
  );
  return out;
}

async function features(id) {
  const c = featCache();
  if (c.has(String(id))) return c.get(String(id));
  const f = featuresOf(await movieDetails(id));
  c.set(String(id), f);
  saveFeat();
  return f;
}

// ---------- Profil ----------

let cached = { key: '', profile: null };

export async function buildProfile(items) {
  const key = JSON.stringify(items.map((i) => [i.id, i.status, i.ratings, (i.wants || []).length]));
  if (cached.key === key) return cached.profile;

  const mean = familyMean(items);
  // Tous les films notés comptent ; on complète avec les envies et les écartés les plus récents.
  const weighted = items.map((i) => ({ item: i, w: itemWeight(i, mean), rated: avgOf(i.ratings) !== null }));
  const rated = weighted.filter((x) => x.rated);
  const others = weighted.filter((x) => !x.rated).slice(0, Math.max(30, 150 - rated.length));
  const used = [...rated.slice(0, 250), ...others].sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  // Première visite : on lit d'abord les 60 fiches les plus parlantes, les autres se lisent en fond pour la prochaine fois.
  const c = featCache();
  let budget = 60;
  const now = used.filter((x) => c.has(String(x.item.id)) || budget-- > 0);
  const later = used.filter((x) => !now.includes(x));
  const feats = await pool(now, 6, (x) => features(x.item.id));
  if (later.length) setTimeout(() => pool(later, 2, (x) => features(x.item.id)).then(() => (cached = { key: '', profile: null })), 4000);
  // Un blockbuster vu et apprécié ne sert pas de base : seules les déceptions comptent encore.
  const entries = now
    .map((x, k) => ({ id: x.item.id, title: x.item.title, w: x.w, f: feats[k] }))
    .filter((e) => e.f && !(e.w > 0 && isBlockbuster(e.f)));

  const taste = buildTaste(entries);
  const liked = entries
    .filter((e) => e.w >= 0.8)
    .sort((a, b) => b.w - a.w)
    .map((e) => ({ id: e.id, title: e.f.t || e.title, w: e.w }));

  // Compatibilité : genres au format attendu par l'écran d'accueil.
  const genres = new Map([...taste.values()].filter((t) => t.kind === 'g').map((t) => [Number(t.key.slice(1)), { id: Number(t.key.slice(1)), name: t.name, score: t.aff }]));

  const profile = { taste, genres, liked, entries, mean, exclude: new Set(items.map((i) => i.id)), size: entries.length, rated: rated.length, pending: later.length };
  cached = { key, profile };
  return profile;
}

export const topEntries = (map, n, min = 0.1) =>
  [...map.values()]
    .filter((e) => e.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

// Les traits les plus forts du profil, pour l'afficher (« Vous aimez : … »).
export function topTraits(profile, kind, n = 3, minFilms = 2) {
  return [...profile.taste.values()]
    .filter((t) => t.kind === kind && t.n >= minFilms && t.aff > 0.15)
    .sort((a, b) => b.aff - a.aff)
    .slice(0, n);
}

// ---------- Classement ----------

// Score rapide avec ce qu'on sait sans fiche complète (genres, qualité).
function quickScore(m, profile) {
  const f = { g: (m.genre_ids || (m.genres || []).map((g) => g.id)).map((id) => [id, '']), k: [], d: [], a: [] };
  return contentScore(f, profile.taste).score + quality(m);
}

// Classe une liste de films selon le profil. `avoid` : films déjà montrés ailleurs sur la page.
export async function deepRank(movies, profile, { limit = 12, deep = 18, avoid = null, sources = null, noBlockbusters = false } = {}) {
  const seen = new Set();
  let ranked = movies
    .filter((m) => m && !profile.exclude.has(m.id) && isRecent(m) && !avoid?.has(m.id) && !seen.has(m.id) && seen.add(m.id))
    .map((m) => {
      const src = sources?.get(m.id);
      return { m, seeds: src?.seeds || [], collab: src?.collab || 0, score: quickScore(m, profile) + (src?.collab || 0) * 0.8 };
    })
    .sort((a, b) => b.score - a.score);
  const head = ranked.slice(0, deep);
  const feats = await pool(head, 6, (r) => features(r.m.id));
  head.forEach((r, k) => {
    r.f = feats[k];
    if (!r.f) return;
    const c = contentScore(r.f, profile.taste);
    r.score = c.score + quality(r.m) + r.collab * 0.8 + Math.min(1, (r.m.popularity || 0) / 150) * 0.15;
    const titles = r.seeds.map((s) => profile.liked.find((l) => l.id === s)?.title).filter(Boolean);
    const strong = /^(Réalisé par|Avec) /.test(c.why);
    r.why = titles.length >= 2 ? `Comme ${titles[0]} et ${titles[1]}` : strong ? c.why : titles[0] ? `Comme ${titles[0]}` : c.why;
  });
  // Les films sans fiche lue passent après ceux qu'on a vraiment comparés.
  ranked.slice(deep).forEach((r) => (r.score -= 1));
  if (noBlockbusters) ranked = ranked.filter((r) => !isBlockbuster(r.f, r.m));
  return diversify(ranked.sort((a, b) => b.score - a.score), limit).map((r) => ({ ...r.m, _why: r.why || '' }));
}

// Recommandations principales : plusieurs sources de candidats, puis classement et diversité.
export async function recommend(profile, { limit = 30 } = {}) {
  const sources = new Map();
  const pool_ = new Map();
  const addCand = (m, seedId, w) => {
    if (!m || profile.exclude.has(m.id) || !isRecent(m)) return;
    pool_.set(m.id, m);
    const s = sources.get(m.id) || { seeds: [], sum: 0, collab: 0 };
    if (seedId && !s.seeds.includes(seedId)) s.seeds.push(seedId);
    s.sum += w;
    s.collab = Math.log1p(s.sum);
    sources.set(m.id, s);
  };

  // 1. Recommandations TMDB d'un large éventail de films aimés : les mieux notés et une part tirée au hasard,
  //    pour que deux ou trois films ne décident pas de tout.
  const liked = profile.liked;
  const day = Math.floor(Date.now() / 864e5);
  const shuffled = liked.slice(12).map((l, k) => ({ l, r: Math.sin(day * 97 + l.id + k) })).sort((a, b) => a.r - b.r).map((x) => x.l);
  const seeds = [...liked.slice(0, 12), ...shuffled.slice(0, 18)];
  const recs = await pool(seeds, 6, (s) => movieDetails(s.id));
  seeds.forEach((s, k) => {
    // Chaque film aimé pèse selon sa note, mais sa contribution totale est bornée.
    const w = Math.min(1.5, s.w) / 1.5;
    (recs[k]?.recommendations?.results || []).slice(0, 12).forEach((m, rank) => addCand(m, s.id, w * (1 - rank / 18)));
  });

  // 2. Recherches par traits préférés : réalisateurs, thèmes, genres.
  const base = { sort_by: 'vote_average.desc', 'vote_count.gte': 150, 'primary_release_date.gte': RECO_MIN_DATE };
  const dirs = topTraits(profile, 'd', 4, 1);
  const kws = topTraits(profile, 'k', 5, 2);
  const gen = topTraits(profile, 'g', 3, 2);
  const queries = [
    ...dirs.map((d) => ({ ...base, with_crew: d.key.slice(1), 'vote_count.gte': 50 })),
    kws.length ? { ...base, with_keywords: kws.map((k) => k.key.slice(1)).join('|') } : null,
    gen.length >= 2 ? { ...base, with_genres: `${gen[0].key.slice(1)},${gen[1].key.slice(1)}` } : null,
    gen.length ? { ...base, sort_by: 'popularity.desc', with_genres: gen.map((g) => g.key.slice(1)).join('|'), 'vote_count.gte': 300 } : null,
  ].filter(Boolean);
  const found = await pool(queries, 4, (q) => tmdb('discover/movie', q));
  found.forEach((r) => (r?.results || []).slice(0, 15).forEach((m) => addCand(m, null, 0.15)));

  return deepRank([...pool_.values()], profile, { limit, deep: 70, sources, noBlockbusters: true });
}

// Ancien point d'entrée.
export const recommendationsFrom = (profile, limit = 20) => recommend(profile, { limit });

// Films « parce que vous avez aimé » : change de film chaque jour parmi les mieux notés.
export function becauseSeeds(profile, n = 2) {
  const top = profile.liked.slice(0, 10);
  if (top.length <= n) return top;
  const day = Math.floor(Date.now() / 864e5);
  return Array.from({ length: n }, (_, k) => top[(day + k * Math.ceil(top.length / n)) % top.length]);
}

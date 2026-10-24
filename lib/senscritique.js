// Note SensCritique d'un film.
// SensCritique n'a pas d'API publique : on lit les données embarquées dans sa page de recherche
// (__NEXT_DATA__ / JSON-LD), puis la page du film si la note n'y figure pas. Lecture tolérante.

import { normalizeTitle } from './allocine.js';

const BASE = 'https://www.senscritique.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

export const searchUrl = (title) => `${BASE}/search?query=${encodeURIComponent(title)}`;

export function embeddedJson(html) {
  const out = [];
  const re = /<script[^>]*(?:id="__NEXT_DATA__"|type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {}
  }
  return out;
}

// Parcourt n'importe quel JSON et garde les objets qui ressemblent à une fiche film.
export function findProducts(json) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const title = node.title || node.name;
    const url = typeof node.url === 'string' ? node.url : '';
    const isFilm = node.universe === 1 || node.universe === 'movie' || /\/film\//.test(url) || node['@type'] === 'Movie';
    if (typeof title === 'string' && isFilm) {
      const rating = Number(node.rating ?? node.aggregateRating?.ratingValue ?? node.stats?.rating);
      const year = Number(node.yearOfProduction || String(node.dateRelease || node.datePublished || node.dateCreated || '').slice(0, 4)) || null;
      found.push({
        title,
        originalTitle: node.originalTitle || null,
        year,
        rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
        count: Number(node.stats?.ratingCount ?? node.aggregateRating?.ratingCount ?? node.nbRating) || null,
        url: url ? (url.startsWith('http') ? url : BASE + url) : null,
      });
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(json, 0);
  return found;
}

export function bestMatch(products, { title, originalTitle, year }) {
  const targets = new Set([normalizeTitle(title), normalizeTitle(originalTitle)].filter(Boolean));
  const y = Number(year) || null;
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    let score = 0;
    if (targets.has(normalizeTitle(p.title))) score += 3;
    if (p.originalTitle && targets.has(normalizeTitle(p.originalTitle))) score += 3;
    if (!score) continue;
    if (y && p.year) {
      const d = Math.abs(p.year - y);
      if (d > 1) continue;
      score += d === 0 ? 2 : 1;
    }
    if (p.rating) score += 1;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export async function senscritiqueRating(film, fetchImpl = fetch) {
  const r = await fetchImpl(searchUrl(film.title), { headers: HEADERS });
  if (!r.ok) throw new Error(`SensCritique a répondu ${r.status}`);
  const products = embeddedJson(await r.text()).flatMap(findProducts);
  let match = bestMatch(products, film);
  if (match?.url && !match.rating) {
    const page = await fetchImpl(match.url, { headers: HEADERS });
    if (page.ok) {
      const onPage = bestMatch(embeddedJson(await page.text()).flatMap(findProducts), film);
      if (onPage?.rating) match = { ...match, rating: onPage.rating, count: onPage.count || match.count };
    }
  }
  return match ? { ...match, searchUrl: searchUrl(film.title) } : { rating: null, url: null, searchUrl: searchUrl(film.title) };
}

// Critiques presse d'un film, lues sur Allociné (page « Critiques presse »).
// Pas d'API officielle : on retrouve le film via l'autocomplétion du site, puis on lit la page
// en texte brut (titre du journal, « par Auteur », extrait), ce qui résiste aux changements de balisage.

import { normalizeTitle } from './allocine.js';

const BASE = 'https://www.allocine.fr';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

export const pressUrl = (id) => `${BASE}/film/fichefilm-${id}/critiques/presse/`;

// Choisit le bon film parmi les résultats de l'autocomplétion Allociné.
export function pickMovie(json, { title, originalTitle, year }) {
  const targets = new Set([normalizeTitle(title), normalizeTitle(originalTitle)].filter(Boolean));
  const y = Number(year) || null;
  let best = null;
  let bestScore = 0;
  for (const r of json?.results || []) {
    if (r.entity_type !== 'movie') continue;
    let score = 0;
    if (targets.has(normalizeTitle(r.label))) score += 3;
    if (targets.has(normalizeTitle(r.original_label))) score += 3;
    if (!score) continue;
    const ry = Number(r.data?.year) || Number(String(r.data?.first_release || '').slice(0, 4)) || null;
    if (y && ry) {
      const d = Math.abs(ry - y);
      if (d > 1) continue;
      score += d === 0 ? 2 : 1;
    }
    if (score > bestScore) {
      best = Number(r.entity_id || r.data?.id);
      bestScore = score;
    }
  }
  return best;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê' };
const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export function htmlLines(html) {
  return decode(
    String(html)
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h\d|li|ul|section|article|header|footer|a)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Note de chaque critique (classe « n40 » = 4/5), cherchée juste après le nom du journal.
function ratingNear(html, outlet, from) {
  const i = html.indexOf(outlet, from);
  if (i === -1) return { rating: null, at: from };
  const m = html.slice(i, i + 1500).match(/rating-mdl n(\d)(\d)|stareval-note[^>]*>\s*(\d),(\d)/);
  const rating = m ? Number(`${m[1] ?? m[3]}.${m[2] ?? m[4]}`) || null : null;
  return { rating, at: i + outlet.length };
}

export function parsePress(html) {
  const lines = htmlLines(html);
  const avg = lines.join('\n').match(/Note moyenne\s+(\d(?:,\d)?)/);
  const average = avg ? Number(avg[1].replace(',', '.')) || null : null;
  let start = lines.findIndex((l) => /^\d+ critiques? presse$/i.test(l));
  start = start === -1 ? 0 : start + 1;
  const end = (() => {
    const e = lines.findIndex((l, n) => n > start && /^Les meilleurs films|^Back to Top|^Retour en haut/i.test(l));
    return e === -1 ? lines.length : e;
  })();
  const authorAt = [];
  for (let n = start + 1; n < end; n++) if (/^par( |$)/i.test(lines[n])) authorAt.push(n);
  const reviews = [];
  let cursor = Math.max(0, String(html).search(/\d+ critiques? presse/i));
  authorAt.forEach((n, j) => {
    const outlet = lines[n - 1];
    const stop = j + 1 < authorAt.length ? authorAt[j + 1] - 1 : end;
    // « par » peut être seul sur sa ligne, l'auteur sur la suivante.
    const lone = /^par$/i.test(lines[n]);
    const author = lone ? lines[n + 1] || '' : lines[n].replace(/^par /i, '');
    const quote = lines
      .slice(n + (lone ? 2 : 1), stop)
      .filter((l) => !/^La critique complète est disponible/i.test(l) && l !== outlet)
      .join(' ')
      .trim();
    if (!outlet || !quote) return;
    const { rating, at } = ratingNear(html, outlet, cursor);
    cursor = at;
    reviews.push({ outlet, author, quote: quote.length > 600 ? `${quote.slice(0, 597)}…` : quote, rating });
  });
  return { average, reviews };
}

export async function pressReviews({ title, originalTitle, year }, fetchImpl = fetch) {
  let id = null;
  for (const q of [...new Set([title, originalTitle].filter(Boolean))]) {
    const r = await fetchImpl(`${BASE}/_/autocomplete/${encodeURIComponent(q)}`, { headers: { ...HEADERS, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Allociné indisponible (${r.status})`);
    id = pickMovie(await r.json(), { title, originalTitle, year });
    if (id) break;
  }
  if (!id) return { allocineId: null, url: null, average: null, reviews: [] };
  const r = await fetchImpl(pressUrl(id), { headers: { ...HEADERS, Accept: 'text/html' } });
  if (r.status === 404) return { allocineId: id, url: pressUrl(id), average: null, reviews: [] };
  if (!r.ok) throw new Error(`Allociné indisponible (${r.status})`);
  return { allocineId: id, url: pressUrl(id), ...parsePress(await r.text()) };
}

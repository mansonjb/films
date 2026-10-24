// Lecture des séances d'un cinéma sur Allociné.
// Il n'existe pas d'API officielle : on lit l'endpoint JSON utilisé par le site allocine.fr.
// Le format peut changer sans prévenir, d'où une lecture très tolérante.

const BASE = 'https://www.allocine.fr';

export function theaterIdFrom(input) {
  const s = String(input || '').trim();
  const m = s.match(/csalle=([A-Z0-9]+)/i) || s.match(/theater-([A-Z0-9]+)/i) || s.match(/^([A-Z][A-Z0-9]{3,6})$/i);
  return m ? m[1].toUpperCase() : null;
}

export const theaterUrl = (id) => `${BASE}/seance/salle_gen_csalle=${id}.html`;
export const movieUrl = (id) => `${BASE}/film/fichefilm_gen_cfilm=${id}.html`;

function flattenShowtimes(showtimes) {
  if (!showtimes) return [];
  if (Array.isArray(showtimes)) return showtimes;
  return Object.values(showtimes).flatMap((v) => (Array.isArray(v) ? v : []));
}

const VERSION_LABELS = { ORIGINAL: 'VO', LOCAL: 'VF', DUBBED: 'VF', MULTIPLE: 'VF' };

export function parseShowtime(s) {
  const startsAt = s.startsAt || s.startDate || s.time;
  if (!startsAt) return null;
  const time = String(startsAt).slice(11, 16);
  const version = VERSION_LABELS[String(s.diffusionVersion || '').toUpperCase()] || (s.diffusionVersion ? String(s.diffusionVersion) : '');
  const tags = [...(s.projection || []), ...(s.experience ? [].concat(s.experience) : []), ...(s.format ? [].concat(s.format) : [])]
    .map((t) => (typeof t === 'string' ? t : t?.label || t?.name))
    .filter((t) => t && !/^DIGITAL$/i.test(t));
  return { startsAt, time, version, tags, bookingUrl: s.data?.ticketing?.[0]?.urls?.[0] || s.ticketing?.[0]?.urls?.[0] || null };
}

export function parseTheaterDay(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  const movies = results
    .map((r) => {
      const m = r.movie || {};
      const showtimes = flattenShowtimes(r.showtimes).map(parseShowtime).filter(Boolean).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return {
        allocineId: m.internalId || m.id || null,
        title: m.title || '',
        originalTitle: m.originalTitle || m.title || '',
        url: m.internalId ? movieUrl(m.internalId) : null,
        showtimes,
      };
    })
    .filter((m) => m.title && m.showtimes.length);
  const t = json?.theater || results[0]?.theater || {};
  const page = json?.pagination?.page || 1;
  const totalPages = json?.pagination?.totalPages || 1;
  return { theaterName: t.name || null, movies, page, totalPages };
}

export async function fetchTheaterDay(theaterId, date, fetchImpl = fetch) {
  const movies = [];
  let theaterName = null;
  for (let page = 1; page <= 5; page++) {
    const url = `${BASE}/_/showtimes/theater-${theaterId}/d-${date}/${page > 1 ? `p-${page}/` : ''}`;
    const r = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    if (!r.ok) throw new Error(`Allociné a répondu ${r.status}`);
    const parsed = parseTheaterDay(await r.json());
    theaterName ||= parsed.theaterName;
    movies.push(...parsed.movies);
    if (parsed.page >= parsed.totalPages) break;
  }
  return { theaterId, date, theaterName, url: theaterUrl(theaterId), movies };
}

export function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'et')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

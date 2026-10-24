// Palmarès d'un festival : /api/awards?fest=cannes&year=2025
import { sendJson, getQuery } from '../lib/http.js';
import { FESTIVALS, festivalYear } from '../lib/awards.js';
import { tmdbFetch } from '../lib/tmdb.js';

const FIELDS = ['id', 'title', 'original_title', 'poster_path', 'backdrop_path', 'release_date', 'vote_average', 'genre_ids', 'overview', 'popularity'];

export default async function handler(req, res) {
  const { fest = 'cannes', year } = getQuery(req);
  const y = Number(year) || new Date().getFullYear();
  if (!FESTIVALS[fest]) return sendJson(res, 400, { error: 'Festival inconnu' });
  try {
    const { winners, selection } = await festivalYear(fest, y);
    const ids = [...new Set([...winners.map((w) => w.tmdb), ...selection])].slice(0, 60);
    const details = await Promise.all(
      ids.map((id) =>
        tmdbFetch(`movie/${id}`)
          .then((r) => (r.ok ? Object.fromEntries(FIELDS.map((f) => [f, f === 'genre_ids' ? (r.data.genres || []).map((g) => g.id) : r.data[f]])) : null))
          .catch(() => null),
      ),
    );
    const byId = new Map(details.filter(Boolean).map((m) => [m.id, m]));
    sendJson(
      res,
      200,
      {
        festival: FESTIVALS[fest].name,
        selectionLabel: FESTIVALS[fest].selection,
        year: y,
        winners: winners.filter((w) => byId.has(w.tmdb)).map((w) => ({ ...byId.get(w.tmdb), _award: w.award })),
        selection: selection.filter((id) => byId.has(id)).map((id) => byId.get(id)),
      },
      86400,
    );
  } catch (e) {
    sendJson(res, 502, { error: e.message }, 0);
  }
}

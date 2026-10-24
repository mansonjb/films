// Note SensCritique : /api/senscritique?title=Dune&original=Dune&year=2021
import { sendJson, getQuery } from '../lib/http.js';
import { senscritiqueRating, searchUrl } from '../lib/senscritique.js';

export default async function handler(req, res) {
  const q = getQuery(req);
  if (!q.title) return sendJson(res, 400, { error: 'Titre manquant' });
  try {
    const data = await senscritiqueRating({ title: q.title, originalTitle: q.original, year: q.year });
    sendJson(res, 200, data, 86400);
  } catch (e) {
    sendJson(res, 200, { rating: null, url: null, searchUrl: searchUrl(q.title), error: e.message }, 600);
  }
}

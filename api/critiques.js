// Critiques presse : /api/critiques?title=Dune&original=Dune&year=2021
import { sendJson, getQuery } from '../lib/http.js';
import { pressReviews } from '../lib/critiques.js';

export default async function handler(req, res) {
  const q = getQuery(req);
  if (!q.title) return sendJson(res, 400, { error: 'Titre manquant' });
  try {
    const data = await pressReviews({ title: q.title, originalTitle: q.original, year: q.year });
    sendJson(res, 200, data, data.reviews.length ? 86400 : 21600);
  } catch (e) {
    sendJson(res, 200, { reviews: [], error: e.message }, 600);
  }
}

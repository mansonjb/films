// Séances d'un cinéma pour un jour : /api/seances?theater=C0159&date=2026-10-24
import { sendJson, getQuery } from '../lib/http.js';
import { fetchTheaterDay, theaterIdFrom, theaterUrl } from '../lib/allocine.js';

export default async function handler(req, res) {
  const q = getQuery(req);
  const theaterId = theaterIdFrom(q.theater);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : new Date().toISOString().slice(0, 10);
  if (!theaterId) return sendJson(res, 400, { error: 'Code cinéma invalide' });
  try {
    sendJson(res, 200, await fetchTheaterDay(theaterId, date), 1800);
  } catch (e) {
    sendJson(res, 502, { error: `Séances indisponibles : ${e.message}`, theaterId, date, url: theaterUrl(theaterId), movies: [] });
  }
}

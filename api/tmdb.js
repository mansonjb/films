// Proxy vers l'API TMDB : la clé reste côté serveur, langue et région forcées sur la France.
import { sendJson, getQuery } from '../lib/http.js';

const DEFAULT_TMDB_KEY = '3c52c31a898e7d45fd49c3213cdd8052';

const ALLOWED = [
  /^movie\/(now_playing|upcoming|popular|top_rated)$/,
  /^movie\/\d+$/,
  /^movie\/\d+\/(watch\/providers|recommendations|similar)$/,
  /^trending\/movie\/(day|week)$/,
  /^search\/(movie|person|keyword)$/,
  /^person\/\d+$/,
  /^genre\/movie\/list$/,
  /^discover\/movie$/,
  /^watch\/providers\/movie$/,
];

export default async function handler(req, res) {
  const { path: apiPath = '', ...params } = getQuery(req);
  if (!ALLOWED.some((re) => re.test(apiPath))) {
    return sendJson(res, 400, { error: 'Chemin TMDB non autorisé' });
  }
  // Clé par défaut fournie par le propriétaire (non sensible) ; une variable d'environnement la remplace.
  const token = process.env.TMDB_READ_TOKEN;
  const key = process.env.TMDB_API_KEY || (token ? '' : DEFAULT_TMDB_KEY);

  const url = new URL(`https://api.themoviedb.org/3/${apiPath}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('region', 'FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (key) url.searchParams.set('api_key', key);

  try {
    const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await r.json();
    sendJson(res, r.status, data, r.ok ? 3600 : 0);
  } catch (e) {
    sendJson(res, 502, { error: `TMDB injoignable : ${e.message}` });
  }
}

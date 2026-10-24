// Proxy vers l'API TMDB : la clé reste côté serveur, langue et région forcées sur la France.
import { sendJson, getQuery } from '../lib/http.js';
import { tmdbFetch } from '../lib/tmdb.js';

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
  try {
    const { status, ok, data } = await tmdbFetch(apiPath, params);
    sendJson(res, status, data, ok ? 3600 : 0);
  } catch (e) {
    sendJson(res, 502, { error: `TMDB injoignable : ${e.message}` });
  }
}

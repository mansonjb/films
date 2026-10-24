// Appel direct à TMDB côté serveur (clé par défaut ou variables d'environnement).

const DEFAULT_TMDB_KEY = '3c52c31a898e7d45fd49c3213cdd8052';

export async function tmdbFetch(apiPath, params = {}, fetchImpl = fetch) {
  const token = process.env.TMDB_READ_TOKEN;
  const key = process.env.TMDB_API_KEY || (token ? '' : DEFAULT_TMDB_KEY);
  const url = new URL(`https://api.themoviedb.org/3/${apiPath}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('region', 'FR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (key) url.searchParams.set('api_key', key);
  const r = await fetchImpl(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, ok: r.ok, data: await r.json() };
}

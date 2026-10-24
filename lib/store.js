// Stockage de la liste partagée.
// En ligne : Upstash Redis via son API REST (variables créées par l'intégration Vercel).
// En local sans Redis : un fichier JSON dans .data/.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const KEY = 'watchlist:v1';

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(command) {
  const { url, token } = redisConfig();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

const localFile = path.join(process.cwd(), '.data', 'watchlist.json');

export async function loadList() {
  if (redisConfig()) {
    const raw = await redis(['GET', KEY]);
    return raw ? JSON.parse(raw) : { items: [] };
  }
  try {
    return JSON.parse(await fs.readFile(localFile, 'utf8'));
  } catch {
    return { items: [] };
  }
}

export async function saveList(list) {
  if (redisConfig()) {
    await redis(['SET', KEY, JSON.stringify(list)]);
    return;
  }
  if (process.env.VERCEL) throw new Error('Base de données non configurée (Upstash Redis)');
  await fs.mkdir(path.dirname(localFile), { recursive: true });
  await fs.writeFile(localFile, JSON.stringify(list, null, 2));
}

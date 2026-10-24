// Liste partagée de la famille : lecture (GET) et modifications (POST { action, ... }).
import { sendJson, readBody, checkFamilyCode } from '../lib/http.js';
import { loadList, saveList } from '../lib/store.js';
import { applyAction } from '../public/js/list-actions.js';

export default async function handler(req, res) {
  if (!checkFamilyCode(req)) return sendJson(res, 401, { error: 'Code famille incorrect' });
  try {
    if (req.method === 'GET') return sendJson(res, 200, await loadList());
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });
    const body = await readBody(req);
    const list = await loadList();
    const next = applyAction(list, body);
    await saveList(next);
    sendJson(res, 200, next);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}

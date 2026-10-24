import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, parseResults, festivalYear } from '../lib/awards.js';

const row = (tmdb, name, kind) => ({ tmdb: { value: String(tmdb) }, name: { value: name }, kind: { value: kind } });

test('la requête cherche les prix par nom et filtre sur l’année', () => {
  const q = buildQuery('cannes', 2025);
  assert.match(q, /"Palme d'Or"@en/);
  assert.match(q, /= 2025\)/);
  assert.throws(() => buildQuery('inconnu', 2025));
});

test('palmarès trié par importance, sélection = compétition pour le prix principal', () => {
  const json = { results: { bindings: [
    row(1, "Palme d'Or", 'nom'),
    row(2, "Palme d'Or", 'nom'),
    row(2, 'Grand Prix (Cannes Film Festival)', 'win'),
    row(3, "Palme d'Or", 'win'),
    row(4, "Caméra d'Or", 'win'),
    row(2, 'Jury Prize (Cannes Film Festival)', 'win'),
  ] } };
  const out = parseResults('cannes', json);
  assert.deepEqual(out.winners.map((w) => [w.tmdb, w.award]), [[3, "Palme d'or"], [2, 'Grand Prix'], [4, "Caméra d'or"]]);
  assert.deepEqual(out.selection.sort(), [1, 2, 3]);
});

test('erreur claire si Wikidata ne répond pas', async () => {
  await assert.rejects(festivalYear('cannes', 2025, async () => ({ ok: false, status: 503 })), /Wikidata indisponible/);
});

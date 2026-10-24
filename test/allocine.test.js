import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTheaterDay, theaterIdFrom, fetchTheaterDay, normalizeTitle } from '../lib/allocine.js';

const sample = {
  pagination: { page: 1, totalPages: 1 },
  results: [
    {
      movie: { internalId: 1234, title: 'Le Comte de Monte-Cristo', originalTitle: 'Le Comte de Monte-Cristo' },
      showtimes: {
        original: [],
        local: [{ startsAt: '2026-10-24T20:15:00', diffusionVersion: 'LOCAL', projection: ['DIGITAL'] }],
        multiple: [{ startsAt: '2026-10-24T14:00:00', diffusionVersion: 'DUBBED', experience: ['IMAX'] }],
      },
    },
    { movie: { internalId: 9, title: 'Sans séance' }, showtimes: {} },
  ],
};

test('lit les séances et les trie par heure', () => {
  const d = parseTheaterDay(sample);
  assert.equal(d.movies.length, 1);
  assert.deepEqual(d.movies[0].showtimes.map((s) => [s.time, s.version, s.tags]), [
    ['14:00', 'VF', ['IMAX']],
    ['20:15', 'VF', []],
  ]);
  assert.match(d.movies[0].url, /cfilm=1234/);
});

test('tolère une réponse vide ou inattendue', () => {
  assert.deepEqual(parseTheaterDay(null).movies, []);
  assert.deepEqual(parseTheaterDay({ results: 'x' }).movies, []);
});

test('reconnaît le code cinéma dans un lien Allociné', () => {
  assert.equal(theaterIdFrom('https://www.allocine.fr/seance/salle_gen_csalle=C0159.html'), 'C0159');
  assert.equal(theaterIdFrom('p0671'), 'P0671');
  assert.equal(theaterIdFrom('n’importe quoi'), null);
});

test('suit la pagination', async () => {
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    const page = url.includes('p-2') ? 2 : 1;
    return { ok: true, json: async () => ({ ...sample, pagination: { page, totalPages: 2 } }) };
  };
  const d = await fetchTheaterDay('C0159', '2026-10-24', fake);
  assert.equal(urls.length, 2);
  assert.equal(d.movies.length, 2);
});

test('normalise les titres pour la comparaison', () => {
  assert.equal(normalizeTitle('Astérix & Obélix : L’Empire du Milieu'), 'asterix et obelix l empire du milieu');
});

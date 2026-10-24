import { test } from 'node:test';
import assert from 'node:assert/strict';

// Faux TMDB : chaque film a des genres, un réalisateur, des thèmes et ses propres recommandations.
const DB = new Map();
const film = (id, { g, d, k = [], recs = [], year = 2018, votes = 2000, avg = 7 }) =>
  DB.set(id, {
    id,
    title: `Film ${id}`,
    release_date: `${year}-05-01`,
    vote_count: votes,
    vote_average: avg,
    popularity: 50,
    genres: g.map((x) => ({ id: x, name: `G${x}` })),
    genre_ids: g,
    keywords: { keywords: k.map((x) => ({ id: x, name: `K${x}` })) },
    credits: { crew: [{ id: d, name: `R${d}`, job: 'Director' }], cast: [] },
    recommendations: { results: recs.map((r) => ({ id: r })) },
  });

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.fetch = async (url) => {
  const q = new URL(url, 'http://x').searchParams;
  const path = q.get('path');
  let data;
  if (path === 'discover/movie') data = { results: [] };
  else {
    const m = DB.get(Number(path.split('/')[1]));
    data = m ? { ...m, recommendations: { results: m.recommendations.results.map((r) => slim(DB.get(r.id))) } } : null;
  }
  return { ok: !!data, status: data ? 200 : 404, json: async () => data || { error: 'absent' } };
};
const slim = (m) => m && { id: m.id, title: m.title, release_date: m.release_date, genre_ids: m.genre_ids, vote_count: m.vote_count, vote_average: m.vote_average, popularity: 50 };

const { buildProfile, recommend, isActionFlick, wellRated, isAnimation, isBlockbuster, isUsMainstream, originBonus, featuresOf, itemWeight, familyMean, diversify, buildTaste, contentScore } = await import('../public/js/reco.js');

// Candidats : 100-199 thrillers du réalisateur 1, 200-299 comédies, 300-399 drames variés (réalisateurs différents).
for (let i = 100; i < 140; i++) film(i, { g: [53], d: 1, k: [7] });
for (let i = 200; i < 240; i++) film(i, { g: [35], d: 50 + (i % 10), k: [9] });
for (let i = 300; i < 360; i++) film(i, { g: [18], d: 300 + i, k: [8] });
// Deux thrillers adorés qui recommandent tous les mêmes thrillers.
film(1, { g: [53], d: 1, k: [7], recs: Array.from({ length: 20 }, (_, n) => 100 + n) });
film(2, { g: [53], d: 1, k: [7], recs: Array.from({ length: 20 }, (_, n) => 110 + n) });
// Douze drames bien notés, chacun avec ses propres recommandations.
for (let j = 0; j < 12; j++) film(10 + j, { g: [18], d: 30 + j, k: [8], recs: Array.from({ length: 5 }, (_, n) => 300 + j * 5 + n) });
// Des comédies détestées.
for (let j = 0; j < 6; j++) film(40 + j, { g: [35], d: 50 + j, k: [9], recs: Array.from({ length: 5 }, (_, n) => 200 + j * 5 + n) });

const items = [
  { id: 1, title: 'Film 1', status: 'seen', ratings: { a: 5 } },
  { id: 2, title: 'Film 2', status: 'seen', ratings: { a: 5 } },
  ...Array.from({ length: 12 }, (_, j) => ({ id: 10 + j, title: `Film ${10 + j}`, status: 'seen', ratings: { a: 4, b: 4.5 } })),
  ...Array.from({ length: 6 }, (_, j) => ({ id: 40 + j, title: `Film ${40 + j}`, status: 'seen', ratings: { a: 1.5 } })),
];

test('les notes sont centrées sur la moyenne de la famille', () => {
  const mean = familyMean(items);
  assert.ok(itemWeight({ status: 'seen', ratings: { a: 5 } }, mean) > 1);
  assert.ok(itemWeight({ status: 'seen', ratings: { a: 1.5 } }, mean) < -1);
  assert.ok(itemWeight({ status: 'hidden' }, mean) < 0);
  assert.ok(itemWeight({ status: 'todo', wants: ['a'] }, mean) > 0);
});

test('un trait vu sur un seul film pèse moins qu’un trait qui revient', () => {
  const f = (t, g) => ({ t, g: [[g, `G${g}`]], k: [], d: [], a: [] });
  const taste = buildTaste([{ w: 2, f: f('A', 1) }, ...Array.from({ length: 6 }, (_, n) => ({ w: 1.2, f: f(`B${n}`, 2) }))]);
  assert.ok(taste.get('g2').aff > taste.get('g1').aff);
  assert.ok(contentScore(f('x', 2), taste).score > contentScore(f('y', 1), taste).score);
});

test('diversité : au plus deux films par film aimé', () => {
  const scored = Array.from({ length: 10 }, (_, n) => ({ m: { id: n }, score: 10 - n * 0.01, seeds: [1] }));
  scored.push({ m: { id: 99 }, score: 1, seeds: [2] });
  const out = diversify(scored, 5);
  assert.equal(out.filter((r) => r.seeds[0] === 1).length, 2);
  assert.ok(out.some((r) => r.m.id === 99));
});

test('les recommandations s’appuient sur toutes les notes, pas sur deux films', async () => {
  const profile = await buildProfile(items);
  assert.equal(profile.rated, 20);
  const recs = await recommend(profile, { limit: 14 });
  const thrillers = recs.filter((m) => m.id >= 100 && m.id < 200).length;
  const dramas = recs.filter((m) => m.id >= 300 && m.id < 400).length;
  const comedies = recs.filter((m) => m.id >= 200 && m.id < 300).length;
  assert.equal(comedies, 0, 'les comédies mal notées ne remontent pas');
  assert.ok(thrillers <= 4, `pas plus de quelques thrillers du même réalisateur (${thrillers})`);
  assert.ok(dramas >= 8, `les drames bien notés pèsent aussi (${dramas})`);
});

test('blockbusters : gros budget ou grande saga de spectacle', () => {
  const f = (o) => featuresOf({ title: 'x', genres: (o.g || []).map((id) => ({ id })), budget: (o.b || 0) * 1e6, belongs_to_collection: o.c ? { id: o.c } : null, vote_count: o.v || 0 });
  assert.equal(isBlockbuster(f({ g: [28], b: 200, c: 1 })), true);
  assert.equal(isBlockbuster(f({ g: [12], c: 9, v: 9000 })), true);
  assert.equal(isBlockbuster(f({ g: [18], b: 15, v: 20000 })), false);
  assert.equal(isBlockbuster(f({ g: [35], c: 4, b: 10, v: 3000 })), false);
  assert.equal(isBlockbuster(null, { genre_ids: [878], vote_count: 20000 }), true);
});

test('cinéma grand public américain écarté, cinéma français et européen favorisé', () => {
  const f = (g, o, l = 'en', v = 500) => featuresOf({ title: 'x', genres: g.map((id) => ({ id })), origin_country: o, original_language: l, vote_count: v });
  assert.equal(isUsMainstream(f([28, 35], ['US'])), true, 'action-comédie américaine');
  assert.equal(isUsMainstream(f([18], ['US'])), false, 'drame américain indépendant');
  assert.equal(isUsMainstream(f([28, 53], ['FR'], 'fr')), false, 'polar d’action français');
  assert.equal(isUsMainstream(null, { genre_ids: [28], original_language: 'en' }), true);
  assert.ok(originBonus(f([18], ['FR'], 'fr')) > originBonus(f([18], ['DK'], 'da')));
  assert.ok(originBonus(f([18], ['DK'], 'da')) > originBonus(f([18], ['US'])));
});

test('les films d’animation sont reconnus, toutes origines', () => {
  assert.equal(isAnimation(featuresOf({ title: 'x', genres: [{ id: 16 }, { id: 18 }], origin_country: ['FR'] })), true);
  assert.equal(isAnimation(null, { genre_ids: [16] }), true);
  assert.equal(isAnimation(null, { genre_ids: [18] }), false);
});

test('films d’action en anglais écartés même en coproduction française, note minimale', () => {
  const f = (g, l, o) => featuresOf({ title: 'x', genres: g.map((id) => ({ id })), original_language: l, origin_country: o });
  assert.equal(isActionFlick(f([28, 53], 'en', ['FR', 'US'])), true, 'Overdrive');
  assert.equal(isActionFlick(f([28, 53, 18], 'fr', ['FR']), { vote_average: 6.8 }), false, 'polar d’action français');
  assert.equal(isActionFlick(f([53, 18], 'en', ['GB'])), false);
  assert.equal(wellRated({ vote_average: 6.1, vote_count: 900 }), false);
  assert.equal(wellRated({ vote_average: 7.2, vote_count: 900 }), true);
  assert.equal(wellRated({ vote_average: 5, vote_count: 10 }), true, 'trop peu de votes pour juger');
});

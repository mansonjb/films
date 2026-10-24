import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMovie, parsePress, pressReviews } from '../lib/critiques.js';

const auto = { results: [
  { entity_type: 'movie', entity_id: '1000012316', label: 'Le Mystère Lucy Lost', original_label: 'Le Mystère Lucy Lost', data: { year: '2026' } },
  { entity_type: 'movie', entity_id: '133392', label: 'Dune', original_label: 'Dune', data: { year: '2021' } },
  { entity_type: 'movie', entity_id: '324508', label: 'Dune : Troisième partie', original_label: 'Dune: Part Three', data: { year: '2026' } },
  { entity_type: 'series', entity_id: '25210', label: 'Dune', original_label: 'Dune', data: { year: '2024' } },
] };

const html = `<html><head><script>var x = "par personne";</script></head><body>
<nav><a href="/">Accueil</a><a href="/film/">Cinéma</a></nav>
<h1>Dune : Critique presse</h1>
<div class="big-note"><span>Note moyenne</span><div class="note">4,0</div><span>40 titres de presse</span></div>
<ul><li>Bande à part</li><li>Le Monde</li></ul>
<h2>40 critiques presse</h2>
<div class="item"><h2 class="title"><span>Bande à part</span></h2><div class="rating-mdl n50 stareval-stars"></div>
<div class="meta"><span class="light">par </span><span>Jo Fishley</span></div>
<p class="text">Denis Villeneuve compose un space opera &laquo;&nbsp;grandiose&nbsp;&raquo;.</p>
<a href="#">La critique complète est disponible sur le site Bande à part</a></div>
<div class="item"><h2 class="title"><span>Le Monde</span></h2><div class="rating-mdl n30 stareval-stars"></div>
<div class="meta">par</div><div>Jacques Mandelbaum</div>
<p class="text">Une tragédie futuriste<br>à l’esthétique très réussie.</p></div>
<div><h2>Les meilleurs films de tous les temps</h2></div></body></html>`;

test('retrouve le bon film Allociné par titre et année', () => {
  assert.equal(pickMovie(auto, { title: 'Dune', originalTitle: 'Dune', year: 2021 }), 133392);
  assert.equal(pickMovie(auto, { title: 'Dune : Troisième partie', originalTitle: 'Dune: Part Three', year: 2026 }), 324508);
  assert.equal(pickMovie(auto, { title: 'Dune', year: 1984 }), null);
});

test('lit les critiques presse : journal, auteur, extrait, note', () => {
  const out = parsePress(html);
  assert.equal(out.average, 4);
  assert.deepEqual(out.reviews, [
    { outlet: 'Bande à part', author: 'Jo Fishley', quote: 'Denis Villeneuve compose un space opera « grandiose ».', rating: 5 },
    { outlet: 'Le Monde', author: 'Jacques Mandelbaum', quote: 'Une tragédie futuriste à l’esthétique très réussie.', rating: 3 },
  ]);
});

test('enchaîne autocomplétion puis page presse', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    return url.includes('autocomplete') ? { ok: true, json: async () => auto } : { ok: true, status: 200, text: async () => html };
  };
  const out = await pressReviews({ title: 'Dune', originalTitle: 'Dune', year: 2021 }, fake);
  assert.equal(out.allocineId, 133392);
  assert.equal(out.reviews.length, 2);
  assert.match(calls[1], /fichefilm-133392\/critiques\/presse/);
});

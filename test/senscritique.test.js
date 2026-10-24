import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedJson, findProducts, bestMatch, senscritiqueRating } from '../lib/senscritique.js';

const searchHtml = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { results: [
    { title: 'Dune', universe: 1, yearOfProduction: 1984, rating: 5.9, url: '/film/dune/1' },
    { title: 'Dune', universe: 1, yearOfProduction: 2021, rating: 7.1, url: '/film/dune/2', stats: { ratingCount: 50000 } },
    { title: 'Dune', universe: 2, yearOfProduction: 1965, rating: 8.2, url: '/livre/dune/3' },
  ] } },
})}</script></html>`;

test('trouve le bon film selon le titre et l’année', () => {
  const products = embeddedJson(searchHtml).flatMap(findProducts);
  assert.equal(products.length, 2);
  const m = bestMatch(products, { title: 'Dune', originalTitle: 'Dune', year: 2021 });
  assert.equal(m.rating, 7.1);
  assert.equal(m.url, 'https://www.senscritique.com/film/dune/2');
});

test('ignore un homonyme trop éloigné dans le temps', () => {
  const products = embeddedJson(searchHtml).flatMap(findProducts);
  assert.equal(bestMatch(products, { title: 'Dune', year: 2010 }), null);
});

test('va chercher la note sur la page du film si besoin (JSON-LD)', async () => {
  const search = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ a: { title: 'Le Grand Bain', universe: 1, yearOfProduction: 2018, url: '/film/le_grand_bain/9' } })}</script>`;
  const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name: 'Le Grand Bain', dateCreated: '2018-10-24', aggregateRating: { ratingValue: '6.8', ratingCount: 12000 } })}</script>`;
  const fake = async (url) => ({ ok: true, text: async () => (url.includes('/search') ? search : page) });
  const r = await senscritiqueRating({ title: 'Le Grand Bain', year: 2018 }, fake);
  assert.equal(r.rating, 6.8);
  assert.equal(r.count, 12000);
});

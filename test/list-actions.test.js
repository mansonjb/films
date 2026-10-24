import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../public/js/list-actions.js';

const movie = { id: 42, title: 'Dune', release_date: '2021-09-15', extra: 'ignoré' };

test('ajoute un film une seule fois, avec celui qui l’ajoute dans les envies', () => {
  let l = applyAction({ items: [] }, { action: 'add', movie, by: 'JB' });
  l = applyAction(l, { action: 'add', movie, by: 'Léa' });
  assert.equal(l.items.length, 1);
  assert.deepEqual(l.items[0].wants, ['JB']);
  assert.equal(l.items[0].extra, undefined);
});

test('envies, statut vu, notes et retrait', () => {
  let l = applyAction({ items: [] }, { action: 'add', movie, by: 'JB' });
  l = applyAction(l, { action: 'toggleWant', movieId: 42, by: 'Léa' });
  assert.deepEqual(l.items[0].wants, ['JB', 'Léa']);
  l = applyAction(l, { action: 'toggleWant', movieId: 42, by: 'JB' });
  assert.deepEqual(l.items[0].wants, ['Léa']);
  l = applyAction(l, { action: 'setStatus', movieId: 42, status: 'seen' });
  assert.equal(l.items[0].status, 'seen');
  l = applyAction(l, { action: 'rate', movieId: 42, by: 'Léa', value: 4 });
  assert.deepEqual(l.items[0].ratings, { Léa: 4 });
  l = applyAction(l, { action: 'rate', movieId: 42, by: 'Léa', value: 0 });
  assert.deepEqual(l.items[0].ratings, {});
  l = applyAction(l, { action: 'remove', movieId: 42 });
  assert.equal(l.items.length, 0);
});

test('refuse une action inconnue ou un film absent', () => {
  assert.throws(() => applyAction({ items: [] }, { action: 'nope' }), /inconnue/);
  assert.throws(() => applyAction({ items: [] }, { action: 'remove', movieId: 1 }), /introuvable/);
});

test('« pas intéressé » ajoute le film masqué, sans envie, avec ses genres', () => {
  const l = applyAction({ items: [] }, { action: 'add', movie: { id: 7, title: 'X', genres: [{ id: 28 }] }, by: 'JB', status: 'hidden' });
  assert.equal(l.items[0].status, 'hidden');
  assert.deepEqual(l.items[0].wants, []);
  assert.deepEqual(l.items[0].genre_ids, [28]);
});

test('noter un film absent de la liste l’ajoute comme vu avec la note', () => {
  const out = applyAction({ items: [] }, { action: 'rate', movie: { id: 7, title: 'X' }, value: 4, by: 'JB' });
  assert.equal(out.items[0].status, 'seen');
  assert.deepEqual(out.items[0].ratings, { JB: 4 });
});

test('noter un film « à voir » le passe en vu', () => {
  const list = applyAction({ items: [] }, { action: 'add', movie: { id: 7, title: 'X' }, by: 'JB' });
  const out = applyAction(list, { action: 'rate', movieId: 7, value: 5, by: 'Léa' });
  assert.equal(out.items[0].status, 'seen');
  assert.equal(out.items[0].ratings['Léa'], 5);
});

test('demi-notes acceptées et arrondies au demi-point', () => {
  const base = { items: [{ id: 7, title: 'X', status: 'todo' }] };
  assert.equal(applyAction(base, { action: 'rate', movieId: 7, value: 2.5, by: 'JB' }).items[0].ratings.JB, 2.5);
  assert.equal(applyAction(base, { action: 'rate', movieId: 7, value: 3.3, by: 'JB' }).items[0].ratings.JB, 3.5);
  assert.equal(applyAction(base, { action: 'rate', movieId: 7, value: 0.5, by: 'JB' }).items[0].status, 'seen');
});

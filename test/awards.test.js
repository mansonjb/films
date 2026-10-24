import test from 'node:test';
import assert from 'node:assert/strict';
import { FESTIVALS, filmLinks, parseFestival, parseCeremony, festivalYear } from '../lib/awards.js';

const cannes = `{{Infobox film festival}}
== Juries ==
=== Main Competition ===
* [[Juliette Binoche]], French actress (Jury President)
== Official Selection ==
=== In Competition ===
The following films were selected to compete for the ''[[Palme d'Or]]'':
{| class="wikitable sortable"
|-
| colspan="2" | ''[[Alpha (2025 film)|Alpha]]'' <small>(QP)</small>|| [[Julia Ducournau]]||France, Belgium
|-
| ''[[Case 137]]'' || {{lang|fr|Dossier 137}} || [[Dominik Moll]]||France
|-style="background:#FFDEAD;"
| '''''[[It Was Just an Accident]]''''' || '''{{lang|fa|x}}'''|| '''[[Jafar Panahi]]'''||'''Iran, France'''
|-
| ''[[Sentimental Value]]''|| {{lang|no|Affeksjonsverdi}} || [[Joachim Trier]]||Norway
|}
=== Out of Competition ===
| ''[[Mission: Impossible – The Final Reckoning]]''
== Official Awards ==
=== In Competition ===
* [[Palme d'Or]]: ''[[It Was Just an Accident]]'' by [[Jafar Panahi]]<ref name=":5" />
* [[Grand Prix (Cannes Film Festival)|Grand Prix]]: ''[[Sentimental Value]]'' by [[Joachim Trier]]
* [[Jury Prize (Cannes Film Festival)|Jury Prize]]: 
** ''[[Sirāt (film)|Sirāt]]'' by [[Oliver Laxe]]
** ''[[Sound of Falling]]'' by [[Mascha Schilinski]]
* [[Cannes Film Festival Award for Best Actor|Best Actor]]: [[Wagner Moura]] for [[The Secret Agent (2025 film)|''The Secret Agent'']]
=== Caméra d'Or ===
* ''[[The President's Cake]]'' by [[Hasan Hadi]]
== Independent Awards ==
* '''FIPRESCI''': ''[[Other Film]]''`;

const oscars = `===Awards===
{| class="wikitable defaulttop" role="presentation"
| style="width:50%;"| {{Award category|#F9EFAA|[[Academy Award for Best Picture|Best Picture]]}}
* '''''[[Anora]]'' – [[Alex Coco]], producers ‡'''
** ''[[The Brutalist]]'' – Nick Gordon, producers
** ''[[Conclave (film)|Conclave]]'' – [[Tessa Ross]], producers
| style="width:50%;"| {{Award category|#F9EFAA|[[Academy Award for Best Director|Best Directing]]}}
* '''[[Sean Baker]] – ''[[Anora]]'' ‡'''
** [[Brady Corbet]] – ''[[The Brutalist]]''
|-
| {{Award category|#F9EFAA|[[Academy Award for Best Actor|Best Actor in a Leading Role]]}}
* '''[[Adrien Brody]] – ''[[The Brutalist]]'' as László Tóth ‡'''
| {{Award category|#F9EFAA|[[Academy Award for Best Animated Feature|Best Animated Feature Film]]}}
* '''''[[Flow (2024 film)|Flow]]'' – [[Gints Zilbalodis]] ‡'''
** ''[[Inside Out 2]]'' – [[Kelsey Mann]]
|}`;

test('noms de page par édition', () => {
  assert.equal(FESTIVALS.cannes.page(2025), '2025 Cannes Film Festival');
  assert.equal(FESTIVALS.venise.page(2025), '82nd Venice International Film Festival');
  assert.equal(FESTIVALS.berlin.page(2025), '75th Berlin International Film Festival');
  assert.equal(FESTIVALS.oscars.page(2025), '97th Academy Awards');
  assert.equal(FESTIVALS.cesar.page(2025), '50th César Awards');
  assert.equal(FESTIVALS.bafta.page(2021), '74th British Academy Film Awards');
});

test('liens de films en italique seulement', () => {
  assert.deepEqual(filmLinks("''[[Anora]]'' – [[Sean Baker]] et [[The Secret Agent (2025 film)|''The Secret Agent'']]"), ['Anora', 'The Secret Agent (2025 film)']);
});

test('festival : compétition officielle et palmarès', () => {
  const out = parseFestival('cannes', cannes);
  assert.deepEqual(out.selection, ['Alpha (2025 film)', 'Case 137', 'It Was Just an Accident', 'Sentimental Value']);
  assert.deepEqual(out.winners, [
    { title: 'It Was Just an Accident', award: "Palme d'or" },
    { title: 'Sentimental Value', award: 'Grand Prix' },
    { title: 'Sirāt (film)', award: 'Prix du jury' },
    { title: 'Sound of Falling', award: 'Prix du jury' },
    { title: 'The Secret Agent (2025 film)', award: "Prix d'interprétation masculine" },
    { title: "The President's Cake", award: "Caméra d'or" },
  ]);
});

test('Berlinale : « Official Sections » et jurés ignorés', () => {
  const wt = `== Juries ==
=== Main Competition ===
* [[Todd Haynes]], American filmmaker
== Official Sections ==
=== Main Competition ===
{| class="wikitable"
| ''[[Dreams (2025 film)|Dreams]]'' || [[Michel Franco]]
|-
| ''[[Blue Moon (2025 film)|Blue Moon]]'' || [[Richard Linklater]]
|}
== Official Awards ==
=== Main Competition ===
* [[Golden Bear]]: ''[[Dreams (Sex Love)]]'' by [[Dag Johan Haugerud]]
* [[Silver Bear Grand Jury Prize]]: ''[[The Blue Trail]]'' by [[Gabriel Mascaro]]
* [[Silver Bear for Best Director]]: [[Huo Meng]] for ''[[Living the Land]]''`;
  const out = parseFestival('berlin', wt);
  assert.deepEqual(out.selection, ['Dreams (2025 film)', 'Blue Moon (2025 film)']);
  assert.deepEqual(out.winners.map((w) => w.award), ["Ours d'or", "Grand prix du jury (Ours d'argent)", "Ours d'argent de la mise en scène"]);
});

test('cérémonie : nommés au meilleur film et lauréats', () => {
  const out = parseCeremony('oscars', oscars);
  assert.deepEqual(out.selection, ['Anora', 'The Brutalist', 'Conclave (film)']);
  assert.deepEqual(out.winners, [
    { title: 'Anora', award: 'Meilleur film' },
    { title: 'Anora', award: 'Meilleure réalisation' },
    { title: 'Flow (2024 film)', award: "Meilleur film d'animation" },
  ]);
});

test('de la page Wikipédia aux identifiants TMDB', async () => {
  const fake = async (url) => {
    const u = new URL(url);
    let body;
    if (u.hostname === 'query.wikidata.org') body = { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, tmdb: { value: '1064213' } }, { item: { value: 'http://www.wikidata.org/entity/Q2' }, tmdb: { value: '549509' } }] } };
    else if (u.searchParams.get('action') === 'parse') body = { parse: { wikitext: oscars } };
    else body = { query: { normalized: [], redirects: [{ from: 'Conclave (film)', to: 'Conclave (2024 film)' }], pages: [{ title: 'Anora', pageprops: { wikibase_item: 'Q1' } }, { title: 'The Brutalist', pageprops: { wikibase_item: 'Q2' } }, { title: 'Conclave (2024 film)', pageprops: { wikibase_item: 'Q3' } }] } };
    return { ok: true, json: async () => body };
  };
  const out = await festivalYear('oscars', 2025, fake);
  assert.deepEqual(out.selection, [1064213, 549509]);
  assert.deepEqual(out.winners, [{ tmdb: 1064213, award: 'Meilleur film' }, { tmdb: 1064213, award: 'Meilleure réalisation' }]);
});

test('édition sans page : résultat vide, pas d’erreur', async () => {
  const out = await festivalYear('cannes', 2031, async () => ({ ok: true, json: async () => ({ error: { code: 'missingtitle' } }) }));
  assert.deepEqual(out, { winners: [], selection: [] });
});

// Palmarès et sélections des grands festivals, via Wikidata (requête SPARQL publique).
// Sélection officielle = films en compétition pour le prix principal ; palmarès = prix reçus.

export const FESTIVALS = {
  cannes: {
    name: 'Festival de Cannes',
    month: 5,
    selection: 'Compétition officielle',
    awards: [
      ["Palme d'Or", "Palme d'or"],
      ['Grand Prix (Cannes Film Festival)', 'Grand Prix'],
      ['Jury Prize (Cannes Film Festival)', 'Prix du jury'],
      ['Cannes Film Festival Award for Best Director', 'Prix de la mise en scène'],
      ['Cannes Film Festival Award for Best Screenplay', 'Prix du scénario'],
      ['Cannes Film Festival Award for Best Actress', "Prix d'interprétation féminine"],
      ['Cannes Film Festival Award for Best Actor', "Prix d'interprétation masculine"],
      ['Un Certain Regard', 'Prix Un certain regard'],
      ['Prix Un Certain Regard', 'Prix Un certain regard'],
      ["Caméra d'Or", "Caméra d'or"],
    ],
  },
  venise: {
    name: 'Mostra de Venise',
    month: 9,
    selection: 'Compétition officielle',
    awards: [
      ['Golden Lion', "Lion d'or"],
      ['Grand Jury Prize (Venice Film Festival)', 'Grand prix du jury'],
      ['Silver Lion', "Lion d'argent"],
      ['Volpi Cup for Best Actress', 'Coupe Volpi de la meilleure actrice'],
      ['Volpi Cup for Best Actor', 'Coupe Volpi du meilleur acteur'],
    ],
  },
  berlin: {
    name: 'Berlinale',
    month: 2,
    selection: 'Compétition officielle',
    awards: [
      ['Golden Bear', "Ours d'or"],
      ['Silver Bear Grand Jury Prize', "Grand prix du jury (Ours d'argent)"],
      ['Silver Bear for Best Director', "Ours d'argent de la mise en scène"],
    ],
  },
  oscars: {
    name: 'Oscars',
    month: 3,
    selection: 'Nommés au meilleur film',
    awards: [
      ['Academy Award for Best Picture', 'Meilleur film'],
      ['Academy Award for Best Director', 'Meilleure réalisation'],
      ['Academy Award for Best International Feature Film', 'Meilleur film international'],
      ['Academy Award for Best Animated Feature', "Meilleur film d'animation"],
    ],
  },
  cesar: {
    name: 'César',
    month: 2,
    selection: 'Nommés au meilleur film',
    awards: [
      ['César Award for Best Film', 'Meilleur film'],
      ['César Award for Best Director', 'Meilleure réalisation'],
      ['César Award for Best First Feature Film', 'Meilleur premier film'],
      ['César Award for Best Animated Film', "Meilleur film d'animation"],
    ],
  },
  bafta: {
    name: 'BAFTA',
    month: 2,
    selection: 'Nommés au meilleur film',
    awards: [['BAFTA Award for Best Film', 'Meilleur film']],
  },
};

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Les prix sont retrouvés par leur nom anglais sur Wikidata : pas d'identifiant à maintenir.
export function buildQuery(festKey, year) {
  const fest = FESTIVALS[festKey];
  if (!fest) throw new Error('Festival inconnu');
  const names = fest.awards.map(([en]) => `"${esc(en)}"@en`).join(' ');
  return `SELECT ?film ?tmdb ?name ?kind (SAMPLE(?t) AS ?when) (MIN(?pub) AS ?first) WHERE {
  VALUES ?name { ${names} }
  ?award rdfs:label ?name .
  { ?film p:P1411 ?st . ?st ps:P1411 ?award . BIND("nom" AS ?kind) }
  UNION { ?film p:P166 ?st . ?st ps:P166 ?award . BIND("win" AS ?kind) }
  ?film wdt:P4947 ?tmdb .
  OPTIONAL { ?st pq:P585 ?t }
  OPTIONAL { ?film wdt:P577 ?pub }
}
GROUP BY ?film ?tmdb ?name ?kind
HAVING (COALESCE(YEAR(SAMPLE(?t)), YEAR(MIN(?pub))) = ${Number(year)})`;
}

// Transforme la réponse SPARQL en { winners: [{ tmdb, award }], selection: [tmdb] }.
export function parseResults(festKey, json) {
  const fest = FESTIVALS[festKey];
  const frName = new Map(fest.awards.map(([en, fr]) => [en, fr]));
  const order = new Map(fest.awards.map(([en], k) => [en, k]));
  const topAward = fest.awards[0][0];
  const winners = new Map();
  const selection = new Set();
  for (const b of json?.results?.bindings || []) {
    const tmdb = Number(b.tmdb?.value);
    const name = b.name?.value;
    if (!tmdb || !name) continue;
    if (b.kind?.value === 'win') {
      const cur = winners.get(tmdb);
      if (!cur || order.get(name) < order.get(cur.en)) winners.set(tmdb, { tmdb, award: frName.get(name) || name, en: name, rank: order.get(name) });
      if (name === topAward) selection.add(tmdb);
    } else if (name === topAward) {
      selection.add(tmdb);
    }
  }
  return {
    winners: [...winners.values()].sort((a, b) => a.rank - b.rank).map(({ tmdb, award }) => ({ tmdb, award })),
    selection: [...selection],
  };
}

export async function festivalYear(festKey, year, fetchImpl = fetch) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(buildQuery(festKey, year))}`;
  const r = await fetchImpl(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'NosFilms/1.0 (watchlist familiale; https://github.com/mansonjb/films)' } });
  if (!r.ok) throw new Error(`Wikidata indisponible (${r.status})`);
  return parseResults(festKey, await r.json());
}

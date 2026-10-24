// Palmarès et sélections des grands festivals et cérémonies.
// Source : la page Wikipédia (anglaise) de chaque édition, très régulière d'une année à l'autre.
// Les liens vers les films y mènent à leur article, dont l'élément Wikidata donne l'identifiant TMDB :
// aucun rapprochement par titre, donc pas de faux positifs.

const WIKI = 'https://en.wikipedia.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'NosFilms/1.0 (watchlist familiale; https://github.com/mansonjb/films)';

const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// kind « festival » : sélection = compétition officielle, palmarès = liste à puces des prix.
// kind « ceremony » : tableau de catégories ; sélection = nommés de la catégorie principale.
export const FESTIVALS = {
  cannes: {
    name: 'Festival de Cannes',
    selection: 'Compétition officielle',
    kind: 'festival',
    page: (y) => `${y} Cannes Film Festival`,
    awards: [
      [/palme d'or/i, "Palme d'or"],
      [/^grand prix/i, 'Grand Prix'],
      [/^jury prize/i, 'Prix du jury'],
      [/best director/i, 'Prix de la mise en scène'],
      [/best screenplay/i, 'Prix du scénario'],
      [/best actress/i, "Prix d'interprétation féminine"],
      [/best actor/i, "Prix d'interprétation masculine"],
      [/sp[ée]cial/i, 'Prix spécial'],
      [/cam[ée]ra d'or/i, "Caméra d'or"],
    ],
  },
  venise: {
    name: 'Mostra de Venise',
    selection: 'Compétition officielle',
    kind: 'festival',
    page: (y) => `${ord(y - 1943)} Venice International Film Festival`,
    awards: [
      [/golden lion/i, "Lion d'or"],
      [/grand jury prize/i, 'Grand prix du jury'],
      [/silver lion|best director/i, "Lion d'argent de la mise en scène"],
      [/special jury prize/i, 'Prix spécial du jury'],
      [/best actress/i, 'Coupe Volpi de la meilleure actrice'],
      [/best actor/i, 'Coupe Volpi du meilleur acteur'],
      [/best screenplay/i, 'Prix du scénario'],
    ],
  },
  berlin: {
    name: 'Berlinale',
    selection: 'Compétition officielle',
    kind: 'festival',
    page: (y) => `${ord(y - 1950)} Berlin International Film Festival`,
    awards: [
      [/golden bear/i, "Ours d'or"],
      [/grand jury prize/i, "Grand prix du jury (Ours d'argent)"],
      [/(^|silver bear )jury prize/i, "Prix du jury (Ours d'argent)"],
      [/best director/i, "Ours d'argent de la mise en scène"],
      [/leading performance/i, "Ours d'argent de la meilleure interprétation"],
      [/screenplay/i, "Ours d'argent du scénario"],
    ],
  },
  oscars: {
    name: 'Oscars',
    selection: 'Nommés au meilleur film',
    kind: 'ceremony',
    page: (y) => `${ord(y - 1928)} Academy Awards`,
    awards: [
      [/^best picture$/i, 'Meilleur film'],
      [/^best direct(ing|or)$/i, 'Meilleure réalisation'],
      [/international feature/i, 'Meilleur film international'],
      [/^best animated feature/i, "Meilleur film d'animation"],
      [/original screenplay/i, 'Meilleur scénario original'],
    ],
  },
  cesar: {
    name: 'César',
    selection: 'Nommés au meilleur film',
    kind: 'ceremony',
    page: (y) => `${ord(y - 1975)} César Awards`,
    awards: [
      [/^best film$/i, 'Meilleur film'],
      [/^best director$/i, 'Meilleure réalisation'],
      [/^best first (feature )?film$/i, 'Meilleur premier film'],
      [/^best animated (feature )?film$/i, "Meilleur film d'animation"],
      [/^best original screenplay$/i, 'Meilleur scénario original'],
    ],
  },
  bafta: {
    name: 'BAFTA',
    selection: 'Nommés au meilleur film',
    kind: 'ceremony',
    page: (y) => `${ord(y - 1947)} British Academy Film Awards`,
    awards: [
      [/^best film$/i, 'Meilleur film'],
      [/^outstanding british film$/i, 'Meilleur film britannique'],
      [/^best director$/i, 'Meilleure réalisation'],
      [/not in the english language/i, 'Meilleur film en langue étrangère'],
      [/^best animated film$/i, "Meilleur film d'animation"],
    ],
  },
};

// ---------- Lecture du wikitexte ----------

const linkLabel = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
const plain = (s) => linkLabel(s).replace(/<[^>]+>/g, '').replace(/'{2,}/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
const cleanTarget = (t) => {
  const s = t.split('#')[0].replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

// Films cités : liens en italique, ''[[Film]]'' ou [[Film|''Titre'']].
export function filmLinks(text) {
  const out = [];
  // 2 ou 5 apostrophes = italique (3 = gras seul, ce sont des personnes).
  const re = /(?<!')(?:'''''|'')(?!')\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|\[\[([^\]|]+)\|\s*''[^\]]*''\s*\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const t = cleanTarget(m[1] || m[2]);
    if (t && !/^(file|image|category|list of)\b/i.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

export function sections(wikitext) {
  const out = [{ level: 1, title: '', body: '' }];
  for (const line of String(wikitext).split('\n')) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (h) out.push({ level: h[1].length, title: plain(h[2]), body: '' });
    else out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

// Sous-sections d'une section (jusqu'au prochain titre de même niveau ou plus haut).
const childrenOf = (secs, i) => {
  const res = [];
  for (let k = i + 1; k < secs.length && secs[k].level > secs[i].level; k++) res.push(secs[k]);
  return res;
};
const fullBody = (secs, i) => secs[i].body + childrenOf(secs, i).map((s) => s.body).join('');

// Premier « : » hors des liens et modèles : sépare le nom du prix du lauréat.
const colonAt = (l) => {
  let depth = 0;
  for (let i = 0; i < l.length; i++) {
    const two = l.slice(i, i + 2);
    if (two === '[[' || two === '{{') (depth += 1), (i += 1);
    else if (two === ']]' || two === '}}') (depth -= 1), (i += 1);
    else if (l[i] === ':' && depth === 0) return i;
  }
  return -1;
};

// Lignes de tableau ou de liste seulement (pas les phrases d'introduction).
const rows = (body) => body.split('\n').filter((l) => /^\s*[|*!]/.test(l)).join('\n');

const awardName = (fest, label) => fest.awards.findIndex(([re]) => re.test(label));

export function parseFestival(festKey, wikitext) {
  const fest = FESTIVALS[festKey];
  const secs = sections(wikitext);
  const isComp = (t) => /competition|venezia \d+/i.test(t) && !/out of|short|immersive|orizzonti|juries?/i.test(t);

  // Sélection : la compétition principale, dans la partie « Official Selection ».
  let selection = [];
  const off = secs.findIndex((s) => s.level === 2 && /official (selection|sections?)|^selection/i.test(s.title));
  if (off !== -1) {
    const kids = childrenOf(secs, off);
    const comp = kids.find((s) => isComp(s.title));
    selection = filmLinks(rows(comp ? comp.body : secs[off].body));
  }
  if (!selection.length) {
    const comp = secs.find((s) => isComp(s.title) && !/award|jur/i.test(s.title) && filmLinks(rows(s.body)).length > 5);
    if (comp) selection = filmLinks(rows(comp.body));
  }

  // Palmarès : puces « Prix : film » de la partie « Awards ».
  const winners = [];
  const seen = new Set();
  const add = (k, films) => {
    for (const f of films) {
      const key = `${k}|${f}`;
      if (seen.has(key)) continue;
      seen.add(key);
      winners.push({ title: f, award: fest.awards[k][1], rank: k });
    }
  };
  const aw = secs.findIndex((s) => s.level === 2 && /awards/i.test(s.title) && !/independent|other|parallel/i.test(s.title));
  if (aw !== -1) {
    const kids = childrenOf(secs, aw);
    const main = kids.find((s) => isComp(s.title) || /official selection/i.test(s.title));
    const lines = (main ? main.body : secs[aw].body).split('\n');
    for (let n = 0; n < lines.length; n++) {
      const l = lines[n];
      if (!/^\*(?!\*)/.test(l)) continue;
      const colon = colonAt(l);
      const label = plain(colon > 0 ? l.slice(1, colon) : l.slice(1));
      const k = awardName(fest, label);
      if (k === -1) continue;
      let films = filmLinks(colon > 0 ? l.slice(colon + 1) : '');
      for (let j = n + 1; !films.length && j < lines.length && /^\*\*/.test(lines[j]); j++) films = filmLinks(lines[j]);
      // Prix partagés : toutes les sous-puces.
      for (let j = n + 1; j < lines.length && /^\*\*/.test(lines[j]); j++) films = [...new Set([...films, ...filmLinks(lines[j])])];
      add(k, films);
    }
    const camera = kids.find((s) => /cam[ée]ra d'or/i.test(s.title));
    const k = awardName(fest, "Caméra d'Or");
    if (camera && k !== -1) add(k, filmLinks(camera.body).slice(0, 1));
  }
  winners.sort((a, b) => a.rank - b.rank);
  return { winners: winners.map(({ title, award }) => ({ title, award })), selection };
}

export function parseCeremony(festKey, wikitext) {
  const fest = FESTIVALS[festKey];
  const parts = String(wikitext).split(/\{\{\s*Award category\s*\|/i).slice(1);
  const winners = [];
  let selection = [];
  for (const part of parts) {
    const end = part.indexOf('}}');
    const head = part.slice(0, end);
    const label = plain(head.split('|').slice(1).join('|') || head);
    const k = awardName(fest, label);
    if (k === -1) continue;
    const lines = part.slice(end + 2).split('\n');
    const films = [];
    let winner = null;
    for (const l of lines) {
      if (/^\s*\|/.test(l)) break; // cellule suivante du tableau
      if (!/^\*/.test(l)) continue;
      const f = filmLinks(l)[0];
      if (!f) continue;
      if (!winner && /^\*(?!\*)/.test(l)) winner = f;
      if (!films.includes(f)) films.push(f);
    }
    if (winner && !winners.some((w) => w.award === fest.awards[k][1])) winners.push({ title: winner, award: fest.awards[k][1], rank: k });
    if (k === 0 && !selection.length) selection = films;
  }
  winners.sort((a, b) => a.rank - b.rank);
  return { winners: winners.map(({ title, award }) => ({ title, award })), selection };
}

// ---------- Articles Wikipédia -> identifiants TMDB ----------

async function getJson(url, fetchImpl, accept = 'application/json') {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout?.(7000) });
  if (!r.ok) throw new Error(`Source indisponible (${r.status})`);
  return r.json();
}

export async function wikitextOf(title, fetchImpl = fetch) {
  const qs = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' });
  const d = await getJson(`${WIKI}?${qs}`, fetchImpl);
  if (d.error) return null; // pas encore de page pour cette édition
  return d.parse?.wikitext || null;
}

// Titres d'articles -> Map(titre -> élément Wikidata), redirections comprises.
export async function wikidataIds(titles, fetchImpl = fetch) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const qs = new URLSearchParams({ action: 'query', titles: batch.join('|'), redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item', format: 'json', formatversion: '2' });
    const d = await getJson(`${WIKI}?${qs}`, fetchImpl);
    const hop = new Map([...(d.query?.normalized || []), ...(d.query?.redirects || [])].map((x) => [x.from, x.to]));
    const qid = new Map((d.query?.pages || []).filter((p) => p.pageprops?.wikibase_item).map((p) => [p.title, p.pageprops.wikibase_item]));
    for (const t of batch) {
      let cur = t;
      for (let n = 0; n < 3 && hop.has(cur); n++) cur = hop.get(cur);
      if (qid.has(cur)) out.set(t, qid.get(cur));
    }
  }
  return out;
}

export async function tmdbIds(qids, fetchImpl = fetch) {
  const out = new Map();
  const list = [...new Set(qids)];
  if (!list.length) return out;
  const q = `SELECT ?item ?tmdb WHERE { VALUES ?item { ${list.map((x) => `wd:${x}`).join(' ')} } ?item wdt:P4947 ?tmdb . }`;
  const d = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, fetchImpl, 'application/sparql-results+json');
  for (const b of d.results?.bindings || []) {
    const id = b.item.value.split('/').pop();
    if (!out.has(id)) out.set(id, Number(b.tmdb.value));
  }
  return out;
}

export async function festivalYear(festKey, year, fetchImpl = fetch) {
  const fest = FESTIVALS[festKey];
  if (!fest) throw new Error('Festival inconnu');
  const text = await wikitextOf(fest.page(Number(year)), fetchImpl);
  if (!text) return { winners: [], selection: [] };
  const parsed = fest.kind === 'ceremony' ? parseCeremony(festKey, text) : parseFestival(festKey, text);
  const titles = [...new Set([...parsed.winners.map((w) => w.title), ...parsed.selection])];
  const qids = await wikidataIds(titles, fetchImpl);
  const tmdb = await tmdbIds([...qids.values()], fetchImpl);
  const idOf = (t) => tmdb.get(qids.get(t)) || null;
  const winners = parsed.winners.map((w) => ({ tmdb: idOf(w.title), award: w.award })).filter((w) => w.tmdb);
  const selection = [...new Set(parsed.selection.map(idOf).filter(Boolean))];
  return { winners, selection };
}

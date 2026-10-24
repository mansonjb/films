// Règles de modification de la liste, séparées pour pouvoir les tester.

const MOVIE_FIELDS = ['id', 'title', 'original_title', 'poster_path', 'backdrop_path', 'release_date', 'vote_average', 'genre_ids', 'overview'];

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

export function applyAction(list, body) {
  const items = [...(list.items || [])];
  const { action, movieId, by } = body;
  const idx = items.findIndex((i) => i.id === Number(movieId ?? body.movie?.id));

  switch (action) {
    case 'add': {
      const movie = body.movie;
      if (!movie?.id) fail('Film manquant');
      if (idx !== -1) return { items };
      const item = Object.fromEntries(MOVIE_FIELDS.filter((f) => movie[f] !== undefined).map((f) => [f, movie[f]]));
      items.unshift({ ...item, addedBy: by || '?', addedAt: new Date().toISOString(), wants: by ? [by] : [], status: 'todo', ratings: {}, note: '' });
      return { items };
    }
    case 'remove':
      if (idx === -1) fail('Film introuvable', 404);
      items.splice(idx, 1);
      return { items };
    case 'toggleWant': {
      if (idx === -1) fail('Film introuvable', 404);
      if (!by) fail('Prénom manquant');
      const wants = new Set(items[idx].wants || []);
      wants.has(by) ? wants.delete(by) : wants.add(by);
      items[idx] = { ...items[idx], wants: [...wants] };
      return { items };
    }
    case 'setStatus': {
      if (idx === -1) fail('Film introuvable', 404);
      const status = body.status === 'seen' ? 'seen' : 'todo';
      items[idx] = { ...items[idx], status, seenAt: status === 'seen' ? new Date().toISOString() : undefined };
      return { items };
    }
    case 'rate': {
      if (idx === -1) fail('Film introuvable', 404);
      if (!by) fail('Prénom manquant');
      const ratings = { ...(items[idx].ratings || {}) };
      const value = Number(body.value);
      if (value >= 1 && value <= 5) ratings[by] = value;
      else delete ratings[by];
      items[idx] = { ...items[idx], ratings };
      return { items };
    }
    case 'note': {
      if (idx === -1) fail('Film introuvable', 404);
      items[idx] = { ...items[idx], note: String(body.note || '').slice(0, 500) };
      return { items };
    }
    default:
      fail('Action inconnue');
  }
}

# Nos films

Web app (PWA) de watchlist familiale, pensée pour l'iPhone :

- **Liste partagée** : chacun ajoute des films, coche « je veux le voir », marque « vu », note et laisse un mot.
- **Streaming** : sur quelles plateformes le film est dispo en France (abonnement, location, achat), avec vos abonnements mis en avant.
- **Cinéma** : films à l'affiche, sorties à venir par mois, et **séances du jour dans vos cinémas** (Allociné).
- **Fiche complète** : synopsis, durée, âge conseillé, note, réalisateur, casting, bande-annonce, dates de sortie salles / VOD / DVD, films similaires.

Données : [TMDB](https://www.themoviedb.org/) (plateformes fournies par JustWatch) et Allociné pour les séances.
Allociné n'a pas d'API officielle : si son site change, les séances peuvent cesser de s'afficher (le lien « Voir sur Allociné » reste toujours là).

## Mise en ligne (Vercel)

1. Sur [vercel.com/new](https://vercel.com/new), importer ce repo et cliquer **Deploy** (aucun réglage à changer).
2. Dans le projet Vercel : **Storage → Create Database → Upstash (Redis)**, puis la connecter au projet. C'est ce qui stocke la liste partagée.
3. Redéployer (Deployments → ⋯ → Redeploy).

Variables d'environnement facultatives :

| Variable | Rôle |
| --- | --- |
| `FAMILY_CODE` | Code demandé à l'ouverture de l'app, pour que seule la famille modifie la liste. |
| `TMDB_API_KEY` / `TMDB_READ_TOKEN` | Remplace la clé TMDB par défaut. |

## Installer sur l'iPhone

Ouvrir l'adresse dans Safari → bouton Partager → « Sur l'écran d'accueil ».

## Ajouter un cinéma

Dans l'app, Réglages → Mes cinémas : coller le lien de la page Allociné du cinéma (il contient `csalle=`).

## En local

```bash
npm run dev   # http://localhost:3000 (la liste est stockée dans .data/)
npm test
```

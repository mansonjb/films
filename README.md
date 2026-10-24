# Nos films

Web app (PWA) de watchlist familiale, pensée pour l'iPhone :

- **Liste partagée** : chacun ajoute des films, coche « je veux le voir », marque « vu », note et laisse un mot.
- **Streaming** : sur quelles plateformes le film est dispo en France (abonnement, location, achat), avec vos abonnements mis en avant.
- **Cinéma** : films à l'affiche, sorties à venir par mois, et **séances du jour dans vos cinémas** (Allociné).
- **Pour vous** : recommandations calculées à partir de la liste (envies, films vus et leurs notes, films écartés) : à voir sur vos plateformes, bientôt au cinéma, à l'affiche, « parce que vous avez aimé… ».
- **Streaming par plateforme** : tout le catalogue d'une plateforme (populaires, nouveautés, mieux notés, par genre) et les sorties VOD à venir.
- **Explorer** : recherche de films et de personnes, thèmes (en famille, histoires vraies, super-héros, voyage dans le temps…).
- **Fiche complète** : notes SensCritique / TMDB / famille, synopsis, durée, âge conseillé, équipe et casting cliquables, thèmes, bande-annonce, dates de sortie salles / VOD / DVD, films similaires.
- **Fiche personne** : biographie, films à venir, filmographie (réalisation, rôles, scénario), films de la liste.

Données : [TMDB](https://www.themoviedb.org/) (plateformes fournies par JustWatch), Allociné pour les séances, SensCritique pour la note.
Allociné et SensCritique n'ont pas d'API officielle : si leur site change, séances ou notes peuvent cesser de s'afficher (les liens vers leurs pages restent toujours là).

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

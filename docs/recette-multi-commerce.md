# Recette manuelle — multi-commerce

À dérouler sur un environnement de recette (jamais la production) avant
d'accueillir un second pilote. Les tests automatisés couvrent l'API, l'admin,
le sync et la logique hors ligne ; ce scénario vérifie ce qu'eux ne voient
pas : un vrai navigateur, IndexedDB, le service worker, un redémarrage.

Durée : environ 45 minutes. Cocher chaque ligne ; une seule case non cochée
bloque l'accueil du second pilote.

## 0. Préparation

```bash
python backend/manage.py create_pilot --name "Recette A" --store "Magasin A" --owner a.awa --owner-first-name Awa
python backend/manage.py create_pilot --name "Recette B" --store "Magasin B" --owner b.moussa --owner-first-name Moussa
```

- [ ] Noter les deux mots de passe temporaires.
- [ ] Admin en **A** (`a.awa`) : créer un caissier `a.fatou` (rôle Caissier,
      affecté à Magasin A), deux produits avec code-barres, un stock, un client
      avec téléphone `77 000 00 01`.
- [ ] Admin en **B** (`b.moussa`) : pareil (`b.ibou`, deux produits dont un
      avec **le même code-barres** qu'un produit de A, un client avec **le
      même téléphone**).
- [ ] Navigateur 1 (profil Chrome dédié) = poste A ; navigateur 2 (autre
      profil, ou Firefox) = poste B.

## 1. Chaque commerce seul au monde (§97)

Sur chaque poste, en ligne, avec son caissier :

- [ ] Ouvrir la caisse : seul son magasin et sa caisse sont proposés.
- [ ] Vendre en espèces, en Wave, et une vente **à crédit** à son client.
- [ ] Faire un retour sur une vente, saisir une dépense, encaisser un
      remboursement client.
- [ ] Historique des ventes, cahier clients, dépenses : seulement ses données.
- [ ] Le code-barres partagé scanne **son** produit ; le client au même
      téléphone est **le sien**.

Dans l'admin, propriétaire A puis propriétaire B :

- [ ] Tableau de bord, ventes, stock, valorisation, clients, dépenses,
      utilisateurs, filtres latéraux, autocomplétions : jamais l'autre commerce.
- [ ] Le lien « Organisations » n'apparaît pas.

## 2. Identifiants croisés (§97)

Récupérer dans l'admin de B l'identifiant (URL) d'une vente, d'un client,
d'une dépense et d'un produit de B. Connecté en A :

- [ ] `/admin/sales/sale/<id B>/change/` → renvoie vers l'accueil (« n'existe pas »).
- [ ] Même chose pour le client, la dépense, le produit.
- [ ] `/admin/auth/user/<id b.ibou>/password/` → introuvable.
- [ ] Dans la console du navigateur (poste A, connecté) :
      `fetch("/api/v1/customers/<id client B>/", {credentials: "include"}).then(r => r.status)` → `404`.

## 3. Déconnexion puis autre commerce (§98)

Sur le poste A :

- [ ] Se connecter en `a.fatou`, ouvrir la caisse, charger le catalogue,
      ouvrir le cahier clients (le cache local se remplit).
- [ ] Faire **une vente, puis la laisser se synchroniser** (bandeau à jour).
- [ ] Se déconnecter.
- [ ] Couper le réseau (DevTools › Network › Offline) et recharger : l'app
      demande une connexion — **pas** de caisse de `a.fatou`.
- [ ] Rétablir le réseau, se connecter en `b.ibou` (commerce B) sur ce même poste.
- [ ] Aucune trace de A : catalogue, clients, paniers suspendus, historique,
      caisse proposée. DevTools › Application › IndexedDB › `PosDatabase` :
      aucune ligne de A ; `localStorage` : aucune clé `lopos.*` de A.

## 4. Même test après fermeture complète du navigateur (§99)

- [ ] Refaire l'étape 3 en **quittant complètement** le navigateur entre la
      déconnexion de A et la connexion de B (et entre la coupure réseau et
      le rechargement).

## 5. Vente en attente puis autre commerce (§100)

Sur un poste lié à A :

- [ ] Connecté en `a.fatou`, couper le réseau, faire **deux ventes hors ligne**
      (bandeau « en attente »).
- [ ] Rétablir le réseau **sans laisser le sync partir** (rester sur l'écran,
      ou couper juste après) puis se déconnecter si possible ; sinon fermer le
      navigateur, rouvrir en ligne sur l'écran de connexion.
- [ ] Tenter de se connecter en `b.ibou` : refus « Poste réservé à un autre
      commerce », la connexion n'aboutit pas.
- [ ] Admin B : **aucune** vente de A n'est apparue chez B.
- [ ] Se reconnecter en `a.fatou` : les deux ventes partent ; elles
      apparaissent chez A, dans la bonne session.
- [ ] Maintenant que rien n'attend, `b.ibou` peut se connecter sur ce poste,
      qui repart vide.

## 6. Rôles

- [ ] Gérant de A sans « voit les coûts et marges » : ni Valorisation, ni
      Journal des coûts, ni carte de rentabilité, ni coût sur une fiche de
      ligne de vente ou de mouvement de stock.
- [ ] Même gérant avec la case cochée : il les voit.
- [ ] Gérant : pas de lien « Utilisateurs », ni création de magasin/caisse.
- [ ] Caissier : `/admin/` le renvoie vers la connexion.

## 7. Suspension

- [ ] Admin plateforme › Organisations › « Suspendre » sur A.
- [ ] Poste A en ligne : la requête suivante renvoie à la connexion ;
      connexion refusée (« accès suspendu ») ; admin A fermé.
- [ ] Une vente faite hors ligne pendant la suspension reste en attente.
- [ ] « Réactiver » : connexion de nouveau possible, la vente en attente part.

## 8. Clôture

```bash
python backend/manage.py tenancy_check   # « Aucune donnée ne relie deux commerces. »
python backend/manage.py tenancy_audit   # aucun point d'attention inattendu
```

- [ ] Les deux commandes sont propres.
- [ ] Sentry : les erreurs éventuelles portent `organization_id`, sans nom ni
      téléphone de client.

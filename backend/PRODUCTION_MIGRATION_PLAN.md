# Plan De Mise En Production

Objectif : integrer les evolutions du backend de dev dans le site existant `La goutte de mer - rendu photo` sans casser l'existant.

## Constat Actuel

- Le site existant contient deja son backend dans `C:\Users\yass-\OneDrive\Documents\La goutte de mer - rendu photo\backend`.
- Le front existant pointe vers `https://la-goutte-de-mer-paiements.onrender.com` via `assets/js/checkout-config.js`.
- Le backend de dev `C:\Users\yass-\OneDrive\Documents\friperie-dev-backend` contient des evolutions absentes du backend actif :
  - gestion des options de livraison
  - integration Sendcloud
  - endpoint etiquette de livraison
  - suivi de livraison
  - facture HTML enrichie
  - correctifs des pieces jointes email
  - ajustements Stripe pour inclure la livraison

## Regle De Securite

Ne pas remplacer le backend actuel en une seule fois.

Strategie retenue :

1. preparer une version parallele du backend
2. tester cette version avec les vraies variables de prod sur une URL separee
3. basculer le front seulement quand les tests sont valides

## Etape 1 - Sauvegarde Et Inventaire

- Sauvegarder le dossier `La goutte de mer - rendu photo/backend`
- Sauvegarder le fichier `.env` du backend actuellement deploye
- Lister les variables utilisees en production :
  - PayPal
  - Stripe
  - Resend
  - Sendcloud
  - URLs du site et du backend
- Verifier ou sont stockees les commandes de prod : `data/orders.json`
- Verifier si le catalogue ecrit bien dans le bon CSV de prod

## Etape 2 - Comparaison Des Ecarts

Ecarts deja identifies entre dev et backend actif :

- `src/config.mjs`
  - nouvelles variables `shipping` et `sendcloud`
- `src/server.mjs`
  - nouveaux endpoints livraison et Sendcloud
- `src/lib/order-service.mjs`
  - logique de selection livraison
  - creation de shipment
  - suivi d'etat livraison
- `src/lib/sendcloud.mjs`
  - nouveau module complet
- `src/lib/mailer.mjs`
  - liens de suivi / etiquette
  - emails livraison
- `src/lib/invoice.mjs`
  - livraison sur facture
  - version client / vendeur
  - correctifs d'affichage mobile
- `src/lib/json-store.mjs`
  - recherche par `parcelId`
- `src/lib/stripe.mjs`
  - ajout des frais de livraison dans la session Stripe

## Etape 3 - Strategie De Deploiement Sans Risque

Option recommandee :

1. deployer un second service backend Render de test
2. y injecter les variables de production
3. desactiver si besoin les envois reels au tout debut avec `EMAIL_MODE=log`
4. tester les endpoints un par un
5. tester ensuite un vrai parcours de commande controle
6. basculer le front vers la nouvelle URL backend
7. garder l'ancien backend disponible pendant la periode d'observation

## Etape 4 - Ordre De Verification

Avant bascule front :

1. `GET /api/health`
2. `GET /api/catalog/availability`
3. `POST /api/shipping/options`
4. creation commande PayPal
5. capture PayPal
6. creation session Stripe
7. retour Stripe
8. generation facture
9. email client
10. email vendeur
11. endpoint etiquette : `GET /api/orders/:orderNumber/shipping-label`
12. webhook Sendcloud

## Etape 5 - Bascule Front

Fichier sensible :

- `C:\Users\yass-\OneDrive\Documents\La goutte de mer - rendu photo\assets\js\checkout-config.js`

Changement minimal a faire au moment de la bascule :

- remplacer `backend.baseUrl` par l'URL du nouveau backend validee

Important :

- ne rien changer d'autre dans le front pendant la bascule
- faire ce changement seul, dans un commit dedie

## Etape 6 - Observation Apres Mise En Ligne

- verifier la creation des commandes
- verifier l'ecriture du stock
- verifier les emails reels
- verifier les factures jointes sur mobile
- verifier le suivi livraison
- verifier l'etiquette vendeur
- surveiller les logs Render, PayPal, Stripe, Resend et Sendcloud

## Premiere Action Recommandee

La prochaine etape la plus sure est :

1. comparer les fichiers `.env` dev et prod
2. preparer la liste exacte des variables a ajouter pour la nouvelle version
3. verifier si la prod actuelle dispose deja de credentials Sendcloud

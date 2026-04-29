# Gestion des articles

Les pages `hommes.html`, `femmes.html` et `accessoires.html` affichent les articles depuis un fichier CSV.

## Option simple : Excel

1. Ouvre ou modifie le fichier `assets/data/products.csv`.
2. Garde exactement ces colonnes :

```csv
id,categorie,nom,taille,prix,promo,selection_moment,description,photos,statut
```

3. Valeurs attendues :

- `categorie` : `hommes`, `femmes` ou `accessoires`
- `taille` : facultatif, par exemple `S`, `M`, `38`, `Taille unique`
- `prix` : prix normal
- `promo` : nouveau prix promotionnel, laisse vide s'il n'y a pas de promo
- `selection_moment` : mets `oui` pour afficher l'article sur l'accueil, laisse vide sinon
- `description` : description courte de l'article
- `photos` : une ou plusieurs photos separees par `;` ou `|`
- `statut` : par exemple `disponible`, `reserve`, `vendu`

Exemple :

```csv
hom-003,hommes,Veste bleu marine,M,"95,00 EUR","75,00 EUR",oui,"Veste vintage en tres bon etat.","assets/images/veste-1.jpg; assets/images/veste-2.jpg",disponible
```

Si `promo` est rempli, le site affiche le prix initial barre et le prix promo a cote. Si `promo` est vide, seul le prix initial est affiche.

Si `taille` est vide, le site n'affiche simplement pas cette information.

## Compatibilite avec le fichier en ligne

Le site reste compatible si la colonne `taille` n'existe pas encore dans le CSV en ligne.

Quand le vendeur sera pret, il pourra ajouter manuellement une colonne `taille` dans son CSV ou dans sa feuille Google Sheets, puis renseigner les valeurs sans autre modification technique.

## Option Google Sheets

1. Cree une feuille Google Sheets avec les memes colonnes.
2. Si la feuille existe deja, ajoute simplement une colonne `taille`.
3. Va dans `Fichier > Partager > Publier sur le web`.
4. Choisis le format `CSV`.
5. Copie l'URL publiee.
6. Dans chaque page categorie, remplace :

```html
window.PRODUCTS_SOURCE_URL = "assets/data/products.csv";
```

par :

```html
window.PRODUCTS_SOURCE_URL = "https://docs.google.com/spreadsheets/d/e/TON_URL/pub?output=csv";
```

## Photos

Tu peux utiliser :

- des images locales dans `assets/images/`
- des URLs publiques d'images
- plusieurs photos avec `;` ou `|`

Exemple :

```csv
photos
assets/images/sac-1.jpg; assets/images/sac-2.jpg; https://example.com/sac-3.jpg
```

Les miniatures apparaissent sous la photo principale et permettent de changer l'image affichee.

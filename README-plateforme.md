# Plateforme d'outils Gaz de Bordeaux — guide du référent

Cette plateforme est un **site statique** : des fichiers HTML/CSS/JS, sans base de
données ni serveur. C'est ce qui la rend gratuite à héberger, robuste, et simple à
faire évoluer. La contrepartie : **on ne peut pas "uploader" un outil depuis le site
lui-même** (un site statique ne reçoit pas de fichiers). L'ajout passe donc par un
**référent** (vous) qui dépose le fichier et redéploie. C'est aussi ce qui garantit
la qualité : rien n'arrive en ligne sans un regard humain.

**Nouveau :** chaque carte de la page d'accueil est construite **automatiquement** à
partir de l'en-tête `<!-- OUTIL ... -->` présent dans le fichier de l'outil. Vous
n'avez plus rien à recopier — juste à déclarer le nom du fichier.

---

## Le circuit, en une phrase

> Un salarié fabrique un artefact dans Claude → il vous l'envoie → vous le validez,
> le déposez et redéployez → il apparaît pour tout le monde.

---

## Ajouter un outil (3 étapes)

1. **Déposer le fichier** de l'outil dans le dossier `outils/`
   (ex. `outils/renommeur-factures.html`). Le fichier doit contenir son en-tête
   `<!-- OUTIL ... -->` (voir prompt plus bas) — c'est lui qui remplit la carte.

2. **Déclarer le fichier** dans `catalogue.js` : ajoutez **son nom** dans la liste
   `tools`. Une seule ligne :

   ```js
   tools: [
     "pdf-splitter.html",
     "renommeur-factures.html",     // <-- la ligne ajoutée
     ...
   ]
   ```

3. **Redéployer** : reglissez le zip/dossier sur https://app.netlify.com/drop
   (ou `git push` si le site est relié à un dépôt). En ligne en quelques secondes.

C'est tout. Titre, description, catégorie et pastille « IA » sont lus dans le fichier.

### Afficher un outil « à venir » (pas encore de fichier)

Mettez un objet au lieu d'un nom de fichier :

```js
{ soon: true, category: "XLS", title: "Metteur en forme Excel",
  description: "Nettoie et met en forme un export Excel selon un gabarit." }
```

Il apparaît grisé (« Bientôt »), non cliquable. Ajoutez `ia: true` s'il nécessitera
un modèle d'IA.

---

## Ce qu'un salarié doit vous envoyer

Uniquement **le fichier `.html`** de son artefact, **avec son en-tête OUTIL**. Pour
que ce soit systématique, diffusez-leur le prompt ci-dessous : ils l'utilisent pour
finaliser leur artefact dans Claude.

### Prompt standardisé (à diffuser aux salariés)

> Finalise cet artefact pour qu'il puisse être ajouté à notre plateforme d'outils interne.
> Contraintes impératives :
> - Un **seul fichier HTML autonome**. Tout le CSS et le JavaScript sont inline dans ce
>   fichier. **Aucun appel à un CDN ou à une ressource externe** (pas de `<script src="https://...">`,
>   pas de police distante) : tout doit fonctionner hors-ligne.
> - Interface **en français**, sobre et lisible, utilisable sans notice.
> - Le **traitement se fait dans le navigateur** (aucune donnée envoyée sur un serveur).
>   Si l'outil a besoin d'un modèle d'IA pour fonctionner, indique `ia: oui` dans l'en-tête
>   ci-dessous et signale-le-moi (il faudra passer par le référent).
> - Ajoute tout en haut du fichier, juste après `<!DOCTYPE html>`, ce bloc de commentaire,
>   exactement sous cette forme (c'est lui qui construit la fiche de l'outil sur la plateforme) :
>   ```
>   <!-- OUTIL
>        titre: <nom court de l'outil>
>        description: <une seule phrase : ce qu'il fait>
>        categorie: <PDF | XLS | DATA | AUTRE>
>        ia: <oui | non>
>   -->
>   ```
> - Gère les cas d'erreur avec un message clair (mauvais fichier, champ manquant, etc.).
> Donne-moi le fichier final prêt à télécharger.

Les quatre champs alimentent directement la carte : `titre` → le nom affiché,
`description` → la phrase sous le titre, `categorie` → le code de référence
(`PDF · 01`, `XLS · 02`…), `ia` → la pastille « IA ». Un `ia: oui` ne doit **pas**
être mis en ligne tant que le backend à clé d'entreprise n'est pas en place.

> Si un fichier arrive **sans en-tête**, la plateforme l'affiche quand même mais avec
> la mention « ⚠ à vérifier » et le nom du fichier en guise de titre. Renvoyez-le au
> salarié (ou complétez l'en-tête vous-même).

---

## Avant de mettre en ligne : la checklist du référent

- [ ] Le fichier s'ouvre seul et fonctionne (testez-le).
- [ ] En-tête OUTIL présent, avec `ia: non` — sinon, il faut la fonction serveur.
- [ ] Aucune donnée sensible codée en dur (identifiants, clés, données clients).
- [ ] Aucun appel réseau externe (console du navigateur, onglet Réseau : rien ne
      doit sortir vers un domaine tiers).
- [ ] Nom de fichier explicite et sans espaces (`renommeur-factures.html`).

---

## Deux réglages utiles

- **Identité visuelle** (autre client, ou charte Gaz de Bordeaux officielle) : bloc `:root` en
  haut de `styles.css` — `--steel` (vert), `--signal` (orange flamme), `--paper`, `--ink`.
- **Textes de la page d'accueil** (nom, accroche) : bloc `brand` en haut de `catalogue.js`.

---

## Rappel important

La construction automatique des cartes **lit les fichiers d'outils** : ça ne
fonctionne que sur le site **hébergé** (Netlify), pas en double-clic local
(`file://`). Pour prévisualiser en local : `python3 -m http.server` puis
`http://localhost:8000`.

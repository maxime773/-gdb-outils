/* ============================================================
   CATALOGUE DE LA PLATEFORME — Gaz de Bordeaux
   ------------------------------------------------------------
   Chaque carte de la page d'accueil est construite AUTOMATIQUEMENT
   à partir de l'en-tête <!-- OUTIL ... --> présent dans le fichier
   de l'outil. Vous n'avez donc pas à recopier titre / description.

   POUR AJOUTER UN OUTIL
     1. Déposez le fichier .html (avec son en-tête OUTIL) à la racine
     2. Ajoutez SON NOM DE FICHIER dans la liste "tools" ci-dessous
     3. Commit -> Netlify redéploie tout seul

   POUR MASQUER / RÉAFFICHER UN OUTIL
     Un outil masqué reste dans le dépôt : il n'apparaît simplement
     plus sur la page d'accueil. Pour le réafficher, retirez les //
     devant sa ligne (et vérifiez les virgules).
   ============================================================ */

window.ATELIER = {

  brand: {
    mark: "GdB",
    name: "Gaz de Bordeaux",
    tagline: "// boîte à outils interne",
    place: "Depuis 1875",
    heroEyebrow: "Automatisation documentaire",
    heroTitle: "Vos tâches répétitives, transformées en outils que vous <em>cliquez</em>.",
    heroLead: "Chaque outil fait une chose, bien. Vous déposez un fichier, vous récupérez le résultat — sans quitter votre navigateur.",
    heroAssurance: "Traitement 100 % local. Vos documents ne quittent pas votre poste."
  },

  tools: [

    // ---- Présentation Direction générale : les 4 outils métier ----
    "analyse-hc-hp.html",      // DATA · 01
    "compte-client.html",      // DATA · 02
    "facture-energie.html",    // DATA · 03
    "auto-mail.html"           // DATA · 04

    // ---- Outils masqués pour la présentation ----
    // Les fichiers restent dans le dépôt, ils ne s'affichent plus.
    // Pour les réafficher : ajouter une virgule après "auto-mail.html"
    // ci-dessus, puis retirer les // des lignes voulues.
    // ,
    // "gestion-contact.html",
    // "pdf-splitter.html",
    // "pdf-fusion.html",
    // "pdf-dataviz.html",
    // "excel-formatter.html",
    // "excel-remplacement.html"

  ]
};

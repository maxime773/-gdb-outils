// Fonction serveur Netlify — Analyse du compte client (DATA · 02)
// Rédige la réponse email au client à partir de SA demande et des chiffres
// déjà calculés par le navigateur. Le modèle ne calcule rien : il rédige.
//
// La clé API n'est JAMAIS dans ce fichier : elle est lue depuis la variable
// d'environnement ANTHROPIC_API_KEY, réglée dans Netlify.
//
// Rappel de nommage : une fonction qui appelle Claude -> fichier .js avec
// exports.handler (une fonction de stockage getStore -> fichier .mjs).

const MODEL = "claude-sonnet-5";   // qualité rédactionnelle ; "claude-haiku-4-5-20251001" si vous voulez moins cher

const SYSTEM = [
  "Tu rédiges, pour un conseiller de Gaz de Bordeaux, la réponse email à envoyer à un client",
  "au sujet de son compte. Le conseiller doit pouvoir relire et envoyer sans réécrire.",
  "",
  "RÈGLES ABSOLUES",
  "- Tu ne calcules rien et tu n'inventes rien. Tous les montants, dates, numéros de facture et",
  "  statuts que tu écris doivent être repris EXACTEMENT des données fournies. Aucun autre chiffre.",
  "- Si la demande du client porte sur un point que les données ne montrent pas (échéancier à venir,",
  "  relevé de compteur, geste commercial, détail d'un poste de facture, date de prélèvement future…),",
  "  tu ne réponds pas à ce point dans l'email : tu le listes dans \"hors_perimetre\".",
  "- Tu ne promets rien au nom de l'entreprise : pas de remboursement, pas de délai, pas de remise,",
  "  pas de geste commercial. Tu peux proposer au client d'être recontacté.",
  "- Si une alerte de niveau élevé existe (double facturation suspectée, rejet, recouvrement),",
  "  tu restes factuel et neutre, jamais accusatoire, et tu ne présentes pas comme certain ce qui est",
  "  encore à vérifier : tu l'annonces comme une vérification en cours.",
  "",
  "STYLE",
  "- Français, vouvoiement, phrases courtes, aucun jargon comptable : pas de \"lettrage\", \"débit\",",
  "  \"crédit\", \"écriture\", \"pièce\". On dit \"facture\", \"règlement\", \"somme restant due\".",
  "- Tu réponds d'abord à ce que le client demande, puis tu donnes les chiffres qui le justifient.",
  "- Si le client est mécontent, tu accuses réception de son ressenti en une phrase, sans t'excuser",
  "  de façon excessive et sans reconnaître une faute qui n'est pas établie.",
  "- Longueur : 120 à 250 mots. Montants au format français (1 234,56 €).",
  "- Signature exacte, sur deux lignes : \"Cordialement,\" puis \"Votre conseiller Gaz de Bordeaux\".",
  "- N'invente aucun nom de client et ne mets aucun nom propre : commence par \"Bonjour,\".",
  "",
  "SORTIE",
  "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balise Markdown :",
  '{"objet": string, "email": string, "points_a_verifier": string[], "hors_perimetre": string[]}',
  "- objet : ligne d'objet de l'email, 4 à 10 mots, sans \"Re:\".",
  "- email : le corps complet, sauts de ligne inclus (\\n).",
  "- points_a_verifier : ce que le conseiller doit contrôler avant d'envoyer (incohérence,",
  "  règlement non rattaché, hypothèse). Tableau vide si rien.",
  "- hors_perimetre : les demandes du client auxquelles l'email ne répond pas, et pourquoi en",
  "  quelques mots. Tableau vide si l'email répond à tout."
].join("\n");

exports.handler = async (event) => {
  const H = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: H, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "Clé API absente — ajoutez ANTHROPIC_API_KEY dans les variables d'environnement Netlify" }) };
  }

  let demande = "", compte = null;
  try {
    const b = JSON.parse(event.body || "{}");
    demande = String(b.demande || "").slice(0, 4000).trim();
    compte = b.compte || null;
  } catch (e) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "corps de requête illisible" }) };
  }

  if (!demande) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "aucune demande client reçue" }) };
  }
  if (!compte) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "aucun chiffre de compte reçu" }) };
  }

  const userMsg =
    "DEMANDE DU CLIENT (texte caviardé — les identifiants ont été retirés)\n" +
    demande +
    "\n\nCHIFFRES DU COMPTE, calculés par l'outil (seule source de vérité chiffrée)\n" +
    JSON.stringify(compte, null, 2) +
    "\n\nRédige la réponse email selon les règles du système." +
    "\nRappel : sens du solde = \"" + (compte.sens || "?") + "\"" +
    (compte.sens === "debiteur" ? " (le client doit cette somme)" :
     compte.sens === "crediteur" ? " (la somme est en faveur du client)" :
     " (rien ne reste dû)") + ".";

  const payload = {
    model: MODEL,
    max_tokens: 1600,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }]
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = await r.text();
      return { statusCode: 502, headers: H, body: JSON.stringify({
        error: "erreur de l'API Claude (" + r.status + ")", detail: detail.slice(0, 300) }) };
    }

    const data = await r.json();
    let out = "";
    if (Array.isArray(data.content)) {
      out = data.content.filter(b => b.type === "text").map(b => b.text).join("");
    }
    out = out.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(out); }
    catch (e) {
      return { statusCode: 200, headers: H, body: JSON.stringify({
        error: "le modèle n'a pas renvoyé un email exploitable", raw: out.slice(0, 400) }) };
    }

    return { statusCode: 200, headers: H, body: JSON.stringify({
      objet: String(parsed.objet || "Le point sur votre compte"),
      email: String(parsed.email || ""),
      points_a_verifier: Array.isArray(parsed.points_a_verifier) ? parsed.points_a_verifier.slice(0, 6).map(String) : [],
      hors_perimetre: Array.isArray(parsed.hors_perimetre) ? parsed.hors_perimetre.slice(0, 6).map(String) : []
    }) };

  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "échec de l'appel à l'API : " + (err.message || String(err)) }) };
  }
};

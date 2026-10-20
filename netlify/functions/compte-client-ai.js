// Fonction serveur Netlify — Analyse du compte client (DATA · 02)
// Rédige la réponse email au client à partir de SA demande et des chiffres
// déjà calculés par le navigateur. Le modèle ne calcule rien : il rédige.
//
// La clé API n'est JAMAIS dans ce fichier : elle est lue depuis la variable
// d'environnement ANTHROPIC_API_KEY, réglée dans Netlify.
//
// Rappel de nommage : une fonction qui appelle Claude -> fichier .js avec
// exports.handler (une fonction de stockage getStore -> fichier .mjs).
//
// v2 — la réponse est demandée via un OUTIL (tool use) et non en JSON libre :
// c'est l'API qui structure et valide la sortie, au lieu de nous demander de
// parser du texte. C'est ce qui corrige l'erreur "le modèle n'a pas renvoyé
// un email exploitable".

const MODEL = "claude-sonnet-5";   // qualité rédactionnelle
// Alternatives si besoin : "claude-sonnet-5-5" (plus récent), "claude-haiku-5-5" (moins cher).

const SYSTEM = [
  "Tu rédiges, pour un conseiller de Gaz de Bordeaux, la réponse email à envoyer à un client",
  "au sujet de son compte. Le conseiller doit pouvoir relire et envoyer sans réécrire.",
  "",
  "RÈGLES ABSOLUES",
  "- Tu ne calcules rien et tu n'inventes rien. Tous les montants, dates, numéros de facture et",
  "  statuts que tu écris doivent être repris EXACTEMENT des données fournies. Aucun autre chiffre.",
  "- Si la demande du client porte sur un point que les données ne montrent pas (échéancier à venir,",
  "  relevé de compteur, geste commercial, détail d'un poste de facture, date de prélèvement future…),",
  "  tu ne réponds pas à ce point dans l'email : tu le signales dans hors_perimetre.",
  "- Tu ne promets rien au nom de l'entreprise : pas de remboursement, pas de délai, pas de remise,",
  "  pas de geste commercial. Tu peux proposer au client d'être recontacté.",
  "- Si une alerte de niveau élevé existe (double facturation suspectée, rejet, recouvrement),",
  "  tu restes factuel et neutre, jamais accusatoire, et tu ne présentes pas comme certain ce qui est",
  "  encore à vérifier : tu l'annonces comme une vérification en cours.",
  "",
  "STYLE",
  "- Français, vouvoiement, phrases courtes, aucun jargon comptable : pas de « lettrage », « débit »,",
  "  « crédit », « écriture », « pièce ». On dit facture, règlement, somme restant due.",
  "- Tu réponds d'abord à ce que le client demande, puis tu donnes les chiffres qui le justifient.",
  "- Si le client est mécontent, tu accuses réception de son ressenti en une phrase, sans t'excuser",
  "  de façon excessive et sans reconnaître une faute qui n'est pas établie.",
  "- Longueur : 120 à 250 mots. Montants au format français (1 234,56 €).",
  "- Signature exacte, sur deux lignes : « Cordialement, » puis « Votre conseiller Gaz de Bordeaux ».",
  "- N'invente aucun nom de client et ne mets aucun nom propre : commence par « Bonjour, ».",
  "",
  "Tu réponds en appelant l'outil rediger_reponse, et uniquement par cet appel."
].join("\n");

const TOOL = {
  name: "rediger_reponse",
  description: "Transmet au conseiller la réponse email prête à relire, et ce qui reste à vérifier.",
  input_schema: {
    type: "object",
    properties: {
      objet: { type: "string", description: "Ligne d'objet de l'email, 4 à 10 mots, sans « Re: »." },
      email: { type: "string", description: "Corps complet de l'email, sauts de ligne compris, signature incluse." },
      points_a_verifier: {
        type: "array", items: { type: "string" },
        description: "Ce que le conseiller doit contrôler avant d'envoyer (incohérence, règlement non rattaché, hypothèse). Vide si rien."
      },
      hors_perimetre: {
        type: "array", items: { type: "string" },
        description: "Les demandes du client auxquelles l'email ne répond pas, et pourquoi en quelques mots. Vide si l'email répond à tout."
      }
    },
    required: ["objet", "email", "points_a_verifier", "hors_perimetre"]
  }
};

// Filet de sécurité : si jamais le modèle répond en texte plutôt qu'en appelant
// l'outil, on tente une lecture tolérante (bloc { } isolé, sauts de ligne bruts
// à l'intérieur des chaînes — la cause classique d'un JSON invalide).
function lectureTolerante(txt) {
  if (!txt) return null;
  let s = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) {}
  // échappe les sauts de ligne réels situés à l'intérieur d'une chaîne
  let out = "", dansChaine = false, echap = false;
  for (const c of s) {
    if (echap) { out += c; echap = false; continue; }
    if (c === "\\") { out += c; echap = true; continue; }
    if (c === '"') { dansChaine = !dansChaine; out += c; continue; }
    if (dansChaine && (c === "\n" || c === "\r")) { out += "\\n"; continue; }
    if (dansChaine && c === "\t") { out += "\\t"; continue; }
    out += c;
  }
  try { return JSON.parse(out); } catch (e) { return null; }
}

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

  const sensTxt =
    compte.sens === "debiteur"  ? " (le client doit cette somme)" :
    compte.sens === "crediteur" ? " (la somme est en faveur du client)" :
                                  " (rien ne reste dû)";

  const userMsg =
    "DEMANDE DU CLIENT (texte caviardé — les identifiants ont été retirés)\n" +
    demande +
    "\n\nCHIFFRES DU COMPTE, calculés par l'outil (seule source de vérité chiffrée)\n" +
    JSON.stringify(compte, null, 2) +
    "\n\nRappel : sens du solde = \"" + (compte.sens || "?") + "\"" + sensTxt + "." +
    "\n\nRédige la réponse email en appelant l'outil rediger_reponse.";

  const payload = {
    model: MODEL,
    max_tokens: 2500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "rediger_reponse" },
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
        error: "erreur de l'API Claude (" + r.status + ")", detail: detail.slice(0, 500) }) };
    }

    const data = await r.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appel = blocs.find(b => b.type === "tool_use" && b.name === "rediger_reponse");
    let out = appel ? appel.input : null;

    if (!out) {
      const texte = blocs.filter(b => b.type === "text").map(b => b.text).join("");
      out = lectureTolerante(texte);
      if (!out) {
        const tronque = data.stop_reason === "max_tokens";
        return { statusCode: 200, headers: H, body: JSON.stringify({
          error: tronque
            ? "la réponse du modèle a été coupée avant la fin (limite de longueur)"
            : "le modèle n'a pas renvoyé un email exploitable",
          stop_reason: data.stop_reason || "",
          raw: (texte || JSON.stringify(blocs)).slice(0, 1200)
        }) };
      }
    }

    const email = String(out.email || "").trim();
    if (!email) {
      return { statusCode: 200, headers: H, body: JSON.stringify({
        error: "le modèle a renvoyé un email vide",
        stop_reason: data.stop_reason || "",
        raw: JSON.stringify(out).slice(0, 1200) }) };
    }

    return { statusCode: 200, headers: H, body: JSON.stringify({
      objet: String(out.objet || "Le point sur votre compte"),
      email: email,
      points_a_verifier: Array.isArray(out.points_a_verifier) ? out.points_a_verifier.slice(0, 6).map(String) : [],
      hors_perimetre: Array.isArray(out.hors_perimetre) ? out.hors_perimetre.slice(0, 6).map(String) : []
    }) };

  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "échec de l'appel à l'API : " + (err.message || String(err)) }) };
  }
};

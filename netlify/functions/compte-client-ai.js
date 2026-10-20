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
  "LE CAS LE PLUS DANGEREUX : UN RÈGLEMENT ENCAISSÉ PUIS ANNULÉ",
  "Quand une facture porte des \"reglements_annules\" (rejet de prélèvement, remboursement,",
  "contre-passation), le client a réellement vu un débit sur son relevé bancaire ET la facture",
  "reste due. Les deux sont vrais en même temps. Dans ce cas :",
  "- tu n'écris JAMAIS que la facture est réglée, ni qu'aucun paiement n'a été reçu ;",
  "- tu décris la suite des évènements dans l'ordre et avec leurs dates : la somme a été encaissée",
  "  le [date], puis annulée le [date] pour le motif [motif], ce qui a remis la somme à sa charge ;",
  "- tu ne donnes pas la cause de l'annulation comme établie si le motif n'est pas dans les données :",
  "  tu dis que le motif doit être vérifié ;",
  "- tu mets validation_requise à true.",
  "Ne confonds jamais deux règlements du même montant : rattache chaque somme à la facture et à la",
  "date que les données lui donnent, et si deux règlements de montant identique existent, dis-le",
  "plutôt que de choisir.",
  "",
  "CE QUE TU NE PROMETS JAMAIS",
  "- Tu ne dis pas qu'une vérification, une enquête ou une recherche est en cours : tu ne sais pas",
  "  ce que fait l'entreprise. Tu peux dire que le point va être vérifié par le conseiller.",
  "- Tu ne transmets pas le dossier à un service, tu n'annonces pas de délai, tu ne promets ni",
  "  remboursement ni régularisation ni geste commercial.",
  "- Tu ne demandes jamais au client d'arrêter d'envoyer ses justificatifs, et tu ne lui demandes pas",
  "  de fournir une preuve qu'il a déjà transmise.",
  "- Si le client conteste et que les données ne tranchent pas, tu le dis franchement et tu mets",
  "  validation_requise à true, plutôt que de rassurer à tort.",
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
  "LE CŒUR DE LA RÉPONSE : LE CHEMIN DU SOLDE",
  "Le champ \"decomposition\" donne le chemin complet entre 0 € et le solde, étape par étape.",
  "C'est la matière de ton email. Tu dois le refaire parcourir au client dans cet ordre :",
  "  1. ce qui a été facturé sur la période, et combien de factures ;",
  "  2. ce qui est venu en déduction (règlements, avoirs), et combien ;",
  "  3. les éventuels évènements qui ont remis une somme à sa charge (rejet, frais, remboursement) ;",
  "  4. la soustraction finale, posée explicitement, qui donne le solde.",
  "Tu poses le calcul en toutes lettres au moins une fois, par exemple :",
  "  « **499,64 €** facturés − **331,49 €** déjà réglés = **168,15 €** restant à payer ».",
  "La somme des \"effet\" de la décomposition retombe exactement sur le solde : ne t'en écarte jamais.",
  "",
  "CHAQUE CHIFFRE EST EXPLIQUÉ",
  "- Tu n'écris jamais un montant seul. Chaque chiffre cité est suivi de ce qu'il représente et d'où il vient.",
  "  Mauvais : « Votre solde est de 168,15 €. »",
  "  Bon : « Il reste **168,15 €** à régler : c'est la facture du **15/03/2026**, d'un montant de",
  "  **71,20 €**, à laquelle s'ajoute celle du **15/04/2026** de **96,95 €**, aucune des deux n'ayant",
  "  encore été réglée. »",
  "- Si tu emploies un mot que le client peut ne pas connaître (avoir, régularisation, rejet de",
  "  prélèvement), tu l'expliques en quelques mots dans la phrase même, entre tirets ou entre parenthèses.",
  "- Le client ne doit jamais avoir à faire un calcul de tête : si deux chiffres doivent être",
  "  rapprochés, tu écris toi-même la différence.",
  "",
  "MISE EN FORME",
  "- Tu encadres de ** ** chaque montant, chaque date et chaque nombre important : **168,15 €**,",
  "  **15/03/2026**, **3 factures**. Rien d'autre n'est mis en gras.",
  "- Le détail chiffré est présenté en lignes courtes commençant par un tiret, une idée par ligne.",
  "- Aucun tableau, aucun code comptable, aucun numéro de pièce brut sans le mot « facture » devant.",
  "",
  "STYLE",
  "- Français, vouvoiement, phrases courtes, aucun jargon comptable : pas de « lettrage », « débit »,",
  "  « crédit », « écriture », « pièce ». On dit facture, règlement, somme restant due.",
  "- Tu réponds d'abord à ce que le client demande, puis tu déroules le chemin du solde.",
  "- Si le client est mécontent, tu accuses réception de son ressenti en une phrase, sans t'excuser",
  "  de façon excessive et sans reconnaître une faute qui n'est pas établie.",
  "- Tu termines par ce que le client doit faire concrètement — ou par le fait qu'il n'a rien à faire.",
  "- Longueur : 200 à 350 mots, le détail chiffré compris. Montants au format français (1 234,56 €).",
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
      email: { type: "string", description: "Corps complet de l'email, sauts de ligne compris, signature incluse. Montants, dates et nombres importants encadrés de ** **." },
      calcul_pose: { type: "string", description: "La soustraction qui donne le solde, en une ligne, telle qu'elle apparaît dans l'email. Ex : 499,64 € facturés − 331,49 € réglés = 168,15 € restant dus." },
      validation_requise: {
        type: "boolean",
        description: "true si l'email ne doit pas partir sans relecture d'un responsable : règlement encaissé puis annulé, contestation du client que les données ne tranchent pas, dossier en recouvrement, incohérence."
      },
      points_a_verifier: {
        type: "array", items: { type: "string" },
        description: "Ce que le conseiller doit contrôler avant d'envoyer (incohérence, règlement non rattaché, hypothèse). Vide si rien."
      },
      hors_perimetre: {
        type: "array", items: { type: "string" },
        description: "Les demandes du client auxquelles l'email ne répond pas, et pourquoi en quelques mots. Vide si l'email répond à tout."
      }
    },
    required: ["objet", "email", "calcul_pose", "points_a_verifier", "hors_perimetre"]
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
      calcul_pose: String(out.calcul_pose || ""),
      points_a_verifier: Array.isArray(out.points_a_verifier) ? out.points_a_verifier.slice(0, 6).map(String) : [],
      hors_perimetre: Array.isArray(out.hors_perimetre) ? out.hors_perimetre.slice(0, 6).map(String) : []
    }) };

  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "échec de l'appel à l'API : " + (err.message || String(err)) }) };
  }
};

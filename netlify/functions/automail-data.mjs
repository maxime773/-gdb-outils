// Fonction serveur — Auto Mail : moteur de test des business descriptions.
//
// Trois actions :
//   match_all : confronte un email à TOUTES les intentions, renvoie la meilleure
//   match_one : teste un email contre UNE seule business description
//   refine    : propose une réécriture des deux business descriptions après
//               un désaccord (exception à ajouter / renfort à apporter)
//
// Le modèle ne s'appuie QUE sur les business descriptions fournies :
// c'est ce qui rend le test représentatif du comportement en production.
// Clé API : variable d'environnement Netlify ANTHROPIC_API_KEY.

const MODEL_MATCH  = "claude-haiku-4-5-20251001"; // rapide et économique : beaucoup d'appels
const MODEL_REFINE = "claude-sonnet-5";            // rédaction des prompts : plus de finesse

async function callClaude(key, model, system, user, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: model,
      max_tokens: maxTokens || 1500,
      system: system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error("API Claude " + r.status + " — " + detail.slice(0, 200));
  }
  const data = await r.json();
  let out = "";
  if (Array.isArray(data.content)) {
    out = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  }
  out = out.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(out); }
  catch (e) { throw new Error("Réponse non exploitable : " + out.slice(0, 200)); }
}

exports.handler = async (event) => {
  const H = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: H, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "Clé API absente. Ajoutez ANTHROPIC_API_KEY dans les variables d'environnement Netlify." }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const action = body.action;

  try {
    // ---------------------------------------------------------------
    if (action === "match_all") {
      const email = String(body.email || "").slice(0, 6000).trim();
      const intentions = Array.isArray(body.intentions) ? body.intentions : [];
      if (!email || !intentions.length) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Email ou intentions manquants." }) };
      }

      const catalogue = intentions.map(i =>
        "### " + i.id + " — " + i.name + "\n" + (i.description || "") +
        (Array.isArray(i.exemples) && i.exemples.length
          ? "\nEXEMPLES DÉJÀ VALIDÉS POUR CETTE INTENTION :\n" + i.exemples.slice(0, 8).map(e => "- " + String(e.texte || e).slice(0, 200)).join("\n")
          : "")
      ).join("\n\n");

      const system =
"Tu es le moteur de détection d'intention d'un service client d'un fournisseur d'énergie. " +
"On te donne un catalogue d'intentions, chacune décrite par une business description (champs lexicaux, " +
"intentions à détecter, exceptions, exemples). On te donne ensuite un email client.\n\n" +
"RÈGLES :\n" +
"- Appuie-toi UNIQUEMENT sur les business descriptions fournies. N'invente aucune intention.\n" +
"- Respecte scrupuleusement les EXCEPTIONS : si une description dit de ne pas matcher dans un cas, ne matche pas.\n" +
"- Si aucune intention ne correspond franchement, renvoie intention_id = null. Mieux vaut aucun match qu'un mauvais match.\n" +
"- La confiance reflète ta certitude réelle, pas une politesse.\n\n" +
"Réponds UNIQUEMENT par un JSON valide, sans texte ni balise autour :\n" +
'{"intention_id": string|null, "confiance": number (0-100), ' +
'"justification": string (2 phrases max, en français, expliquant CE QUI dans l\'email a déclenché ou non le match), ' +
'"alternatives": [{"intention_id": string, "confiance": number}] }';

      const user = "CATALOGUE DES INTENTIONS :\n\n" + catalogue + "\n\n---\n\nEMAIL CLIENT À ANALYSER :\n\n" + email;
      const res = await callClaude(key, MODEL_MATCH, system, user, 1000);
      return { statusCode: 200, headers: H, body: JSON.stringify(res) };
    }

    // ---------------------------------------------------------------
    if (action === "match_one") {
      const email = String(body.email || "").slice(0, 6000).trim();
      const intention = body.intention || {};
      if (!email || !intention.description) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Email ou intention manquants." }) };
      }

      const system =
"Tu es le moteur de détection d'intention d'un service client d'un fournisseur d'énergie. " +
"On te donne UNE business description et un email client. Tu dois dire si l'email correspond à cette intention.\n\n" +
"RÈGLES :\n" +
"- Appuie-toi UNIQUEMENT sur la business description fournie.\n" +
"- Respecte scrupuleusement les EXCEPTIONS qu'elle contient : elles priment sur les champs lexicaux.\n" +
"- Un simple mot-clé présent ne suffit pas : c'est l'intention réelle du client qui compte.\n\n" +
"Réponds UNIQUEMENT par un JSON valide :\n" +
'{"match": true|false, "confiance": number (0-100), "justification": string (2 phrases max, en français)}';

      const user = "INTENTION : " + (intention.name || intention.id) + "\n\nBUSINESS DESCRIPTION :\n" +
        intention.description +
        (Array.isArray(intention.exemples) && intention.exemples.length
          ? "\n\nEXEMPLES DÉJÀ VALIDÉS :\n" + intention.exemples.slice(0, 8).map(e => "- " + String(e.texte || e).slice(0, 200)).join("\n")
          : "") +
        "\n\n---\n\nEMAIL CLIENT À ANALYSER :\n\n" + email;

      const res = await callClaude(key, MODEL_MATCH, system, user, 800);
      return { statusCode: 200, headers: H, body: JSON.stringify(res) };
    }

    // ---------------------------------------------------------------
    if (action === "refine") {
      const email = String(body.email || "").slice(0, 4000).trim();
      const wrong = body.wrong || {};   // intention détectée à tort
      const right = body.right || {};   // intention réellement attendue
      if (!email || !wrong.description || !right.description) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Données incomplètes pour l'affinage." }) };
      }

      const system =
"Tu affines des business descriptions servant à détecter l'intention d'emails clients dans un service " +
"client d'énergie. Un testeur humain vient de constater une erreur de détection : un email a été rattaché " +
"à la mauvaise intention. Ton rôle est de corriger les deux descriptions pour que l'erreur ne se reproduise plus.\n\n" +
"RÈGLES DE RÉÉCRITURE :\n" +
"- Conserve INTÉGRALEMENT la structure et le contenu existants. Tu ajoutes, tu ne réécris pas tout.\n" +
"- Dans la description INCORRECTE : ajoute une exception précise, formulée comme les exceptions déjà présentes, " +
"qui explique le cas de figure et vers quelle intention orienter. Vise le critère de distinction, pas le mot-clé.\n" +
"- Dans la description CORRECTE : renforce la détection (champ lexical, intention à détecter ou exemple positif) " +
"pour que ce type d'email y soit rattaché.\n" +
"- Reste concis et opérationnel. N'invente pas de règle métier qui n'existe pas.\n" +
"- Garde le français et le style des descriptions existantes (sections en majuscules, tirets).\n\n" +
"Réponds UNIQUEMENT par un JSON valide :\n" +
'{"description_incorrecte": string (texte COMPLET mis à jour), ' +
'"description_correcte": string (texte COMPLET mis à jour), ' +
'"resume": string (2-3 puces en français décrivant ce que tu as ajouté de part et d\'autre)}';

      const user =
"EMAIL CLIENT MAL CLASSÉ :\n\n" + email + "\n\n---\n\n" +
"INTENTION DÉTECTÉE À TORT : " + (wrong.name || wrong.id) + "\n" +
"SA BUSINESS DESCRIPTION ACTUELLE :\n" + wrong.description + "\n\n---\n\n" +
"INTENTION QUI AURAIT DÛ ÊTRE DÉTECTÉE : " + (right.name || right.id) + "\n" +
"SA BUSINESS DESCRIPTION ACTUELLE :\n" + right.description;

      const res = await callClaude(key, MODEL_REFINE, system, user, 4000);
      return { statusCode: 200, headers: H, body: JSON.stringify(res) };
    }

    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Action inconnue : " + action }) };

  } catch (err) {
    return { statusCode: 502, headers: H, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};

// Fonction serveur — extraction d'une facture d'énergie (électricité / gaz).
// Le modèle EXTRAIT uniquement ; tous les calculs sont faits ensuite côté
// navigateur, de façon déterministe et vérifiable (exigence du brief POC).
// La clé API vit dans la variable d'environnement Netlify ANTHROPIC_API_KEY.

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

  let text = "";
  try { text = (JSON.parse(event.body || "{}").text || "").toString(); } catch (e) {}
  text = text.slice(0, 16000).trim();
  if (!text) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Aucun texte reçu à analyser." }) };
  }

  const system =
"Tu extrais les données d'une facture d'énergie française (électricité ou gaz naturel). " +
"Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balise Markdown autour.\n\n" +
"RÈGLE ABSOLUE : n'invente JAMAIS un montant, un prix, un taux ou une quantité. " +
"Si une valeur n'apparaît pas explicitement sur la facture ou est illisible, mets null. " +
"Ne déduis jamais une valeur depuis un barème que tu connaîtrais : seuls les chiffres écrits sur la facture comptent.\n\n" +
"Schéma exact :\n" +
"{\n" +
'  "fournisseur": string|null,\n' +
'  "energie": "electricite"|"gaz"|null,\n' +
'  "numero_facture": string|null,\n' +
'  "reference": string|null,            // PDL, PCE ou n° de contrat\n' +
'  "periode_debut": string|null,        // JJ/MM/AAAA\n' +
'  "periode_fin": string|null,          // JJ/MM/AAAA\n' +
'  "option_tarifaire": string|null,     // BASE, HP/HC, T1, T2...\n' +
'  "puissance": string|null,            // ex "6 kVA"\n' +
'  "consommation_kwh": number|null,     // total kWh facturés sur la période\n' +
'  "consommation_hp_kwh": number|null,\n' +
'  "consommation_hc_kwh": number|null,\n' +
'  "postes": {\n' +
'    "abonnement_ht": number|null,\n' +
'    "consommation_ht": number|null,\n' +
'    "acheminement_ht": number|null,    // null si NON isolé sur la facture (fréquent en offre intégrée)\n' +
'    "accise_ht": number|null,          // TICFE/CSPE pour l\'électricité, TICGN pour le gaz\n' +
'    "cta_ht": number|null,\n' +
'    "services_ht": number|null,        // frais divers, prestations, frais de rejet\n' +
'    "autres_ht": number|null\n' +
'  },\n' +
'  "tva": { "taux_5_5": number|null, "taux_20": number|null, "total_tva": number|null },\n' +
'  "total_ht": number|null,\n' +
'  "total_ttc": number|null,\n' +
'  "prix_unitaires": [ { "libelle": string, "quantite": number|null, "unite": string|null, "prix": number|null } ],\n' +
'  "champs_illisibles": [ string ]      // noms des champs attendus mais absents ou illisibles\n' +
"}\n\n" +
"Précisions :\n" +
"- Les montants sont des nombres en euros (point décimal, sans symbole).\n" +
"- Additionne les lignes d'un même poste quand la facture le découpe par sous-période (ex. deux lignes d'abonnement suite à un changement de prix).\n" +
"- La CTA et l'acheminement sont deux choses différentes : ne les confonds jamais.\n" +
"- Pour le gaz, la conversion m3 -> kWh est déjà faite sur la facture : prends les kWh.\n" +
"- Si la facture ne distingue pas l'acheminement (offre intégrée), acheminement_ht vaut null.";

  const payload = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2500,
    system: system,
    messages: [{ role: "user", content: "Voici le texte de la facture :\n\n" + text }]
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
        error: "Erreur de l'API Claude (" + r.status + ").", detail: detail.slice(0, 300) }) };
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
        error: "Le modèle n'a pas renvoyé de données exploitables.", raw: out.slice(0, 400) }) };
    }
    return { statusCode: 200, headers: H, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({
      error: "Échec de l'appel à l'API : " + (err.message || String(err)) }) };
  }
};

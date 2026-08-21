// Fonction serveur Netlify — PDF vers visualisation (DATA · 01)
// Reçoit le texte extrait d'un PDF, demande à Claude d'en tirer des données
// chiffrées prêtes à grapher, et renvoie le résultat au navigateur.
// La clé API n'est JAMAIS dans ce fichier : elle est lue depuis la variable
// d'environnement ANTHROPIC_API_KEY, réglée dans Netlify.

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
  text = text.slice(0, 12000).trim(); // borne la taille (et donc le coût)
  if (!text) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Aucun texte reçu à analyser." }) };
  }

  const system =
    "Tu extrais des données chiffrées d'un document pour en faire des graphiques. " +
    "Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour ni balise Markdown. " +
    "Schéma exact : {\"titre\": string, \"resume\": string, \"graphiques\": " +
    "[{\"type\": \"bar\"|\"line\"|\"pie\", \"titre\": string, \"labels\": string[], " +
    "\"valeurs\": number[], \"unite\": string}]}. " +
    "Au maximum 4 graphiques, uniquement à partir de chiffres réellement présents dans le texte. " +
    "labels et valeurs doivent avoir exactement la même longueur. " +
    "Si aucune donnée chiffrée exploitable, renvoie " +
    "{\"titre\":\"\",\"resume\":\"Aucune donnée chiffrée exploitable n'a été trouvée.\",\"graphiques\":[]}.";

  const payload = {
    model: "claude-haiku-4-5-20251001",   // rapide et économique ; passe à "claude-sonnet-5" pour plus de finesse
    max_tokens: 1500,
    system: system,
    messages: [{ role: "user", content: "Voici le texte du document :\n\n" + text }]
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

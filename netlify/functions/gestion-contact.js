// Fonction serveur pour l'outil "Gestion de contact".
// À placer dans le dépôt sous : netlify/functions/gestion-contact.js
// La clé API reste côté serveur (variable d'environnement Netlify ANTHROPIC_API_KEY),
// jamais exposée au navigateur.

const SYSTEM = `Tu es un assistant pour conseillers clientèle. À partir d'un email de réponse envoyé à un client, génère une "gestion de contact" : une note courte et factuelle (1 à 3 phrases max) qui résume ce qui a été dit ou fait lors du contact, pour traçabilité dans le dossier client. Style neutre, professionnel, sans formules de politesse. Commence directement par l'action ou l'information transmise. Ne mets aucun préambule, donne uniquement la note.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Méthode non autorisée.' });
  }

  let email = '';
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Requête invalide.' });
  }
  if (!email || !String(email).trim()) {
    return json(400, { error: 'Email manquant.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Clé API non configurée côté serveur.' });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Email envoyé au client :\n${email}` }]
      })
    });

    if (!res.ok) {
      return json(502, { error: 'Le service IA a renvoyé une erreur.' });
    }

    const data = await res.json();
    const note = (data.content || []).find(b => b.type === 'text')?.text?.trim() || '';
    if (!note) {
      return json(502, { error: 'Réponse vide du service IA.' });
    }
    return json(200, { note });
  } catch (e) {
    return json(502, { error: 'Service IA indisponible.' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

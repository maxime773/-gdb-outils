// Fonction serveur — Auto Mail : persistance du référentiel d'intentions.
// Stockage : Netlify Blobs (natif, aucune base de données externe).
//
//   GET  -> renvoie { intentions: [...], updated_at, version }
//   POST -> enregistre le référentiel complet transmis
//
// Le référentiel contient les business descriptions, les templates de réponse
// et les bases d'exemples validés. Aucune donnée nominative n'a vocation à y
// figurer : les emails de test doivent être anonymisés en amont.
import { getStore } from "@netlify/blobs";

const KEY = "referentiel";

export default async (req) => {
  const H = { "content-type": "application/json", "cache-control": "no-store" };
  const store = getStore({ name: "automail", consistency: "strong" });

  if (req.method === "GET") {
    try {
      const data = (await store.get(KEY, { type: "json" })) || null;
      return new Response(JSON.stringify(data || { intentions: null }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ intentions: null }), { headers: H });
    }
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    if (!Array.isArray(body.intentions)) {
      return new Response(JSON.stringify({ error: "Format invalide : 'intentions' attendu." }), { status: 400, headers: H });
    }
    try {
      const payload = {
        intentions: body.intentions,
        updated_at: new Date().toISOString(),
        version: (Number(body.version) || 0) + 1
      };
      await store.setJSON(KEY, payload);
      return new Response(JSON.stringify({ ok: true, updated_at: payload.updated_at, version: payload.version }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Stockage indisponible." }), { status: 500, headers: H });
    }
  }

  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: H });
};

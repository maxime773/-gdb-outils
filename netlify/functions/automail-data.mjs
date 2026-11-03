// Fonction serveur — Auto Mail : persistance du référentiel d'intentions.
// Stockage : Netlify Blobs (natif, aucune base de données externe).
//
//   GET  -> renvoie { intentions: [...], combinaisons: {...}, updated_at, version }
//   POST -> enregistre le référentiel complet transmis
//
// Le référentiel contient les business descriptions et leur historique de
// versions, les templates de réponse, les bases d'exemples validés et les
// combinaisons multi-intention observées. Aucune donnée nominative n'a vocation
// à y figurer : les emails de test doivent être anonymisés en amont.
//
// Protection contre l'écrasement : chaque enregistrement indique la version
// sur laquelle il a été construit. Si quelqu'un a enregistré entre-temps
// (un autre poste, un autre onglet), l'enregistrement est refusé (409) au lieu
// d'écraser silencieusement son travail.
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
      const current = (await store.get(KEY, { type: "json" })) || null;
      const currentVersion = current ? (Number(current.version) || 0) : 0;
      const baseVersion = Number(body.version) || 0;

      // quelqu'un a enregistré depuis le chargement de cette page : on n'écrase pas
      if (current && Array.isArray(current.intentions) && baseVersion !== currentVersion) {
        return new Response(JSON.stringify({
          error: "conflit",
          message: "Le référentiel a été modifié ailleurs depuis le chargement de la page.",
          version: currentVersion,
          updated_at: current.updated_at || null
        }), { status: 409, headers: H });
      }

      const payload = {
        intentions: body.intentions,
        combinaisons: (body.combinaisons && typeof body.combinaisons === "object") ? body.combinaisons
                      : (current && current.combinaisons) || {},
        updated_at: new Date().toISOString(),
        version: currentVersion + 1
      };
      await store.setJSON(KEY, payload);
      return new Response(JSON.stringify({ ok: true, updated_at: payload.updated_at, version: payload.version }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Stockage indisponible." }), { status: 500, headers: H });
    }
  }

  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: H });
};

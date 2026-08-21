// Fonction serveur — ressenti utilisateurs (anonyme).
// GET  : renvoie les agrégats par outil (nombre de réponses + sommes).
// POST : enregistre une réponse { tool, bienEtre (1-5), utilite (1-5) }.
// Aucune donnée personnelle : seulement des moyennes.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const H = { "content-type": "application/json" };
  const store = getStore({ name: "usage", consistency: "strong" });

  if (req.method === "GET") {
    const fb = (await store.get("feedback", { type: "json" })) || {};
    return new Response(JSON.stringify(fb), { headers: { ...H, "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    let b = {};
    try { b = await req.json(); } catch (e) {}
    const tool = String(b.tool || "").trim().slice(0, 60);
    const be = Number(b.bienEtre), ut = Number(b.utilite);
    const ok = (v) => Number.isFinite(v) && v >= 1 && v <= 5;
    if (!tool || !ok(be) || !ok(ut)) {
      return new Response(JSON.stringify({ error: "données invalides" }), { status: 400, headers: H });
    }
    try {
      const fb = (await store.get("feedback", { type: "json" })) || {};
      const t = fb[tool] || { n: 0, be: 0, ut: 0 };
      t.n += 1; t.be += be; t.ut += ut;
      fb[tool] = t;
      await store.setJSON("feedback", fb);
      return new Response(JSON.stringify({ ok: true }), { headers: H });
    } catch (e) {
      return new Response(JSON.stringify({ error: "stockage indisponible" }), { status: 500, headers: H });
    }
  }

  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: H });
};

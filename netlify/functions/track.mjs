// Fonction serveur — enregistre une utilisation d'outil.
// Stockage : Netlify Blobs (natif, aucune base de données externe).
// Aucune donnée personnelle : on ne stocke qu'un compteur par outil et par mois.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const H = { "content-type": "application/json" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: H });
  }
  let tool = "";
  try { const b = await req.json(); tool = String(b.tool || "").trim().slice(0, 60); } catch (e) {}
  if (!tool) {
    return new Response(JSON.stringify({ error: "tool manquant" }), { status: 400, headers: H });
  }
  try {
    const store = getStore({ name: "usage", consistency: "strong" });
    const data = (await store.get("counts", { type: "json" })) || {};
    const month = new Date().toISOString().slice(0, 7); // AAAA-MM
    if (!data[tool]) data[tool] = {};
    data[tool][month] = (data[tool][month] || 0) + 1;
    await store.setJSON("counts", data);
    return new Response(JSON.stringify({ ok: true }), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ error: "stockage indisponible" }), { status: 500, headers: H });
  }
};

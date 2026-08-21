// Fonction serveur — renvoie les compteurs d'utilisation de tous les outils.
import { getStore } from "@netlify/blobs";

export default async () => {
  const H = { "content-type": "application/json", "cache-control": "no-store" };
  try {
    const store = getStore({ name: "usage", consistency: "strong" });
    const data = (await store.get("counts", { type: "json" })) || {};
    return new Response(JSON.stringify(data), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({}), { headers: H });
  }
};

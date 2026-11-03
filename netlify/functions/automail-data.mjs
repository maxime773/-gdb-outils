// Fonction serveur — Auto Mail : persistance du référentiel d'intentions
// et de l'historique des imports en masse.
// Stockage : Netlify Blobs (natif, aucune base de données externe).
//
// RÉFÉRENTIEL
//   GET                 -> { intentions: [...], combinaisons: {...}, updated_at, version }
//   POST {intentions…}  -> enregistre le référentiel complet transmis
//
// HISTORIQUE DES IMPORTS (rangé à part : un import ne touche jamais au référentiel)
//   GET  ?imports=1                         -> { imports: [résumés, du plus récent au plus ancien] }
//   GET  ?import=<id>                       -> l'import complet (emails, résultats, lignes traitées)
//   POST {action:"import_save", id, …}      -> crée l'import ou y ajoute les nouveaux résultats
//   POST {action:"import_delete", id}       -> supprime un import
//
// Aucune donnée nominative n'a vocation à y figurer : les emails de test doivent
// être anonymisés en amont.
//
// Protection contre l'écrasement du référentiel : chaque enregistrement indique
// la version sur laquelle il a été construit. Si quelqu'un a enregistré entre-temps
// (un autre poste, un autre onglet), l'enregistrement est refusé (409).
import { getStore } from "@netlify/blobs";

const KEY = "referentiel";
const IDX = "imports-index";
const MAX_IMPORTS = 60;            // au-delà, les plus anciens sont supprimés
const ID_OK = /^imp-[A-Za-z0-9-]{6,60}$/;

export default async (req) => {
  const H = { "content-type": "application/json", "cache-control": "no-store" };
  const store = getStore({ name: "automail", consistency: "strong" });
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: H });
  const q = new URL(req.url).searchParams;

  if (req.method === "GET") {
    try {
      if (q.get("imports")) {
        return json({ imports: (await store.get(IDX, { type: "json" })) || [] });
      }
      if (q.get("import")) {
        const id = q.get("import");
        if (!ID_OK.test(id)) return json({ error: "identifiant invalide" }, 400);
        const rec = await store.get("import/" + id, { type: "json" });
        return rec ? json(rec) : json({ error: "import introuvable" }, 404);
      }
      const data = (await store.get(KEY, { type: "json" })) || null;
      return json(data || { intentions: null });
    } catch (e) {
      return json(q.get("imports") ? { imports: [] } : { intentions: null });
    }
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch (e) {}

    // ---------- historique des imports ----------
    if (body.action === "import_save" || body.action === "import_delete") {
      const id = String(body.id || "");
      if (!ID_OK.test(id)) return json({ error: "identifiant invalide" }, 400);
      try {
        let index = (await store.get(IDX, { type: "json" })) || [];

        if (body.action === "import_delete") {
          await store.delete("import/" + id);
          index = index.filter(x => x.id !== id);
          await store.setJSON(IDX, index);
          return json({ ok: true });
        }

        let rec = await store.get("import/" + id, { type: "json" });
        if (body.meta) {                       // création
          const m = body.meta;
          rec = { id, cree: m.cree || new Date().toISOString(), nom: String(m.nom || "Import").slice(0, 120),
                  source: m.source === "recette" ? "recette" : "import",
                  emails: Array.isArray(m.emails) ? m.emails.map(e => String(e).slice(0, 6000)) : [],
                  attendus: Array.isArray(m.attendus) ? m.attendus : null,
                  resultats: [], traites: {}, statut: "en cours" };
        }
        if (!rec) return json({ error: "import introuvable" }, 404);

        // ajout des nouveaux résultats à leur place (envoi par petits paquets)
        if (Array.isArray(body.resultats)) {
          const from = Math.max(0, Number(body.resultats_from) || 0);
          body.resultats.forEach((r, k) => { rec.resultats[from + k] = r; });
        }
        if (body.traites && typeof body.traites === "object") rec.traites = body.traites;
        if (body.statut) rec.statut = String(body.statut);
        if (body.resume && typeof body.resume === "object") rec.resume = body.resume;
        rec.maj = new Date().toISOString();
        await store.setJSON("import/" + id, rec);

        const entry = { id, cree: rec.cree, maj: rec.maj, nom: rec.nom, source: rec.source,
                        total: rec.emails.length, faits: rec.resultats.filter(Boolean).length,
                        traites: Object.keys(rec.traites || {}).length, statut: rec.statut,
                        resume: rec.resume || {} };
        index = [entry].concat(index.filter(x => x.id !== id))
          .sort((a, b) => String(b.cree).localeCompare(String(a.cree)));
        if (index.length > MAX_IMPORTS) {
          const trop = index.slice(MAX_IMPORTS);
          index = index.slice(0, MAX_IMPORTS);
          for (const x of trop) { try { await store.delete("import/" + x.id); } catch (e) {} }
        }
        await store.setJSON(IDX, index);
        return json({ ok: true, entry });
      } catch (e) {
        return json({ error: "Stockage indisponible." }, 500);
      }
    }

    // ---------- référentiel ----------
    if (!Array.isArray(body.intentions)) {
      return json({ error: "Format invalide : 'intentions' attendu." }, 400);
    }
    try {
      const current = (await store.get(KEY, { type: "json" })) || null;
      const currentVersion = current ? (Number(current.version) || 0) : 0;
      const baseVersion = Number(body.version) || 0;

      // quelqu'un a enregistré depuis le chargement de cette page : on n'écrase pas
      if (current && Array.isArray(current.intentions) && baseVersion !== currentVersion) {
        return json({
          error: "conflit",
          message: "Le référentiel a été modifié ailleurs depuis le chargement de la page.",
          version: currentVersion,
          updated_at: current.updated_at || null
        }, 409);
      }

      const payload = {
        intentions: body.intentions,
        combinaisons: (body.combinaisons && typeof body.combinaisons === "object") ? body.combinaisons
                      : (current && current.combinaisons) || {},
        updated_at: new Date().toISOString(),
        version: currentVersion + 1
      };
      await store.setJSON(KEY, payload);
      return json({ ok: true, updated_at: payload.updated_at, version: payload.version });
    } catch (e) {
      return json({ error: "Stockage indisponible." }, 500);
    }
  }

  return json({ error: "Méthode non autorisée" }, 405);
};

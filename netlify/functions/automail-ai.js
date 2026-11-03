// Fonction serveur — Auto Mail : moteur de test des business descriptions.
//
// Quatre actions :
//   match_all  : confronte un email à TOUTES les intentions — détecte TOUTES les
//                demandes présentes (multi-intention), avec l'extrait qui porte chacune
//   match_one  : teste un email contre UNE seule business description
//   refine     : propose une réécriture de deux business descriptions après
//                un désaccord (exception à ajouter / renfort à apporter)
//   actualiser : relit tous les emails exemples d'une intention et propose des
//                AJOUTS à sa business description (jamais de suppression)
//
// Le modèle ne s'appuie QUE sur les business descriptions fournies :
// c'est ce qui rend le test représentatif du comportement en production.
// Clé API : variable d'environnement Netlify ANTHROPIC_API_KEY.
//
// Rappel de nommage : fonction qui appelle Claude -> .js (exports.handler)
//                     fonction de stockage getStore -> .mjs

const MODEL_MATCH  = "claude-haiku-4-5-20251001"; // rapide et économique : beaucoup d'appels
const MODEL_REFINE = "claude-sonnet-5";            // rédaction des prompts : plus de finesse
// Pour une détection multi-intention plus fine (au prix d'un coût plus élevé),
// on peut passer MODEL_MATCH à "claude-sonnet-5".

// ---------- appel simple, réponse JSON dans le texte (actions historiques) ----------
async function callClaude(key, model, system, user, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens || 1500, system, messages: [{ role: "user", content: user }] })
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error("API Claude " + r.status + " — " + detail.slice(0, 200));
  }
  const data = await r.json();
  let out = "";
  if (Array.isArray(data.content)) out = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  out = out.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(out); }
  catch (e) { throw new Error("Réponse non exploitable : " + out.slice(0, 200)); }
}

// ---------- appel structuré : le modèle remplit un outil, l'API valide la forme ----------
// Plus fiable que du JSON écrit à la main dès que la réponse contient des listes ou du texte long.
async function callTool(key, model, system, user, tool, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: maxTokens || 2000, system,
      tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }]
    })
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error("API Claude " + r.status + " — " + detail.slice(0, 200));
  }
  const data = await r.json();
  const call = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  if (!call) {
    if (data.stop_reason === "max_tokens") throw new Error("Réponse coupée avant la fin (limite de longueur).");
    throw new Error("Le modèle n'a pas renvoyé de réponse structurée.");
  }
  return call.input || {};
}

function txt(e) { return String((e && (e.texte || e)) || ""); }
function intro(desc) {
  // l'objectif = ce qui précède la première section (CHAMPS LEXICAUX…)
  const lines = String(desc || "").split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (/^\s*(CHAMPS?\s+LEXICAUX|INTENTIONS?\s+[ÀA]\s+D[ÉE]TECTER|EXCEPTIONS?|EXEMPLES?\s+POSITIFS?)\b/i.test(l)) break;
    out.push(l);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
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
    // MULTI-INTENTION : toutes les demandes de l'email, chacune avec son extrait
    if (action === "match_all") {
      const email = String(body.email || "").slice(0, 6000).trim();
      const intentions = Array.isArray(body.intentions) ? body.intentions : [];
      if (!email || !intentions.length) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Email ou intentions manquants." }) };
      }
      const ids = intentions.map(i => String(i.id));

      const catalogue = intentions.map(i =>
        "### " + i.id + " — " + i.name + "\n" + (i.description || "") +
        (Array.isArray(i.exemples) && i.exemples.length
          ? "\nEXEMPLES DÉJÀ VALIDÉS POUR CETTE INTENTION :\n" + i.exemples.slice(-8).map(e => "- " + txt(e).slice(0, 220)).join("\n")
          : "")
      ).join("\n\n");

      const system = [
        "Tu es le moteur de détection d'intention du service client d'un fournisseur d'énergie.",
        "On te donne un catalogue d'intentions, chacune décrite par une business description (champs lexicaux,",
        "intentions à détecter, exceptions, exemples), puis un email client.",
        "",
        "UN EMAIL PEUT CONTENIR PLUSIEURS DEMANDES.",
        "1. Repère chaque demande distincte que le client formule réellement : une question qu'il pose, une action",
        "   qu'il attend. Le contexte, les explications de situation, les remerciements ne sont pas des demandes.",
        "2. Rattache chaque demande à l'intention du catalogue qui lui correspond, ou à aucune.",
        "3. Une même intention n'apparaît qu'une fois, même si plusieurs phrases s'y rapportent.",
        "",
        "RÈGLES",
        "- Appuie-toi UNIQUEMENT sur les business descriptions. N'invente aucune intention.",
        "- Les EXCEPTIONS priment : si une exception dit d'orienter ce cas vers une autre intention, rattache la",
        "  demande à cette autre intention si elle est au catalogue ; sinon ne la rattache à rien.",
        "- Une intention n'est retenue que si le client la demande vraiment : un mot-clé seul ne suffit pas.",
        "  Mieux vaut ne rien retenir qu'un faux positif.",
        "- Classe les intentions retenues de la plus importante (raison principale du message) à la moins",
        "  importante. 4 au maximum.",
        "- La confiance reflète ta certitude réelle pour chaque intention, prise isolément.",
        "- extrait : recopie MOT POUR MOT le passage de l'email (une phrase ou un morceau de phrase) qui porte",
        "  la demande. Pas de reformulation.",
        "- Si une demande réelle du client ne correspond à aucune intention du catalogue, résume-la en quelques",
        "  mots dans demandes_non_couvertes : c'est une piste pour créer une nouvelle intention.",
        "",
        "Tu réponds en appelant l'outil detecter_intentions."
      ].join("\n");

      const tool = {
        name: "detecter_intentions",
        description: "Renvoie toutes les intentions détectées dans l'email, de la principale à la secondaire.",
        input_schema: {
          type: "object",
          properties: {
            intentions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  intention_id: { type: "string", enum: ids },
                  confiance: { type: "integer", minimum: 0, maximum: 100 },
                  extrait: { type: "string", description: "Passage de l'email, recopié mot pour mot, qui porte cette demande." },
                  justification: { type: "string", description: "1 phrase, en français : pourquoi cette intention." }
                },
                required: ["intention_id", "confiance", "extrait", "justification"]
              }
            },
            demandes_non_couvertes: { type: "array", items: { type: "string" },
              description: "Demandes réelles du client qu'aucune intention du catalogue ne couvre. Vide si aucune." },
            synthese: { type: "string", description: "1 phrase : ce que demande le client, globalement." }
          },
          required: ["intentions", "demandes_non_couvertes", "synthese"]
        }
      };

      const user = "CATALOGUE DES INTENTIONS :\n\n" + catalogue + "\n\n---\n\nEMAIL CLIENT À ANALYSER :\n\n" + email;
      const res = await callTool(key, MODEL_MATCH, system, user, tool, 1500);

      // garde-fous : ids valides, pas de doublon, 4 au maximum
      const vu = new Set();
      const list = (Array.isArray(res.intentions) ? res.intentions : [])
        .filter(x => x && ids.includes(String(x.intention_id)) && !vu.has(x.intention_id) && vu.add(x.intention_id))
        .slice(0, 4)
        .map(x => ({ intention_id: String(x.intention_id), confiance: Math.max(0, Math.min(100, Number(x.confiance) || 0)),
                     extrait: String(x.extrait || ""), justification: String(x.justification || "") }));

      return { statusCode: 200, headers: H, body: JSON.stringify({
        intentions: list,
        multi: list.length > 1,
        demandes_non_couvertes: (res.demandes_non_couvertes || []).map(String).slice(0, 4),
        synthese: String(res.synthese || ""),
        // compatibilité : intention principale
        intention_id: list[0] ? list[0].intention_id : null,
        confiance: list[0] ? list[0].confiance : null,
        justification: String(res.synthese || (list[0] ? list[0].justification : ""))
      }) };
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
"- Un simple mot-clé présent ne suffit pas : c'est l'intention réelle du client qui compte.\n" +
"- Si l'email contient plusieurs demandes, réponds match = true dès que l'UNE d'elles correspond à cette intention.\n\n" +
"Réponds UNIQUEMENT par un JSON valide :\n" +
'{"match": true|false, "confiance": number (0-100), "justification": string (2 phrases max, en français)}';

      const user = "INTENTION : " + (intention.name || intention.id) + "\n\nBUSINESS DESCRIPTION :\n" +
        intention.description +
        (Array.isArray(intention.exemples) && intention.exemples.length
          ? "\n\nEXEMPLES DÉJÀ VALIDÉS :\n" + intention.exemples.slice(-8).map(e => "- " + txt(e).slice(0, 220)).join("\n")
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
"- Conserve INTÉGRALEMENT la structure et le contenu existants. Tu ajoutes, tu ne réécris pas et tu ne supprimes rien.\n" +
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

    // ---------------------------------------------------------------
    // ACTUALISER : le prompt progresse avec les exemples, sans perdre ce qui existe
    if (action === "actualiser") {
      const it = body.intention || {};
      const nouveaux = Array.isArray(body.nouveaux) ? body.nouveaux : [];
      const anciens = Array.isArray(body.anciens) ? body.anciens : [];
      const autres = Array.isArray(body.autres) ? body.autres : [];
      if (!it.description || (!nouveaux.length && !anciens.length)) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Intention ou exemples manquants." }) };
      }
      const autresIds = autres.map(a => String(a.id));

      const system = [
        "Tu améliores la business description d'UNE intention. Elle sert à détecter l'intention des emails",
        "clients d'un fournisseur d'énergie (Gaz de Bordeaux), et elle est utilisée telle quelle en production.",
        "",
        "On te donne :",
        "- la business description actuelle, validée par l'équipe : elle est bonne, mais incomplète ;",
        "- les emails clients rattachés à cette intention, dont les NOUVEAUX depuis la dernière actualisation ;",
        "- les autres intentions du catalogue (nom et objectif), pour ne pas empiéter sur elles.",
        "",
        "TON TRAVAIL : COMPLÉTER, PAS RÉÉCRIRE",
        "- Tu ne supprimes rien et tu ne reformules aucune ligne existante. Tu proposes uniquement des AJOUTS,",
        "  qui seront placés automatiquement à la suite des lignes existantes. Ne répète pas une ligne déjà présente.",
        "- Seule exception : l'objectif (le paragraphe d'introduction, avant CHAMPS LEXICAUX). Tu le réécris en",
        "  2 à 4 phrases plus complètes : ce que veut le client, les formes que prend sa demande, ce qui la",
        "  distingue des intentions voisines. Il garde tout le sens et tout le périmètre de l'objectif actuel :",
        "  tu l'enrichis, tu ne changes pas son sujet et tu ne l'élargis pas au-delà de ce que montrent les emails.",
        "",
        "CE QUE TU AJOUTES — seulement si les emails le justifient. Une liste vide est une bonne réponse.",
        "- champs_lexicaux : les mots et expressions que les clients emploient réellement dans ces emails et qui",
        "  manquent. Une ligne = des termes entre guillemets, séparés par des virgules, regroupés par thème.",
        "  Aucun terme trop générique qui déclencherait d'autres intentions (« facture » ou « contrat » seuls…).",
        "- intentions_a_detecter : les formes de la demande présentes dans les emails et absentes de la liste.",
        "  Une ligne = « Le client … ».",
        "- exemples_positifs : 3 à 8 phrases courtes, représentatives et variées, tirées des emails (recopiées",
        "  ou légèrement condensées, sans aucune donnée personnelle). Privilégie les formulations qui ne",
        "  ressemblent pas aux exemples déjà présents.",
        "",
        "CE QUE TU NE MODIFIES PAS, MAIS QUE TU SIGNALES",
        "- Les EXCEPTIONS ne sont jamais modifiées automatiquement. Si les emails montrent qu'une exception manque,",
        "  propose-la dans exceptions_suggerees, au format des exceptions existantes",
        "  (Si le client … → orienter vers \"…\"), en ne citant que des intentions du catalogue ou NO MATCH.",
        "- incoherences : les contradictions de la description actuelle (une exception qui exclut ce qu'une",
        "  intention à détecter ou un exemple positif inclut, par exemple), ou entre la description et les",
        "  emails. Cite précisément les lignes en cause. C'est le point le plus utile pour l'équipe.",
        "- exemples_douteux : les emails rattachés à cette intention qui semblent appartenir à une autre",
        "  intention du catalogue. Donne leur référence ([N3], [A1]…), l'intention qui conviendrait et pourquoi.",
        "",
        "STYLE : français, concis, opérationnel, dans le style de la description existante.",
        "Tu réponds en appelant l'outil proposer_actualisation."
      ].join("\n");

      const tool = {
        name: "proposer_actualisation",
        description: "Propose l'objectif enrichi, les ajouts à chaque section, et les points à arbitrer.",
        input_schema: {
          type: "object",
          properties: {
            objectif: { type: "string", description: "Paragraphe d'introduction réécrit (2 à 4 phrases), même sens et même périmètre, plus complet." },
            champs_lexicaux: { type: "array", items: { type: "string" }, description: "Lignes à ajouter. Termes entre guillemets, séparés par des virgules." },
            intentions_a_detecter: { type: "array", items: { type: "string" }, description: "Lignes à ajouter, chacune commençant par « Le client »." },
            exemples_positifs: { type: "array", items: { type: "string" }, description: "Phrases courtes et anonymes, tirées des emails." },
            exceptions_suggerees: { type: "array", items: { type: "string" }, description: "Exceptions suggérées, non appliquées automatiquement." },
            incoherences: { type: "array", items: { type: "string" }, description: "Contradictions repérées, en citant les lignes en cause." },
            exemples_douteux: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ref: { type: "string", description: "Référence de l'email : N1, N2… ou A1, A2…" },
                  intention_suggeree: { type: "string", enum: autresIds.concat(["AUCUNE"]) },
                  raison: { type: "string" }
                },
                required: ["ref", "intention_suggeree", "raison"]
              }
            },
            resume: { type: "string", description: "3 à 5 puces en français : ce qui change et pourquoi." }
          },
          required: ["objectif", "champs_lexicaux", "intentions_a_detecter", "exemples_positifs",
                     "exceptions_suggerees", "incoherences", "exemples_douteux", "resume"]
        }
      };

      const fmt = (list, p) => list.map((e, k) =>
        "[" + p + (k + 1) + "]" + (e.multi ? " (extrait d'un email qui contient aussi d'autres demandes)" : "") +
        "\n" + txt(e).slice(0, 700)).join("\n\n");

      const user =
        "INTENTION : " + (it.name || it.id) + " (" + it.id + ")\n\n" +
        "BUSINESS DESCRIPTION ACTUELLE (validée) :\n" + it.description + "\n\n---\n\n" +
        "AUTRES INTENTIONS DU CATALOGUE :\n" +
        (autres.length ? autres.map(a => "- " + a.id + " — " + a.name + " : " + intro(a.description).slice(0, 220)).join("\n") : "(aucune)") +
        "\n\n---\n\n" +
        "EMAILS NOUVEAUX DEPUIS LA DERNIÈRE ACTUALISATION (" + nouveaux.length + ") :\n\n" + (nouveaux.length ? fmt(nouveaux, "N") : "(aucun)") +
        "\n\n---\n\n" +
        "EMAILS DÉJÀ PRIS EN COMPTE LORS DES ACTUALISATIONS PRÉCÉDENTES (" + anciens.length + ") :\n\n" + (anciens.length ? fmt(anciens, "A") : "(aucun)");

      const res = await callTool(key, MODEL_REFINE, system, user, tool, 5000);
      const arr = (v) => (Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : []);
      return { statusCode: 200, headers: H, body: JSON.stringify({
        objectif: String(res.objectif || "").trim(),
        champs_lexicaux: arr(res.champs_lexicaux),
        intentions_a_detecter: arr(res.intentions_a_detecter),
        exemples_positifs: arr(res.exemples_positifs),
        exceptions_suggerees: arr(res.exceptions_suggerees),
        incoherences: arr(res.incoherences),
        exemples_douteux: (Array.isArray(res.exemples_douteux) ? res.exemples_douteux : [])
          .map(x => ({ ref: String(x.ref || ""), intention_suggeree: String(x.intention_suggeree || ""), raison: String(x.raison || "") })),
        resume: String(res.resume || "")
      }) };
    }

    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Action inconnue : " + action }) };

  } catch (err) {
    return { statusCode: 502, headers: H, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};

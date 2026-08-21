/* ============================================================
   Sondage de ressenti — anonyme, sans login.
   - Se branche sur le ping de comptage existant (functions/track).
   - Compte les usages par outil dans le navigateur (localStorage).
   - Au 3e usage d'un outil, propose 2 notes (1-5) puis les envoie
     à la fonction serveur "feedback". Aucune donnée personnelle.
   Il suffit d'inclure ce fichier dans chaque outil :
     <script src="feedback.js"></script>
   ============================================================ */
(function(){
  "use strict";
  var THRESHOLD = 3;

  function ls(){ try{ return window.localStorage; }catch(e){ return null; } }
  function getNum(k){ var s=ls(); if(!s) return 0; try{ return parseInt(s.getItem(k)||"0",10)||0; }catch(e){ return 0; } }
  function setNum(k,v){ var s=ls(); if(!s) return; try{ s.setItem(k,String(v)); }catch(e){} }

  // --- Détection des usages : on observe le ping de comptage déjà présent ---
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if(origFetch){
    window.fetch = function(url, opts){
      try{
        var u = (typeof url === "string") ? url : (url && url.url);
        if(u && u.indexOf("/.netlify/functions/track") >= 0 && opts && opts.body){
          var tool = JSON.parse(opts.body).tool;
          if(tool) setTimeout(function(){ onUse(String(tool)); }, 400);
        }
      }catch(e){}
      return origFetch(url, opts);
    };
  }

  function onUse(tool){
    if(getNum("fb_done_"+tool)) return;                 // a déjà répondu
    var n = getNum("fb_uses_"+tool) + 1;
    setNum("fb_uses_"+tool, n);
    var snooze = getNum("fb_snooze_"+tool);             // report éventuel
    if(n >= THRESHOLD && n >= snooze){ showSurvey(tool); }
  }

  function prettyTool(tool){
    return tool.replace(/[-_]+/g," ").replace(/\b\w/g,function(c){return c.toUpperCase();});
  }

  function injectStyles(){
    if(document.getElementById("fb-styles")) return;
    var s = document.createElement("style"); s.id="fb-styles";
    s.textContent =
    "#fb-overlay{position:fixed;inset:0;background:rgba(20,24,20,.5);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}"+
    ".fb-modal{background:#fff;max-width:440px;width:100%;border-radius:14px;padding:26px 26px 22px;box-shadow:0 30px 60px -20px rgba(0,0,0,.4);color:#0E1B2A}"+
    ".fb-eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#EF7D00;font-weight:700;margin-bottom:8px}"+
    ".fb-modal h3{font-size:1.15rem;letter-spacing:-.01em;margin:0 0 6px}"+
    ".fb-modal p.fb-sub{color:#5A6B7B;font-size:.9rem;margin:0 0 20px}"+
    ".fb-q{font-size:.95rem;font-weight:600;margin:0 0 10px}"+
    ".fb-scale{display:flex;gap:8px;margin-bottom:20px}"+
    ".fb-dot{flex:1;height:42px;border:1px solid #D2DAE4;background:#F4F6FA;border-radius:8px;font-size:15px;font-weight:600;color:#5A6B7B;cursor:pointer;transition:all .12s}"+
    ".fb-dot:hover{border-color:#0B3A67}"+
    ".fb-dot.sel{background:#0B3A67;border-color:#0B3A67;color:#fff}"+
    ".fb-actions{display:flex;justify-content:space-between;align-items:center;margin-top:6px}"+
    ".fb-later{background:none;border:none;color:#5A6B7B;font-size:.86rem;cursor:pointer;text-decoration:underline}"+
    ".fb-send{background:#0B3A67;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:.92rem;font-weight:600;cursor:pointer}"+
    ".fb-send:disabled{opacity:.4;cursor:default}"+
    ".fb-anon{font-size:.78rem;color:#8A8578;margin-top:14px;text-align:center}"+
    ".fb-thanks{font-size:.95rem;color:#1C7C54;text-align:center;padding:8px 0}";
    document.head.appendChild(s);
  }

  function buildScale(name){
    var html = '<div class="fb-scale" data-name="'+name+'">';
    for(var i=1;i<=5;i++){ html += '<button type="button" class="fb-dot" data-v="'+i+'">'+i+'</button>'; }
    return html + '</div>';
  }

  function showSurvey(tool){
    if(document.getElementById("fb-overlay") || !document.body) return;
    injectStyles();
    var answers = { bienEtre:0, utilite:0 };

    var overlay = document.createElement("div");
    overlay.id = "fb-overlay";
    overlay.innerHTML =
      '<div class="fb-modal" role="dialog" aria-modal="true">'+
        '<div class="fb-eyebrow">Votre avis compte</div>'+
        '<h3>Un retour rapide sur « '+prettyTool(tool)+' » ?</h3>'+
        '<p class="fb-sub">Vous utilisez cet outil régulièrement — deux questions, 10 secondes, totalement anonyme.</p>'+
        '<div class="fb-q">Votre bien-être au travail grâce à cette automatisation</div>'+
        buildScale("bienEtre")+
        '<div class="fb-q">L\'utilité de cet outil dans votre quotidien</div>'+
        buildScale("utilite")+
        '<div class="fb-actions">'+
          '<button class="fb-later" type="button">Plus tard</button>'+
          '<button class="fb-send" type="button" disabled>Envoyer</button>'+
        '</div>'+
        '<div class="fb-anon">Réponse anonyme · aucune donnée personnelle enregistrée</div>'+
      '</div>';
    document.body.appendChild(overlay);

    var sendBtn = overlay.querySelector(".fb-send");
    overlay.querySelectorAll(".fb-scale").forEach(function(scale){
      var name = scale.getAttribute("data-name");
      scale.querySelectorAll(".fb-dot").forEach(function(dot){
        dot.addEventListener("click", function(){
          scale.querySelectorAll(".fb-dot").forEach(function(d){ d.classList.remove("sel"); });
          dot.classList.add("sel");
          answers[name] = parseInt(dot.getAttribute("data-v"),10);
          sendBtn.disabled = !(answers.bienEtre && answers.utilite);
        });
      });
    });

    overlay.querySelector(".fb-later").addEventListener("click", function(){
      setNum("fb_snooze_"+tool, getNum("fb_uses_"+tool) + 3); // re-proposer dans 3 usages
      overlay.remove();
    });

    sendBtn.addEventListener("click", function(){
      if(!(answers.bienEtre && answers.utilite)) return;
      setNum("fb_done_"+tool, 1);
      try{
        (window.fetch)("/.netlify/functions/feedback", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ tool: tool, bienEtre: answers.bienEtre, utilite: answers.utilite })
        }).catch(function(){});
      }catch(e){}
      overlay.querySelector(".fb-modal").innerHTML =
        '<div class="fb-eyebrow">Merci</div><div class="fb-thanks">Votre retour a bien été pris en compte.</div>';
      setTimeout(function(){ if(overlay.parentNode) overlay.remove(); }, 1400);
    });

    overlay.addEventListener("click", function(e){ if(e.target === overlay){ /* clic hors modale = plus tard */ overlay.querySelector(".fb-later").click(); } });
  }
})();

/* Carnet d'étude — version web : branchement sur Supabase.
   Fournit à l'app les mêmes services que l'artifact claude.ai, via window.claude.use(nom) :
     db     : documents aux mêmes chemins que la V1 (data/users/<uid>/carnet/projets/…), rangés dans les tables
              projets, supports, fils ;
     user   : identifiant du compte connecté ;
     sample : Claude, via la fonction serveur « chat » (la clé API reste sur le serveur) ;
     assets : photos et PDF dans Supabase Storage (bucket privé « supports »).
   Tant que personne n'est connecté, affiche l'écran de connexion (lien par e-mail, code, ou Google). */
"use strict";
(function () {
  const CFG = window.CARNET_CONFIG || {};
  const BUCKET = "supports";
  const REF = "storage:" + BUCKET + "/";
  const SIGNED_TTL = 24 * 3600;           // durée des liens temporaires vers les fichiers (secondes)
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseAnonKey || /préciser/.test(CFG.supabaseAnonKey)) {
    document.addEventListener("DOMContentLoaded", () => {
      $("#app").innerHTML = `<div class="notice"><b>Carnet indisponible.</b><br>${!window.supabase
        ? "Une bibliothèque n'a pas pu se charger. Vérifie ta connexion internet puis recharge la page."
        : "Configuration incomplète (adresse ou clé publique Supabase dans config.js). Préviens l'équipe."}</div>`;
    });
    window.claude = { use: () => new Promise(() => {}) };
    return;
  }

  // Erreur de connexion renvoyée dans l'adresse (#error=… ou ?error=…), lue avant que la bibliothèque ne touche à l'adresse.
  const erreurRetour = (() => {
    const p = new URLSearchParams(location.hash.slice(1)); const q = new URLSearchParams(location.search);
    const code = p.get("error_code") || q.get("error_code") || p.get("error") || q.get("error");
    if (!code) return null;
    return { code, description: (p.get("error_description") || q.get("error_description") || "").replace(/\+/g, " ") };
  })();
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
  });

  /* ---------- Connexion ---------- */
  let session = null;
  // Lien reçu par e-mail au format …/?token_hash=…&type=email : c'est l'app qui valide la connexion.
  // Les aperçus automatiques (messageries, WhatsApp) ouvrent la page sans lancer l'app : ils ne « grillent » plus le lien.
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get("token_hash");
  const typeLien = ["email", "magiclink", "signup"].includes(params.get("type")) ? params.get("type") : "email";
  if (tokenHash) {
    params.delete("token_hash"); params.delete("type");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
  }
  let lienRate = false;
  const pret = new Promise(resolve => {
    const fini = s => { if (s && !session) { session = s; resolve(s); } };
    sb.auth.onAuthStateChange((evt, s) => {
      if (evt === "SIGNED_OUT") { session = null; return; }
      if (s) { if (session) session = s; else fini(s); }
    });
    sb.auth.getSession().then(async ({ data }) => {
      if (data && data.session) return fini(data.session);
      if (tokenHash) {
        const { data: d, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: typeLien });
        if (!error && d && d.session) return fini(d.session);
        lienRate = true;
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ecranConnexion);
      else ecranConnexion();
    });
  });
  const jeton = async () => { const { data } = await sb.auth.getSession(); if (data && data.session) session = data.session; return session && session.access_token; };

  function ecranConnexion() {
    if (session) return;
    const LIEN = "Le lien de connexion que tu as ouvert n'est plus valable (il a expiré ou a déjà servi). Pas de souci : demande un nouveau lien ci-dessous, ou utilise Google.";
    let erreurLien = lienRate ? LIEN : "";
    if (erreurRetour) {
      const lienEmail = /otp_expired|otp_disabled|flow_state_expired/.test(erreurRetour.code) || /email link|otp/i.test(erreurRetour.description);
      erreurLien = lienEmail ? LIEN : erreurRetour.code === "access_denied" && !erreurRetour.description
        ? "Connexion annulée. Tu peux réessayer, ou utiliser ton adresse e-mail."
        : `La connexion n'a pas abouti${erreurRetour.description ? ` (message du serveur : « ${erreurRetour.description} »)` : ""}. Réessaie, ou utilise ton adresse e-mail. Si ça recommence, envoie une capture de ce message à l'équipe.`;
      const q = new URLSearchParams(location.search); ["error", "error_code", "error_description"].forEach(k => q.delete(k));
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
    }
    $("#top").innerHTML = `<div class="brand"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/></svg><span>Carnet d'étude</span></div>`;
    $("#app").innerHTML = `
      <div class="hello"><h1>Connexion</h1><p>Connecte-toi pour retrouver tes projets sur tous tes appareils. Pas besoin de compte Claude.</p></div>
      <div class="form" id="login">
        <button class="btn" id="login-google" type="button">Continuer avec Google</button>
        <p class="hint" style="text-align:center;margin:0">ou</p>
        <form id="login-form" class="field" novalidate>
          <label for="login-email">Ton adresse e-mail</label>
          <input type="email" id="login-email" autocomplete="email" inputmode="email" required placeholder="prenom@exemple.com">
          <button class="btn primary" type="submit" id="login-send">Recevoir un lien de connexion</button>
        </form>
        <form id="login-code" class="field" novalidate hidden>
          <p class="hint" id="login-sent"></p>
          <label for="login-otp">Ou saisis le code reçu dans l'e-mail</label>
          <input type="text" id="login-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">
          <div class="row"><button class="btn primary" type="submit" id="login-verify">Valider le code</button>
            <button class="btn ghost" type="button" id="login-back">Changer d'adresse</button></div>
        </form>
        <p class="err" id="login-err" role="alert" ${erreurLien ? "" : "hidden"}>${esc(erreurLien)}</p>
      </div>`;
    const err = m => { const e = $("#login-err"); e.textContent = m; e.hidden = !m; };
    const url = location.origin + location.pathname;
    $("#login-google").onclick = async () => {
      err("");
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: url } });
      if (error) err("La connexion avec Google n'a pas marché. Réessaie, ou utilise ton adresse e-mail.");
    };
    $("#login-form").onsubmit = async ev => {
      ev.preventDefault(); err("");
      const email = $("#login-email").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Écris une adresse e-mail valide.");
      const b = $("#login-send"); b.disabled = true; b.textContent = "Envoi…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: url, shouldCreateUser: true } });
      b.disabled = false; b.textContent = "Recevoir un lien de connexion";
      if (error) return err(error.status === 429 ? "Trop de demandes. Attends une minute avant de redemander un lien."
        : "L'e-mail n'a pas pu être envoyé. Vérifie l'adresse et ta connexion, puis réessaie.");
      $("#login-form").hidden = true; $("#login-code").hidden = false;
      $("#login-sent").textContent = `Lien envoyé à ${email}. Ouvre l'e-mail et touche le lien (regarde aussi dans les spams).`;
      $("#login-code").dataset.email = email;
    };
    $("#login-code").onsubmit = async ev => {
      ev.preventDefault(); err("");
      const token = $("#login-otp").value.replace(/\s/g, "");
      if (!/^\d{6,10}$/.test(token)) return err("Le code contient des chiffres uniquement (6 en général).");
      const { error } = await sb.auth.verifyOtp({ email: $("#login-code").dataset.email, token, type: "email" });
      if (error) err("Code incorrect ou expiré. Vérifie-le, ou demande un nouveau lien.");
    };
    $("#login-back").onclick = () => { $("#login-code").hidden = true; $("#login-form").hidden = false; err(""); };
  }

  async function deconnexion() { await sb.auth.signOut().catch(() => {}); location.reload(); }

  /* ---------- Fichiers : références « storage:supports/<chemin> » ↔ liens temporaires ---------- */
  const signes = new Map();      // référence → { url, exp }
  const inverses = new Map();    // lien temporaire → référence
  const chemin = ref => ref.slice(REF.length);
  async function signer(refs) {
    const now = Date.now();
    const manquants = [...new Set(refs)].filter(r => { const s = signes.get(r); return !s || s.exp < now + 600000; });
    if (manquants.length) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(manquants.map(chemin), SIGNED_TTL);
      if (!error && data) data.forEach((d, i) => {
        if (d && d.signedUrl) { const r = manquants[i]; signes.set(r, { url: d.signedUrl, exp: now + SIGNED_TTL * 1000 }); inverses.set(d.signedUrl, r); }
      });
    }
  }
  const versAffichage = u => (typeof u === "string" && u.startsWith(REF) && signes.has(u)) ? signes.get(u).url : u;
  const versStockage = u => {
    if (typeof u !== "string") return u;
    if (inverses.has(u)) return inverses.get(u);
    const m = u.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?]+)\/([^?#]+)/);
    return m && m[1] === BUCKET ? REF + decodeURIComponent(m[2]) : u;
  };
  const refsDe = rows => {
    const out = [];
    for (const r of rows) {
      if (typeof r.url === "string" && r.url.startsWith(REF)) out.push(r.url);
      if (Array.isArray(r.turns)) for (const t of r.turns) if (t && typeof t.img === "string" && t.img.startsWith(REF)) out.push(t.img);
    }
    return out;
  };

  /* ---------- Correspondance documents V1 ↔ lignes Supabase ---------- */
  const ms = v => v ? Date.parse(v) : undefined;
  const iso = v => Number.isFinite(v) ? new Date(v).toISOString() : undefined;
  const sansVide = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const TABLES = {
    projets: {
      cols: { titre: "titre", type: "type", matiere: "matiere", objectif: "objectif", echeance: "echeance", parentId: "parent_id",
        focus: "focus", nbSupports: "nb_supports", plan: "plan", evolutions: "evolutions", createdAt: "created_at", updatedAt: "updated_at" },
      versDoc: r => sansVide({ ...(r.extra || {}), titre: r.titre, type: r.type, matiere: r.matiere, objectif: r.objectif, echeance: r.echeance || "",
        parentId: r.parent_id || undefined, focus: r.focus ?? undefined, nbSupports: r.nb_supports, plan: r.plan || [], evolutions: r.evolutions || [],
        createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) }),
      valeur: (k, v) => k === "echeance" ? (v || null) : (k === "createdAt" || k === "updatedAt") ? iso(v) : v,
    },
    supports: {
      cols: { nom: "nom", kind: "kind", texte: "texte", actif: "actif", url: "url", assetId: "asset_id", pages: "pages",
        tronque: "tronque", herite: "herite", createdAt: "created_at" },
      versDoc: r => sansVide({ ...(r.extra || {}), nom: r.nom, kind: r.kind, texte: r.texte, actif: r.actif, url: r.url ? versAffichage(r.url) : undefined,
        assetId: r.asset_id || undefined, pages: r.pages ?? undefined, tronque: r.tronque ?? undefined, herite: r.herite ?? undefined, createdAt: ms(r.created_at) }),
      valeur: (k, v) => k === "createdAt" ? iso(v) : k === "url" ? versStockage(v) : v,
    },
    fils: {
      cols: { turns: "turns" },
      versDoc: r => ({ ...(r.extra || {}), turns: (r.turns || []).map(t => t && t.img ? { ...t, img: versAffichage(t.img) } : t) }),
      valeur: (k, v) => k === "turns" ? (v || []).map(t => t && t.img ? { ...t, img: versStockage(t.img) } : t) : v,
    },
  };
  function versLigne(table, data, { complet }) {
    const T = TABLES[table]; const ligne = {}; const extra = {};
    for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(data)))) {
      if (T.cols[k]) ligne[T.cols[k]] = T.valeur(k, v); else extra[k] = v;
    }
    if (complet && table !== "fils") ligne.extra = extra;
    return { ligne, extra };
  }

  /* Chemin V1 → { table, filtres, id } */
  function analyser(path) {
    const s = path.split("/");
    if (s[0] !== "data" || s[1] !== "users" || s[3] !== "carnet") throw { code: "invalid_argument", message: "Chemin inconnu : " + path };
    if (!session || s[2] !== session.user.id) throw { code: "permission_denied" };
    if (s.length === 4) return { racine: true };
    if (s[4] !== "projets") throw { code: "invalid_argument", message: "Chemin inconnu : " + path };
    if (s.length === 5) return { table: "projets", filtres: {} };
    if (s.length === 6) return { table: "projets", filtres: {}, id: s[5] };
    const sous = { supports: "supports", fil: "fils" }[s[6]];
    if (!sous) throw { code: "invalid_argument", message: "Chemin inconnu : " + path };
    if (s.length === 7) return { table: sous, filtres: { projet_id: s[5] } };
    if (s.length === 8) return { table: sous, filtres: { projet_id: s[5] }, id: s[7] };
    throw { code: "invalid_argument", message: "Chemin inconnu : " + path };
  }
  const echec = error => { const e = new Error(error.message || "Erreur Supabase"); e.code = error.code === "42501" ? "permission_denied" : "unavailable"; e.cause = error; return e; };
  function requete(q, a) { q = q.eq("owner", session.user.id); for (const [k, v] of Object.entries(a.filtres)) q = q.eq(k, v); if (a.id) q = q.eq("id", a.id); return q; }

  async function lire(a) {
    const { data, error } = await requete(sb.from(a.table).select("*"), a);
    if (error) throw echec(error);
    await signer(refsDe(data || []));
    return (data || []).map(r => ({ id: r.id, data: TABLES[a.table].versDoc(r) }));
  }
  const snapDoc = (path, row) => ({ id: path.split("/").pop(), exists: !!row, data: () => row ? row.data : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const snapCol = rows => { const docs = rows.map(r => ({ id: r.id, exists: true, data: () => r.data, metadata: {} })); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; };

  /* Écoute : relecture après chaque écriture locale et au retour sur la page. */
  const ecoutes = new Set();
  let relecture = null;
  function rafraichir() {
    clearTimeout(relecture);
    relecture = setTimeout(() => ecoutes.forEach(f => f()), 40);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && session) rafraichir(); });

  async function ecrireDoc(a, data, mode) {
    if (a.racine) {                             // document « carnet » de la V1 : sert seulement à vérifier que la base répond
      const { error } = await sb.from("projets").select("id").limit(1);
      if (error) throw echec(error);
      return;
    }
    const base = { ...a.filtres, id: a.id };
    if (mode === "set") {
      const { ligne } = versLigne(a.table, data, { complet: true });
      const row = { ...base, owner: session.user.id, ...ligne };
      if (a.table === "fils") row.updated_at = new Date().toISOString();
      const { error } = await sb.from(a.table).upsert(row, { onConflict: a.table === "fils" ? "projet_id,id" : "id" });
      if (error) throw echec(error);
    } else {
      const { ligne, extra } = versLigne(a.table, data, { complet: false });
      if (a.table === "fils") ligne.updated_at = new Date().toISOString();
      if (Object.keys(extra).length && a.table !== "fils") {
        const { data: cur, error } = await requete(sb.from(a.table).select("extra"), a).maybeSingle();
        if (error) throw echec(error);
        if (!cur) throw { code: "invalid_argument" };
        ligne.extra = { ...(cur.extra || {}), ...extra };
      }
      const { data: maj, error } = await requete(sb.from(a.table).update(ligne), a).select("id");
      if (error) throw echec(error);
      if (!maj || !maj.length) throw { code: "invalid_argument" };   // comme la V1 : update d'un document absent
    }
  }

  function docRef(path) {
    const a = () => analyser(path);
    return {
      id: path.split("/").pop(), path,
      get: async () => { const x = a(); if (x.racine) return snapDoc(path, { data: {} }); return snapDoc(path, (await lire(x))[0]); },
      set: async d => { await ecrireDoc(a(), d, "set"); rafraichir(); },
      update: async d => { await ecrireDoc(a(), d, "update"); rafraichir(); },
      delete: async () => { const x = a(); if (!x.racine) { const { error } = await requete(sb.from(x.table).delete(), x); if (error) throw echec(error); } rafraichir(); },
      onSnapshot: (next, onErr) => {
        let actif = true;
        const f = () => { const x = a(); lire(x).then(r => actif && next(snapDoc(path, r[0])), e => actif && onErr && onErr(e)); };
        ecoutes.add(f); f();
        return () => { actif = false; ecoutes.delete(f); };
      },
      collection: c => colRef(path + "/" + c),
    };
  }
  function colRef(path) {
    const a = () => analyser(path);
    return {
      path,
      get: async () => snapCol(await lire(a())),
      onSnapshot: (next, onErr) => {
        let actif = true;
        const f = () => lire(a()).then(r => actif && next(snapCol(r)), e => actif && onErr && onErr(e));
        ecoutes.add(f); f();
        return () => { actif = false; ecoutes.delete(f); };
      },
      doc: id => docRef(path + "/" + (id || rid())),
      add: async d => { const r = docRef(path + "/" + rid()); await r.set(d); return r; },
    };
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- Fichiers ---------- */
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
  const assets = {
    async upload(blob) {
      const type = blob.type || "application/octet-stream";
      const p = `${session.user.id}/f/${rid()}.${EXT[type] || "bin"}`;
      const { error } = await sb.storage.from(BUCKET).upload(p, blob, { contentType: type, upsert: false });
      if (error) throw { code: /size|exceed/i.test(error.message || "") ? "quota_exceeded" : "unavailable", message: error.message };
      await signer([REF + p]);
      return { id: p, url: versAffichage(REF + p) };
    },
    async delete(id) {
      const p = String(id).startsWith(REF) ? chemin(String(id)) : String(id);
      if (!p.startsWith(session.user.id + "/")) return;         // jamais le fichier d'un autre (ou un ancien fichier de l'artifact)
      const { error } = await sb.storage.from(BUCKET).remove([p]);
      if (error) throw { code: "unavailable", message: error.message };
    },
  };

  /* ---------- Claude (fonction serveur « chat ») ---------- */
  const MSG = {
    reseau: "Connexion internet coupée ou trop lente. Vérifie ta connexion puis réessaie.",
    session_expired: "Ta session a expiré : reconnecte-toi (recharge la page) puis réessaie.",
  };
  const enBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  let dernierQuota = null;
  async function sample(input, opts = {}) {
    const corps = { tier: opts.modelTier === "complex" ? "complex" : "default",
      tache: opts.tache || (opts.json ? "plan" : opts.images && opts.images.length ? "transcription" : opts.onText ? "seance" : "resume") };
    if (typeof input === "string") corps.prompt = input; else corps.messages = input;
    if (opts.images && opts.images.length) corps.images = await Promise.all(opts.images.map(async b => ({ media_type: b.type || "image/jpeg", data: await enBase64(b) })));
    const t = await jeton();
    if (!t) throw { code: "session_expired", message: MSG.session_expired, serveur: true };
    let rep;
    try {
      rep = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/chat", {
        method: "POST", signal: opts.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + t, apikey: CFG.supabaseAnonKey },
        body: JSON.stringify(corps),
      });
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw { code: "cancelled", text: "" };
      throw { code: "reseau", message: MSG.reseau, serveur: true };
    }
    if (!rep.ok) {
      const j = await rep.json().catch(() => null); const e = (j && j.erreur) || {};
      if (e.quota) dernierQuota = e.quota;
      throw { code: e.code || "erreur_serveur", message: e.message || MSG.reseau, serveur: true, quota: e.quota };
    }
    const lecteur = rep.body.getReader(); const dec = new TextDecoder();
    let tampon = "", texte = "", fin = null, erreur = null;
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value, { stream: true });
        let i;
        while ((i = tampon.indexOf("\n")) >= 0) {
          const ligne = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1);
          if (!ligne) continue;
          const o = JSON.parse(ligne);
          if (o.type === "texte") { texte += o.delta; opts.onText && opts.onText({ text: texte, delta: o.delta }); }
          else if (o.type === "fin") fin = o;
          else if (o.type === "erreur") erreur = o;
        }
      }
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw { code: "cancelled", text: texte };
      throw { code: "reseau", message: MSG.reseau, serveur: true, text: texte };
    }
    if (erreur) throw { code: erreur.code, message: erreur.message, serveur: true, text: erreur.code === "refused" ? undefined : (texte || undefined) };
    if (!fin) throw { code: "reseau", message: MSG.reseau, serveur: true, text: texte || undefined };
    dernierQuota = fin.quota || dernierQuota;
    if (dernierQuota && dernierQuota.limite && dernierQuota.utilise / dernierQuota.limite >= 0.8 && typeof window.toast === "function" && !sample._prevenu) {
      sample._prevenu = true;
      const reste = Math.max(0, Math.round(100 - 100 * dernierQuota.utilise / dernierQuota.limite));
      setTimeout(() => window.toast(`Il te reste environ ${reste} % de ton quota IA de la semaine.`, 6000), 800);
    }
    return { text: fin.text, truncated: !!fin.tronque, modelTierApplied: corps.tier };
  }
  sample.json = async (input, opts = {}) => {
    const r = await sample(input, { ...opts, json: true });
    const t = r.text.replace(/^[\s\S]*?```(?:json)?\s*/i, m => (/```/.test(m) ? "" : m)).replace(/```[\s\S]*$/, "").trim();
    const debut = t.search(/[[{]/);
    try { return JSON.parse(debut >= 0 ? t.slice(debut) : t); }
    catch { throw { code: "invalid_json" }; }
  };
  sample.limits = async () => ({ maxPromptBytes: 300000, images: { maxCount: 5, maxInputBytes: 3500000, mediaTypes: ["image/jpeg", "image/png"] } });

  /* ---------- Exposition ---------- */
  const user = { id: async () => session.user.id, email: async () => session.user.email };
  const caps = { db, sample, assets, user };
  window.claude = { use: async n => { await pret; return caps[n] ?? null; } };
  window.carnetWeb = { deconnexion, quota: () => dernierQuota, email: () => session && session.user.email };
})();

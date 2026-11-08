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

  /* ---------- Connexion et compte ---------- */
  // Écrans : connexion (mot de passe), inscription, code reçu par e-mail, mot de passe oublié, nouveau mot de passe,
  // vérification de l'adresse, profil (niveau d'étude). L'app ne démarre qu'avec une session ET un profil complet.
  let session = null;
  let profil = null;
  let modeRecup = false;            // arrivé par un lien « mot de passe oublié » : choisir un nouveau mot de passe d'abord
  const NIVEAUX = { primaire: "Primaire", secondaire: "Secondaire", universitaire: "Universitaire" };
  const FOURNISSEURS = { google: "Google", facebook: "Facebook" };   // Apple retiré (décision du 2026-11-07)
  const adresseApp = location.origin + location.pathname;

  // Lien reçu par e-mail au format …/?token_hash=…&type=… : c'est l'app qui valide (les aperçus automatiques
  // des messageries ne lancent pas l'app, ils ne « grillent » donc plus le lien).
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get("token_hash");
  const typeLien = ["email", "magiclink", "signup", "recovery"].includes(params.get("type")) ? params.get("type") : "email";
  if (tokenHash) {
    params.delete("token_hash"); params.delete("type");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
  }
  if (tokenHash && typeLien === "recovery") modeRecup = true;
  if (/type=recovery/.test(location.hash)) modeRecup = true;
  let lienRate = false;

  const domPret = fn => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn());
  let finir;
  const pret = new Promise(r => { finir = r; });
  let suiteLancee = false;
  async function avecSession(s) {
    session = s;
    if (suiteLancee) return; suiteLancee = true;
    if (modeRecup) { domPret(() => ecran("nouveau-mdp")); return; }
    await verifierProfil();
  }
  async function verifierProfil() {
    const { data, error } = await sb.from("profils").select("*").eq("owner", session.user.id).maybeSingle();
    if (error) { console.warn("Profil illisible, l'app démarre sans niveau :", error.message); return finir(session); }
    if (data && data.niveau) { profil = data; return finir(session); }
    // Profil rempli à l'inscription (métadonnées du compte) : on l'enregistre sans rien redemander.
    const m = session.user.user_metadata || {};
    if (NIVEAUX[m.niveau] && typeof m.majeur === "boolean" && (m.majeur || m.accord_parental)) {
      const p = { owner: session.user.id, prenom: String(m.prenom || "").slice(0, 80), niveau: m.niveau, majeur: m.majeur, accord_parental: !!m.accord_parental };
      const r = await sb.from("profils").upsert(p, { onConflict: "owner" });
      if (!r.error) { profil = p; return finir(session); }
    }
    domPret(() => ecran("profil"));
  }
  sb.auth.onAuthStateChange((evt, s) => {
    if (evt === "SIGNED_OUT") { session = null; return; }
    if (evt === "PASSWORD_RECOVERY") modeRecup = true;
    if (s) { if (session) session = s; else avecSession(s); }
  });
  sb.auth.getSession().then(async ({ data }) => {
    if (data && data.session) return avecSession(data.session);
    if (tokenHash) {
      const { data: d, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: typeLien });
      if (!error && d && d.session) return avecSession(d.session);
      lienRate = true;
    }
    domPret(() => ecran(modeRecup ? "oubli" : "connexion"));
  });
  const jeton = async () => { const { data } = await sb.auth.getSession(); if (data && data.session) session = data.session; return session && session.access_token; };

  // Modes de connexion activés dans Supabase : le bouton Facebook n'apparaît qu'une fois activé.
  const fournisseurs = fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/auth/v1/settings", { headers: { apikey: CFG.supabaseAnonKey } })
    .then(r => r.ok ? r.json() : null).then(d => (d && d.external) || { google: true }).catch(() => ({ google: true }));

  /* Messages d'erreur de Supabase → français */
  function traduire(error, cas) {
    const m = String((error && (error.code || "") + " " + (error.message || "")) || "").toLowerCase();
    if (error && error.status === 429 || /rate limit|too many/.test(m)) return "Trop de demandes d'affilée. Attends une minute puis réessaie.";
    if (/invalid_credentials|invalid login credentials/.test(m)) return "Adresse e-mail ou mot de passe incorrect.";
    if (/email_not_confirmed|email not confirmed/.test(m)) return "Ton adresse n'est pas encore confirmée : ouvre l'e-mail d'activation que tu as reçu (regarde aussi dans les spams).";
    if (/weak_password|password should|password is too/.test(m)) return "Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres.";
    if (/same_password|should be different/.test(m)) return "Choisis un mot de passe différent de l'ancien.";
    if (/otp_expired|token has expired|invalid/.test(m) && cas === "code") return "Code incorrect ou expiré. Vérifie-le, ou demande un nouvel e-mail.";
    if (/signup.*disabled|signups not allowed/.test(m)) return "Les inscriptions sont fermées pour le moment.";
    if (/failed to fetch|network/.test(m)) return "Connexion internet coupée ou trop lente. Vérifie ta connexion puis réessaie.";
    return "Ça n'a pas marché. Réessaie dans un instant ; si ça continue, préviens l'équipe.";
  }
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const mdpOk = p => p.length >= 8 && /[A-Za-zÀ-ÿ]/.test(p) && /\d/.test(p);

  function messageRetour() {
    const LIEN = "Le lien que tu as ouvert n'est plus valable (il a expiré ou a déjà servi). Pas de souci : redemande un e-mail ci-dessous, ou connecte-toi autrement.";
    let m = lienRate ? LIEN : "";
    if (erreurRetour) {
      const lienEmail = /otp_expired|otp_disabled/.test(erreurRetour.code) || /email link|otp/i.test(erreurRetour.description);
      m = lienEmail ? LIEN : erreurRetour.code === "access_denied" && !erreurRetour.description
        ? "Connexion annulée. Tu peux réessayer, ou utiliser ton adresse e-mail."
        : `La connexion n'a pas abouti${erreurRetour.description ? ` (message du serveur : « ${erreurRetour.description} »)` : ""}. Réessaie, ou utilise ton adresse e-mail. Si ça recommence, envoie une capture de ce message à l'équipe.`;
      const q = new URLSearchParams(location.search); ["error", "error_code", "error_description"].forEach(k => q.delete(k));
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
    }
    return m;
  }

  const ICONE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/></svg>`;
  const champMdp = (id, label, auto) => `<div class="field"><label for="${id}">${label}</label>
    <div class="mdp"><input type="password" id="${id}" autocomplete="${auto}" minlength="8" required>
    <button type="button" class="btn ghost voir" data-voir="${id}" aria-label="Afficher le mot de passe" aria-pressed="false">👁</button></div></div>`;
  const champNiveau = (pref, v = {}) => `
    <div class="field"><span class="lbl" id="${pref}-niveau-lbl">Ton niveau d'étude</span>
      <p class="hint">Claude adapte ses explications à ton niveau.${pref === "m" ? "" : " Tu pourras le changer dans « Mon compte »."}</p>
      <div class="choix" role="radiogroup" aria-labelledby="${pref}-niveau-lbl">${Object.entries(NIVEAUX).map(([k, n]) =>
        `<label class="type"><input type="radio" name="${pref}-niveau" id="${pref}-niveau-${k}" value="${k}" ${v.niveau === k ? "checked" : ""}><span><b>${n}</b></span></label>`).join("")}</div></div>
    <div class="field"><span class="lbl" id="${pref}-age-lbl">As-tu 18 ans ou plus ?</span>
      <div class="choix" role="radiogroup" aria-labelledby="${pref}-age-lbl">
        <label class="type"><input type="radio" name="${pref}-majeur" id="${pref}-majeur-oui" value="oui" ${v.majeur === true ? "checked" : ""}><span><b>Oui</b></span></label>
        <label class="type"><input type="radio" name="${pref}-majeur" id="${pref}-majeur-non" value="non" ${v.majeur === false ? "checked" : ""}><span><b>Non</b></span></label></div></div>
    <label class="checkrow" id="${pref}-accord-row" ${v.majeur === false ? "" : "hidden"}><input type="checkbox" id="${pref}-accord" ${v.accord_parental ? "checked" : ""}>
      <span>Un parent ou un tuteur est d'accord pour que j'utilise le Carnet d'étude.</span></label>`;
  function lireNiveau(pref) {
    const n = (document.querySelector(`input[name="${pref}-niveau"]:checked`) || {}).value;
    const a = (document.querySelector(`input[name="${pref}-majeur"]:checked`) || {}).value;
    const accord = !!($("#" + pref + "-accord") || {}).checked;
    if (!n) return { erreur: "Choisis ton niveau d'étude." };
    if (!a) return { erreur: "Indique si tu as 18 ans ou plus." };
    if (a === "non" && !accord) return { erreur: "Si tu as moins de 18 ans, il faut l'accord d'un parent ou d'un tuteur : coche la case." };
    return { niveau: n, majeur: a === "oui", accord_parental: a === "non" && accord };
  }
  function brancherNiveau(pref) {
    document.querySelectorAll(`input[name="${pref}-majeur"]`).forEach(r => r.addEventListener("change", () => { $("#" + pref + "-accord-row").hidden = r.value !== "non" || !r.checked; }));
  }
  function brancherVoir(racine = document) {
    racine.querySelectorAll("[data-voir]").forEach(b => b.onclick = () => {
      const i = $("#" + b.dataset.voir); const v = i.type === "password"; i.type = v ? "text" : "password";
      b.setAttribute("aria-pressed", String(v)); b.setAttribute("aria-label", v ? "Masquer le mot de passe" : "Afficher le mot de passe");
    });
  }
  const occupe = async (btn, texte, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = texte; try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; } };

  async function ecran(vue, opts = {}) {
    if (session && !["nouveau-mdp", "profil"].includes(vue)) return;
    $("#top").innerHTML = `<div class="brand">${ICONE}<span>Carnet d'étude</span></div>`;
    const app = $("#app");
    const titres = {
      connexion: ["Bienvenue", "Connecte-toi pour retrouver tes projets sur tous tes appareils. Pas besoin de compte Claude."],
      inscription: ["Créer ton compte", "Quelques informations, et c'est parti. Pas besoin de compte Claude."],
      code: ["Connexion par code", "On t'envoie un e-mail avec un code et un lien : pas besoin de mot de passe."],
      oubli: ["Mot de passe oublié", "On t'envoie un e-mail avec un code et un lien pour choisir un nouveau mot de passe."],
      "nouveau-mdp": ["Nouveau mot de passe", "Choisis ton nouveau mot de passe."],
      "verif-email": ["Active ton compte", ""],
      profil: ["Ton profil", "Encore une étape : dis-nous ton niveau pour que Claude s'adapte à toi."],
    };
    const [titre, sous] = titres[vue];
    const avecFournisseurs = vue === "connexion" || vue === "inscription";
    let haut = `<div class="hello"><h1>${titre}</h1>${sous ? `<p>${esc(sous)}</p>` : ""}</div><div class="form" id="login" data-vue="${vue}">`;
    if (avecFournisseurs) {
      haut += `<div class="tabs" role="tablist">
        <button type="button" role="tab" data-vue-aller="connexion" aria-selected="${vue === "connexion"}">Se connecter</button>
        <button type="button" role="tab" data-vue-aller="inscription" aria-selected="${vue === "inscription"}">Créer un compte</button></div>
        <div id="fournisseurs" class="fournisseurs"></div>`;
    }
    let corps = "";
    if (vue === "connexion") corps = `
      <form id="f-connexion" class="grille" novalidate>
        <div class="field"><label for="c-email">Adresse e-mail</label><input type="email" id="c-email" autocomplete="email" inputmode="email" required placeholder="prenom@exemple.com" value="${esc(opts.email || "")}"></div>
        ${champMdp("c-mdp", "Mot de passe", "current-password")}
        <button class="btn primary" type="submit" id="c-go">Se connecter</button>
      </form>
      <div class="liens"><button type="button" class="btn ghost" id="lien-oubli">Mot de passe oublié ?</button>
        <button type="button" class="btn ghost" id="lien-code">Me connecter avec un code reçu par e-mail</button></div>`;
    else if (vue === "inscription") corps = `
      <form id="f-inscription" class="grille" novalidate>
        <div class="field"><label for="i-prenom">Prénom</label><input type="text" id="i-prenom" autocomplete="given-name" maxlength="80" required></div>
        <div class="field"><label for="i-email">Adresse e-mail</label><input type="email" id="i-email" autocomplete="email" inputmode="email" required placeholder="prenom@exemple.com"></div>
        ${champMdp("i-mdp", "Mot de passe", "new-password")}
        <p class="hint" style="margin-top:-6px">Au moins 8 caractères, avec des lettres et des chiffres.</p>
        ${champMdp("i-mdp2", "Confirme le mot de passe", "new-password")}
        ${champNiveau("i")}
        <button class="btn primary" type="submit" id="i-go">Créer mon compte</button>
      </form>`;
    else if (vue === "verif-email") corps = `
      <p class="notice" id="login-info">Un e-mail d'activation a été envoyé à <b>${esc(opts.email)}</b>. Touche le lien qu'il contient, ou saisis le code ci-dessous. Regarde aussi dans les spams.</p>
      <form id="f-verif" class="grille" novalidate>
        <div class="field"><label for="v-code">Code reçu par e-mail</label><input type="text" id="v-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></div>
        <button class="btn primary" type="submit" id="v-go">Activer mon compte</button>
      </form>
      <div class="liens"><button type="button" class="btn ghost" id="v-renvoyer">Renvoyer l'e-mail</button><button type="button" class="btn ghost" data-vue-aller="connexion">Retour</button></div>`;
    else if (vue === "code" || vue === "oubli") {
      const p = vue === "code" ? "k" : "o";
      corps = `
      <form id="f-${p}-email" class="grille" novalidate ${opts.email ? "hidden" : ""}>
        <div class="field"><label for="${p}-email">Adresse e-mail</label><input type="email" id="${p}-email" autocomplete="email" inputmode="email" required placeholder="prenom@exemple.com"></div>
        <button class="btn primary" type="submit" id="${p}-send">${vue === "code" ? "Recevoir un code" : "Recevoir un e-mail de récupération"}</button>
      </form>
      <form id="f-${p}-code" class="grille" novalidate ${opts.email ? "" : "hidden"}>
        <p class="hint" id="${p}-sent">${opts.email ? `E-mail envoyé à ${esc(opts.email)}. Touche le lien, ou saisis le code (regarde aussi dans les spams).` : ""}</p>
        <div class="field"><label for="${p}-code">Code reçu par e-mail</label><input type="text" id="${p}-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></div>
        <button class="btn primary" type="submit" id="${p}-go">Valider le code</button>
      </form>
      <div class="liens"><button type="button" class="btn ghost" data-vue-aller="connexion">Retour</button></div>`;
    } else if (vue === "nouveau-mdp") corps = `
      <form id="f-nouveau" class="grille" novalidate>
        ${champMdp("n-mdp", "Nouveau mot de passe", "new-password")}
        <p class="hint" style="margin-top:-6px">Au moins 8 caractères, avec des lettres et des chiffres.</p>
        ${champMdp("n-mdp2", "Confirme le mot de passe", "new-password")}
        <button class="btn primary" type="submit" id="n-go">Enregistrer le mot de passe</button>
      </form>`;
    else if (vue === "profil") {
      const m = (session && session.user.user_metadata) || {};
      corps = `
      <form id="f-profil" class="grille" novalidate>
        <div class="field"><label for="p-prenom">Prénom</label><input type="text" id="p-prenom" autocomplete="given-name" maxlength="80" value="${esc(m.prenom || m.given_name || String(m.full_name || m.name || "").split(" ")[0] || "")}"></div>
        ${champNiveau("p", m)}
        <button class="btn primary" type="submit" id="p-go">Continuer</button>
      </form>
      <div class="liens"><button type="button" class="btn ghost" id="p-sortir">Me déconnecter</button></div>`;
    }
    const msg = vue === "connexion" ? messageRetour() : (opts.message || "");
    app.innerHTML = haut + corps + `<p class="err" id="login-err" role="alert" ${msg ? "" : "hidden"}>${esc(msg)}</p></div>
      <p class="hint pied"><a href="confidentialite.html">Confidentialité et suppression des données</a></p>`;
    const err = m => { const e = $("#login-err"); e.textContent = m; e.hidden = !m; if (m) e.scrollIntoView({ block: "nearest" }); };
    brancherVoir(app);
    app.querySelectorAll("[data-vue-aller]").forEach(b => b.onclick = () => ecran(b.dataset.vueAller));

    if (avecFournisseurs) {
      const actifs = await fournisseurs;
      const zone = $("#fournisseurs"); if (!zone) return;
      zone.innerHTML = Object.entries(FOURNISSEURS).filter(([k]) => actifs[k]).map(([k, n]) =>
        `<button class="btn fournisseur" type="button" id="login-${k}" data-fournisseur="${k}">Continuer avec ${n}</button>`).join("") +
        (Object.keys(FOURNISSEURS).some(k => actifs[k]) ? `<p class="hint ou">ou avec ton adresse e-mail</p>` : "");
      zone.querySelectorAll("[data-fournisseur]").forEach(b => b.onclick = async () => {
        err("");
        const { error } = await sb.auth.signInWithOAuth({ provider: b.dataset.fournisseur, options: { redirectTo: adresseApp } });
        if (error) err(`La connexion avec ${FOURNISSEURS[b.dataset.fournisseur]} n'a pas marché. Réessaie, ou utilise ton adresse e-mail.`);
      });
    }

    if (vue === "connexion") {
      $("#lien-oubli").onclick = () => ecran("oubli");
      $("#lien-code").onclick = () => ecran("code");
      $("#f-connexion").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#c-go"), "Connexion…", async () => {
        const email = $("#c-email").value.trim().toLowerCase(); const password = $("#c-mdp").value;
        if (!emailOk(email)) return err("Écris une adresse e-mail valide.");
        if (!password) return err("Écris ton mot de passe.");
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) err(traduire(error));
      }); };
    }
    if (vue === "inscription") {
      brancherNiveau("i");
      $("#f-inscription").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#i-go"), "Création…", async () => {
        const prenom = $("#i-prenom").value.trim(); const email = $("#i-email").value.trim().toLowerCase();
        const p1 = $("#i-mdp").value, p2 = $("#i-mdp2").value;
        if (!prenom) return err("Écris ton prénom.");
        if (!emailOk(email)) return err("Écris une adresse e-mail valide.");
        if (!mdpOk(p1)) return err("Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres.");
        if (p1 !== p2) return err("Les deux mots de passe ne sont pas identiques.");
        const n = lireNiveau("i"); if (n.erreur) return err(n.erreur);
        const { data, error } = await sb.auth.signUp({ email, password: p1, options: { emailRedirectTo: adresseApp, data: { prenom, ...n } } });
        if (error) return err(traduire(error));
        if (data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length)
          return err("Un compte existe déjà avec cette adresse. Connecte-toi, ou utilise « Mot de passe oublié ».");
        if (!data.session) ecran("verif-email", { email });
      }); };
    }
    if (vue === "verif-email") {
      $("#f-verif").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#v-go"), "Vérification…", async () => {
        const token = $("#v-code").value.replace(/\s/g, "");
        if (!/^\d{6,10}$/.test(token)) return err("Le code contient des chiffres uniquement (6 en général).");
        const { error } = await sb.auth.verifyOtp({ email: opts.email, token, type: "email" });
        if (error) err(traduire(error, "code"));
      }); };
      $("#v-renvoyer").onclick = ev => occupe(ev.currentTarget, "Envoi…", async () => {
        const { error } = await sb.auth.resend({ type: "signup", email: opts.email, options: { emailRedirectTo: adresseApp } });
        err(error ? traduire(error) : ""); if (!error) $("#login-info").innerHTML = `Nouvel e-mail envoyé à <b>${esc(opts.email)}</b>. Regarde aussi dans les spams.`;
      });
    }
    if (vue === "code" || vue === "oubli") {
      const p = vue === "code" ? "k" : "o";
      $(`#f-${p}-email`).onsubmit = ev => { ev.preventDefault(); err(""); occupe($(`#${p}-send`), "Envoi…", async () => {
        const email = $(`#${p}-email`).value.trim().toLowerCase();
        if (!emailOk(email)) return err("Écris une adresse e-mail valide.");
        const { error } = vue === "code"
          ? await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: adresseApp, shouldCreateUser: false } })
          : await sb.auth.resetPasswordForEmail(email, { redirectTo: adresseApp });
        if (error && !/signups not allowed|user not found/i.test(error.message || "")) return err(traduire(error));
        // Même réponse que le compte existe ou non : on ne dévoile pas qui est inscrit.
        $(`#f-${p}-email`).hidden = true; $(`#f-${p}-code`).hidden = false; $(`#f-${p}-code`).dataset.email = email;
        $(`#${p}-sent`).textContent = `Si un compte existe avec ${email}, un e-mail vient de partir. Touche le lien, ou saisis le code (regarde aussi dans les spams).`;
      }); };
      if (opts.email) $(`#f-${p}-code`).dataset.email = opts.email;
      $(`#f-${p}-code`).onsubmit = ev => { ev.preventDefault(); err(""); occupe($(`#${p}-go`), "Vérification…", async () => {
        const token = $(`#${p}-code`).value.replace(/\s/g, "");
        if (!/^\d{6,10}$/.test(token)) return err("Le code contient des chiffres uniquement (6 en général).");
        if (vue === "oubli") modeRecup = true;
        const { error } = await sb.auth.verifyOtp({ email: $(`#f-${p}-code`).dataset.email, token, type: vue === "code" ? "email" : "recovery" });
        if (error) { if (vue === "oubli") modeRecup = false; err(traduire(error, "code")); }
      }); };
    }
    if (vue === "nouveau-mdp") {
      $("#f-nouveau").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#n-go"), "Enregistrement…", async () => {
        const p1 = $("#n-mdp").value, p2 = $("#n-mdp2").value;
        if (!mdpOk(p1)) return err("Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres.");
        if (p1 !== p2) return err("Les deux mots de passe ne sont pas identiques.");
        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) return err(traduire(error));
        modeRecup = false;
        if (typeof window.toast === "function") setTimeout(() => window.toast("Mot de passe enregistré."), 300);
        await verifierProfil();
      }); };
    }
    if (vue === "profil") {
      brancherNiveau("p");
      $("#p-sortir").onclick = deconnexion;
      $("#f-profil").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#p-go"), "Enregistrement…", async () => {
        const n = lireNiveau("p"); if (n.erreur) return err(n.erreur);
        const p = { owner: session.user.id, prenom: $("#p-prenom").value.trim().slice(0, 80), ...n };
        const { error } = await sb.from("profils").upsert(p, { onConflict: "owner" });
        if (error) return err(traduire(error));
        profil = p; finir(session);
      }); };
    }
  }

  async function deconnexion() { await sb.auth.signOut().catch(() => {}); location.reload(); }

  /* ---------- Mon compte ---------- */
  function monCompte() {
    if (!session || !profil) return;
    let fond = $("#compte");
    if (fond) fond.remove();
    fond = document.createElement("div"); fond.id = "compte"; fond.className = "compte-fond";
    const fourn = (session.user.app_metadata && session.user.app_metadata.providers) || [];
    fond.innerHTML = `<div class="compte" role="dialog" aria-modal="true" aria-labelledby="compte-titre">
      <div class="row" style="justify-content:space-between"><h2 id="compte-titre">Mon compte</h2><button class="btn ghost" type="button" id="compte-fermer" aria-label="Fermer">✕</button></div>
      <p class="hint">${esc(session.user.email || "")}${fourn.filter(f => f !== "email").length ? ` · connecté aussi avec ${fourn.filter(f => f !== "email").map(f => FOURNISSEURS[f] || f).join(", ")}` : ""}</p>
      <form id="f-compte" class="grille" novalidate>
        <div class="field"><label for="m-prenom">Prénom</label><input type="text" id="m-prenom" maxlength="80" value="${esc(profil.prenom || "")}"></div>
        ${champNiveau("m", profil)}
        <button class="btn primary" type="submit" id="m-go">Enregistrer</button>
      </form>
      <details><summary>${fourn.includes("email") ? "Changer de mot de passe" : "Ajouter un mot de passe (pour te connecter aussi avec ton e-mail)"}</summary>
        <form id="f-compte-mdp" class="grille" novalidate>
          ${champMdp("m-mdp", "Nouveau mot de passe", "new-password")}
          ${champMdp("m-mdp2", "Confirme le mot de passe", "new-password")}
          <button class="btn" type="submit" id="m-mdp-go">Enregistrer le mot de passe</button>
        </form></details>
      <p class="err" id="compte-err" role="alert" hidden></p>
      <div class="row" style="justify-content:space-between"><button class="btn danger" type="button" id="m-sortir">Se déconnecter</button>
        <a class="hint" href="confidentialite.html">Confidentialité, supprimer mon compte</a></div>
    </div>`;
    document.body.appendChild(fond);
    const err = (m, ok) => { const e = $("#compte-err"); e.textContent = m; e.hidden = !m; e.style.color = ok ? "var(--ok)" : ""; };
    const fermer = () => fond.remove();
    brancherVoir(fond); brancherNiveau("m");
    $("#compte-fermer").onclick = fermer;
    fond.addEventListener("click", ev => { if (ev.target === fond) fermer(); });
    document.addEventListener("keydown", function esc_(ev) { if (ev.key === "Escape") { fermer(); document.removeEventListener("keydown", esc_); } });
    $("#m-sortir").onclick = ev => {
      const b = ev.currentTarget;
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmer ?"; setTimeout(() => { b.dataset.armed = "0"; b.textContent = "Se déconnecter"; }, 4000); return; }
      deconnexion();
    };
    $("#f-compte").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#m-go"), "Enregistrement…", async () => {
      const n = lireNiveau("m"); if (n.erreur) return err(n.erreur);
      const p = { prenom: $("#m-prenom").value.trim().slice(0, 80), ...n, updated_at: new Date().toISOString() };
      const { error } = await sb.from("profils").update(p).eq("owner", session.user.id);
      if (error) return err(traduire(error));
      profil = { ...profil, ...p }; err("Profil enregistré. Claude s'adapte dès ton prochain message.", true);
    }); };
    $("#f-compte-mdp").onsubmit = ev => { ev.preventDefault(); err(""); occupe($("#m-mdp-go"), "Enregistrement…", async () => {
      const p1 = $("#m-mdp").value, p2 = $("#m-mdp2").value;
      if (!mdpOk(p1)) return err("Mot de passe trop faible : au moins 8 caractères, avec des lettres et des chiffres.");
      if (p1 !== p2) return err("Les deux mots de passe ne sont pas identiques.");
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) return err(traduire(error));
      $("#m-mdp").value = $("#m-mdp2").value = ""; err("Mot de passe enregistré.", true);
    }); };
    setTimeout(() => $("#m-prenom").focus(), 50);
  }

  // Styles propres aux écrans de compte (le reste vient de l'app).
  const style = document.createElement("style");
  style.textContent = `
    #login .tabs { display: flex; gap: 6px; } #login .tabs button { flex: 1; }
    #login .grille, .compte .grille { display: grid; gap: 14px; }
    .fournisseurs { display: grid; gap: 10px; } .fournisseurs .ou { text-align: center; margin: 2px 0 0; }
    .liens { display: flex; flex-wrap: wrap; gap: 4px 10px; justify-content: center; }
    .liens .btn { font-weight: 600; color: var(--accent); }
    .mdp { display: flex; gap: 6px; } .mdp input { flex: 1; min-width: 0; } .mdp .voir { min-width: 44px; }
    .choix { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); }
    .grille > .hint { color: var(--muted); font-size: .85rem; margin: 0; }
    input[type=password] { font: inherit; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); }
    .compte-fond { position: fixed; inset: 0; background: rgba(10, 14, 30, .55); z-index: 60; display: flex; align-items: flex-start; justify-content: center; padding: 16px; overflow: auto; }
    .compte { background: var(--paper); color: var(--ink); border-radius: var(--radius); padding: 18px; width: 100%; max-width: 520px; display: grid; gap: 14px; margin-top: 4vh; }
    .compte details summary { cursor: pointer; font-weight: 700; padding: 6px 0; }
    .pied { text-align: center; margin: 18px 0 0; } .pied a, .compte a.hint { color: var(--muted); }`;
  document.head.appendChild(style);

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
  // Premier JSON valide trouvé dans un texte (tableau ou objet), même entouré de phrases ou dans un bloc ```json.
  function extraireJson(texte) {
    const t = String(texte || "").trim();
    try { return JSON.parse(t); } catch { /* on cherche plus loin */ }
    for (let i = 0; i < t.length; i++) {
      const c = t[i]; if (c !== "[" && c !== "{") continue;
      const fin = c === "[" ? "]" : "}";
      for (let j = t.lastIndexOf(fin); j > i; j = t.lastIndexOf(fin, j - 1)) {
        try { return JSON.parse(t.slice(i, j + 1)); } catch { /* fin plus courte */ }
      }
    }
    return undefined;
  }
  window.__extraireJson = extraireJson;   // pour les tests

  async function sample(input, opts = {}) {
    const corps = { tier: opts.modelTier === "complex" ? "complex" : "default", ...(opts.json ? { format: "plan" } : {}),
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
    if (erreur) throw { code: erreur.code, message: erreur.message + (erreur.detail ? ` (détail : ${erreur.detail})` : ""), serveur: true, text: erreur.code === "refused" ? undefined : (texte || undefined) };
    if (!fin) throw { code: "reseau", message: MSG.reseau, serveur: true, text: texte || undefined };
    dernierQuota = fin.quota || dernierQuota;
    if (dernierQuota && dernierQuota.limite && dernierQuota.utilise / dernierQuota.limite >= 0.8 && typeof window.toast === "function" && !sample._prevenu) {
      sample._prevenu = true;
      const reste = Math.max(0, Math.round(100 - 100 * dernierQuota.utilise / dernierQuota.limite));
      setTimeout(() => window.toast(`Il te reste environ ${reste} % de ton quota IA de la semaine.`, 6000), 800);
    }
    return { text: fin.text, truncated: !!fin.tronque, modelTierApplied: corps.tier };
  }
  // Plan : la fonction serveur impose le format { etapes: [{ titre, detail }] } (sorties structurées).
  // Lecture tolérante quand même : tableau seul, objet, bloc ```json, texte autour.
  sample.json = async (input, opts = {}) => {
    const r = await sample(input, { ...opts, json: true });
    const v = extraireJson(r.text);
    if (v === undefined) throw { code: "invalid_json" };
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") { const t = Array.isArray(v.etapes) ? v.etapes : Object.values(v).find(Array.isArray); if (t) return t; }
    throw { code: "invalid_json" };
  };
  sample.limits = async () => ({ maxPromptBytes: 300000, images: { maxCount: 5, maxInputBytes: 3500000, mediaTypes: ["image/jpeg", "image/png"] } });

  /* ---------- Exposition ---------- */
  const user = { id: async () => session.user.id, email: async () => session.user.email };
  const caps = { db, sample, assets, user };
  window.claude = { use: async n => { await pret; return caps[n] ?? null; } };
  window.carnetWeb = { deconnexion, compte: monCompte, niveau: () => profil && profil.niveau, quota: () => dernierQuota, email: () => session && session.user.email };
})();

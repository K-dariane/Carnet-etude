// Faux client Supabase (navigateur) pour les tests de bout en bout de l'app web.
// Imite le sous-ensemble de supabase-js v2 utilisé par app/backend.js : connexion, tables (avec la règle
// d'accès « owner = utilisateur connecté » et les cascades du schéma), stockage.
// État visible par les tests : window.__fake (lignes, fichiers, e-mails envoyés). Conservé dans localStorage
// pour survivre aux rechargements de page.
(() => {
  const CLE = "__fake_supabase";
  const charger = () => { try { return JSON.parse(localStorage.getItem(CLE)); } catch { return null; } };
  const st = charger() || { session: null, tables: { projets: [], supports: [], fils: [], profils: [] }, fichiers: {}, emails: [], oauth: [], echecs: {}, comptes: [] };
  const sauver = () => localStorage.setItem(CLE, JSON.stringify(st));
  window.__fake = st; window.__fakeSave = sauver;
  const ecouteurs = new Set();
  const emettre = (evt, s) => ecouteurs.forEach(f => f(evt, s));
  const uid = () => st.session && st.session.user.id;
  const maintenant = () => new Date().toISOString();
  const DEFAUTS = {
    profils: () => ({ prenom: "", accord_parental: false, created_at: maintenant(), updated_at: maintenant() }),
    projets: () => ({ type: "autre", matiere: "", objectif: "", echeance: null, parent_id: null, focus: null, nb_supports: 0, plan: [], evolutions: [], extra: {}, created_at: maintenant(), updated_at: maintenant() }),
    supports: () => ({ nom: "", texte: "", actif: true, url: null, asset_id: null, pages: null, tronque: null, herite: null, extra: {}, created_at: maintenant() }),
    fils: () => ({ id: "principal", turns: [], updated_at: maintenant() }),
  };
  const CLES = { projets: ["id"], supports: ["id"], fils: ["projet_id", "id"], profils: ["owner"] };
  const COLONNES = {
    profils: ["owner", "prenom", "niveau", "majeur", "accord_parental", "created_at", "updated_at"],
    projets: ["id", "owner", "titre", "type", "matiere", "objectif", "echeance", "parent_id", "focus", "nb_supports", "plan", "evolutions", "extra", "created_at", "updated_at"],
    supports: ["id", "owner", "projet_id", "nom", "kind", "texte", "actif", "url", "asset_id", "pages", "tronque", "herite", "extra", "created_at"],
    fils: ["owner", "projet_id", "id", "turns", "updated_at"],
  };
  const err = (message, code = "42501") => ({ data: null, error: { message, code } });
  const copie = o => JSON.parse(JSON.stringify(o));
  const verifier = (table, row) => {
    for (const k of Object.keys(row)) if (!COLONNES[table].includes(k)) return `column "${k}" of relation "${table}" does not exist`;
    if (row.owner !== uid()) return "new row violates row-level security policy";
    if (table === "profils") return !["primaire", "secondaire", "universitaire"].includes(row.niveau) || typeof row.majeur !== "boolean" || !(row.majeur || row.accord_parental) ? "violates check constraint" : null;
    if (table !== "projets" && !st.tables.projets.some(p => p.id === row.projet_id && p.owner === row.owner)) return "violates foreign key constraint";
    if (table === "projets" && !row.titre) return "violates check constraint";
    if (typeof row.echeance === "string" && row.echeance === "") return 'invalid input syntax for type date: ""';
    return null;
  };

  class Requete {
    constructor(table) { this.t = table; this.f = []; this.op = "select"; this.lim = null; this.retour = false; }
    select(cols) { if (this.op === "select") this.cols = cols; else this.retour = true; return this; }
    eq(k, v) { this.f.push([k, v]); return this; }
    limit(n) { this.lim = n; return this; }
    insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
    upsert(rows, o = {}) { this.op = "upsert"; this.rows = [].concat(rows); this.conflit = (o.onConflict || CLES[this.t].join(",")).split(","); return this; }
    update(v) { this.op = "update"; this.val = v; return this; }
    delete() { this.op = "delete"; return this; }
    maybeSingle() { this.unique = true; return this; }
    single() { this.unique = true; this.strict = true; return this; }
    then(ok, ko) { return Promise.resolve().then(() => this.executer()).then(ok, ko); }
    visibles() { return st.tables[this.t].filter(r => r.owner === uid() && this.f.every(([k, v]) => r[k] === v)); }
    executer() {
      if (st.echecs[this.t]) return err(st.echecs[this.t], "XX000");
      if (!uid()) return err("permission denied for table " + this.t);
      let res;
      if (this.op === "select") { res = copie(this.visibles()); if (this.lim != null) res = res.slice(0, this.lim); }
      else if (this.op === "insert" || this.op === "upsert") {
        res = [];
        for (const r0 of this.rows) {
          const exist = this.op === "upsert" ? st.tables[this.t].find(x => this.conflit.every(k => x[k] === r0[k])) : null;
          if (exist && exist.owner !== uid()) return err("new row violates row-level security policy");
          const row = exist ? { ...exist, ...copie(r0) } : { ...DEFAUTS[this.t](), owner: uid(), ...copie(r0) };
          const e = verifier(this.t, row); if (e) return err(e, "23000");
          if (exist) Object.assign(exist, row); else st.tables[this.t].push(row);
          res.push(copie(row));
        }
      } else if (this.op === "update") {
        res = [];
        for (const r of this.visibles()) {
          const row = { ...r, ...copie(this.val) }; const e = verifier(this.t, row); if (e) return err(e, "23000");
          Object.assign(r, row); res.push(copie(r));
        }
      } else if (this.op === "delete") {
        const del = this.visibles(); res = copie(del);
        st.tables[this.t] = st.tables[this.t].filter(r => !del.includes(r));
        if (this.t === "projets") {
          const ids = new Set(del.map(r => r.id));
          st.tables.supports = st.tables.supports.filter(r => !ids.has(r.projet_id));
          st.tables.fils = st.tables.fils.filter(r => !ids.has(r.projet_id));
          st.tables.projets.forEach(p => { if (ids.has(p.parent_id)) p.parent_id = null; });
        }
      }
      sauver();
      const data = this.op === "select" || this.retour ? res : null;
      if (this.unique) { if (this.strict && (!data || data.length !== 1)) return err("not single", "PGRST116"); return { data: data && data[0] || null, error: null }; }
      return { data, error: null };
    }
  }

  const stockage = bucket => ({
    async upload(path, blob, o = {}) {
      if (!uid() || !path.startsWith(uid() + "/")) return err("new row violates row-level security policy");
      if (st.fichiers[bucket + "/" + path] && !o.upsert) return err("The resource already exists", "409");
      st.fichiers[bucket + "/" + path] = { type: o.contentType || blob.type, taille: blob.size }; sauver();
      return { data: { path }, error: null };
    },
    async remove(paths) {
      for (const p of paths) if (p.startsWith(uid() + "/")) delete st.fichiers[bucket + "/" + p];
      sauver(); return { data: paths.map(p => ({ name: p })), error: null };
    },
    async createSignedUrls(paths, exp) {
      return { data: paths.map(p => ({ path: p, error: null, signedUrl: p.startsWith(uid() + "/") ? `https://fake.supabase.test/storage/v1/object/sign/${bucket}/${encodeURI(p)}?token=t${exp}` : null })), error: null };
    },
  });

  // Comptes : { id, email, password, confirme, metadata, providers }. Le code valable est toujours 123456.
  const idPour = email => email === "moi@test.cd" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : email.startsWith("b") ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    : "cccccccc-cccc-4ccc-8ccc-" + Array.from(email).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(12, "0").slice(0, 12);
  const compte = email => st.comptes.find(c => c.email === email);
  const ouvrir = (c, evt = "SIGNED_IN") => {
    st.session = { access_token: "jeton-" + c.email, user: { id: c.id, email: c.email, user_metadata: c.metadata || {}, app_metadata: { providers: c.providers || ["email"] } } };
    sauver(); emettre(evt, st.session); return { data: { session: st.session, user: st.session.user }, error: null };
  };
  const auth = {
    async getSession() { return { data: { session: st.session }, error: null }; },
    onAuthStateChange(cb) { ecouteurs.add(cb); setTimeout(() => cb("INITIAL_SESSION", st.session), 0); return { data: { subscription: { unsubscribe: () => ecouteurs.delete(cb) } } }; },
    async signUp({ email, password, options = {} }) {
      st.inscriptions = (st.inscriptions || []).concat([{ email, data: options.data, redirect: options.emailRedirectTo }]);
      if (password.length < 8) { sauver(); return { data: { user: null, session: null }, error: { message: "Password should be at least 8 characters.", code: "weak_password", status: 422 } }; }
      if (compte(email)) { sauver(); return { data: { user: { id: compte(email).id, identities: [] }, session: null }, error: null }; }
      st.comptes.push({ id: idPour(email), email, password, confirme: false, metadata: options.data || {} });
      st.emails.push({ email, type: "signup", redirect: options.emailRedirectTo }); sauver();
      return { data: { user: { id: idPour(email), identities: [{ provider: "email" }] }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const c = compte(email);
      if (!c || c.password !== password) return { data: { session: null }, error: { message: "Invalid login credentials", code: "invalid_credentials", status: 400 } };
      if (!c.confirme) return { data: { session: null }, error: { message: "Email not confirmed", code: "email_not_confirmed", status: 400 } };
      return ouvrir(c);
    },
    async signInWithOtp({ email, options }) {
      if (st.echecs.otp) return { data: null, error: { message: st.echecs.otp, status: 429 } };
      st.emails.push({ email, type: "magiclink", redirect: options && options.emailRedirectTo }); sauver(); return { data: {}, error: null };
    },
    async resetPasswordForEmail(email, o = {}) { st.emails.push({ email, type: "recovery", redirect: o.redirectTo }); sauver(); return { data: {}, error: null }; },
    async resend({ type, email }) { st.emails.push({ email, type: "renvoi-" + type }); sauver(); return { data: {}, error: null }; },
    async verifyOtp({ email, token, token_hash, type }) {
      st.verifications = (st.verifications || []).concat([{ token_hash, type }]);
      if (token_hash) {
        if (!/^hash-valide/.test(token_hash)) { sauver(); return { data: null, error: { message: "Email link is invalid or has expired", status: 403 } }; }
        email = "moi@test.cd"; token = "123456";
      }
      if (token !== "123456") { sauver(); return { data: null, error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 } }; }
      let c = compte(email);
      if (!c) { c = { id: idPour(email), email, password: null, confirme: true, metadata: {} }; st.comptes.push(c); }
      c.confirme = true;
      return ouvrir(c, type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN");
    },
    async updateUser({ password }) {
      if (!st.session) return { data: null, error: { message: "Auth session missing!", status: 401 } };
      if (password.length < 8) return { data: null, error: { message: "Password should be at least 8 characters.", code: "weak_password", status: 422 } };
      const c = compte(st.session.user.email); if (c) { c.password = password; c.providers = [...new Set([...(c.providers || ["email"]), "email"])]; }
      sauver(); emettre("USER_UPDATED", st.session); return { data: { user: st.session.user }, error: null };
    },
    async signInWithOAuth({ provider, options }) { st.oauth.push({ provider, redirectTo: options && options.redirectTo }); sauver(); return { data: {}, error: null }; },
    async signOut() { st.session = null; sauver(); emettre("SIGNED_OUT", null); return { error: null }; },
  };
  // Pour les tests : simule le retour d'une connexion Google (compte sans profil, prénom fourni par Google).
  window.__fakeOAuth = (email, nom) => {
    let c = compte(email); if (!c) { c = { id: idPour(email), email, password: null, confirme: true, metadata: { full_name: nom }, providers: ["google"] }; st.comptes.push(c); }
    st.session = { access_token: "jeton-" + email, user: { id: c.id, email, user_metadata: c.metadata, app_metadata: { providers: c.providers } } }; sauver();
  };

  window.supabase = { createClient: (url, key, o) => { st.client = { url, key, flowType: o && o.auth && o.auth.flowType }; return { auth, from: t => new Requete(t), storage: { from: stockage } }; } };
})();

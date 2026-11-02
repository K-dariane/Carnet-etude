// Faux client Supabase (navigateur) pour les tests de bout en bout de l'app web.
// Imite le sous-ensemble de supabase-js v2 utilisé par app/backend.js : connexion, tables (avec la règle
// d'accès « owner = utilisateur connecté » et les cascades du schéma), stockage.
// État visible par les tests : window.__fake (lignes, fichiers, e-mails envoyés). Conservé dans localStorage
// pour survivre aux rechargements de page.
(() => {
  const CLE = "__fake_supabase";
  const charger = () => { try { return JSON.parse(localStorage.getItem(CLE)); } catch { return null; } };
  const st = charger() || { session: null, tables: { projets: [], supports: [], fils: [] }, fichiers: {}, emails: [], oauth: [], echecs: {} };
  const sauver = () => localStorage.setItem(CLE, JSON.stringify(st));
  window.__fake = st; window.__fakeSave = sauver;
  const ecouteurs = new Set();
  const emettre = (evt, s) => ecouteurs.forEach(f => f(evt, s));
  const uid = () => st.session && st.session.user.id;
  const maintenant = () => new Date().toISOString();
  const DEFAUTS = {
    projets: () => ({ type: "autre", matiere: "", objectif: "", echeance: null, parent_id: null, focus: null, nb_supports: 0, plan: [], evolutions: [], extra: {}, created_at: maintenant(), updated_at: maintenant() }),
    supports: () => ({ nom: "", texte: "", actif: true, url: null, asset_id: null, pages: null, tronque: null, herite: null, extra: {}, created_at: maintenant() }),
    fils: () => ({ id: "principal", turns: [], updated_at: maintenant() }),
  };
  const CLES = { projets: ["id"], supports: ["id"], fils: ["projet_id", "id"] };
  const COLONNES = {
    projets: ["id", "owner", "titre", "type", "matiere", "objectif", "echeance", "parent_id", "focus", "nb_supports", "plan", "evolutions", "extra", "created_at", "updated_at"],
    supports: ["id", "owner", "projet_id", "nom", "kind", "texte", "actif", "url", "asset_id", "pages", "tronque", "herite", "extra", "created_at"],
    fils: ["owner", "projet_id", "id", "turns", "updated_at"],
  };
  const err = (message, code = "42501") => ({ data: null, error: { message, code } });
  const copie = o => JSON.parse(JSON.stringify(o));
  const verifier = (table, row) => {
    for (const k of Object.keys(row)) if (!COLONNES[table].includes(k)) return `column "${k}" of relation "${table}" does not exist`;
    if (row.owner !== uid()) return "new row violates row-level security policy";
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

  const auth = {
    async getSession() { return { data: { session: st.session }, error: null }; },
    onAuthStateChange(cb) { ecouteurs.add(cb); setTimeout(() => cb("INITIAL_SESSION", st.session), 0); return { data: { subscription: { unsubscribe: () => ecouteurs.delete(cb) } } }; },
    async signInWithOtp({ email, options }) {
      if (st.echecs.otp) return { data: null, error: { message: st.echecs.otp, status: 429 } };
      st.emails.push({ email, redirect: options && options.emailRedirectTo }); sauver(); return { data: {}, error: null };
    },
    async verifyOtp({ email, token, token_hash, type }) {
      st.verifications = (st.verifications || []).concat([{ token_hash, type }]);
      if (token_hash) { if (token_hash !== "hash-valide") { sauver(); return { data: null, error: { message: "Email link is invalid or has expired", status: 403 } }; } email = "moi@test.cd"; token = "123456"; }
      if (token !== "123456") return { data: null, error: { message: "Token has expired or is invalid", status: 403 } };
      st.session = { access_token: "jeton-" + email, user: { id: email.startsWith("b") ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email } };
      sauver(); emettre("SIGNED_IN", st.session); return { data: { session: st.session }, error: null };
    },
    async signInWithOAuth({ provider, options }) { st.oauth.push({ provider, redirectTo: options && options.redirectTo }); sauver(); return { data: {}, error: null }; },
    async signOut() { st.session = null; sauver(); emettre("SIGNED_OUT", null); return { error: null }; },
  };

  window.supabase = { createClient: (url, key, o) => { st.client = { url, key, flowType: o && o.auth && o.auth.flowType }; return { auth, from: t => new Requete(t), storage: { from: stockage } }; } };
})();

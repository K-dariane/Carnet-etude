// L'app servie à son adresse GitHub Pages (sous-dossier /Carnet-etude/) : fichiers relatifs, adresse de retour
// des liens de connexion, manifeste d'installation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url)); const web = join(here, "..");
const BASE = "https://k-dariane.github.io/Carnet-etude/";
let browser, pg; const demandes = [];
let reglages = { external: { email: true, google: true, facebook: false, apple: false } };

before(async () => {
  browser = await chromium.launch();
  const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await c.addInitScript({ path: join(here, "fake_supabase.js") });
  await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await c.route(/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/, r => { const m = r.request().url().match(/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/); r.fulfill({ path: join(web, "node_modules", m[1], m[2]) }); });
  await c.route(/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/, r => r.fulfill({ body: "", contentType: "text/javascript" }));
  await c.route(/\/auth\/v1\/settings$/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify(reglages) }));
  await c.route("https://k-dariane.github.io/**", r => {
    const p = new URL(r.request().url()).pathname; demandes.push(p);
    if (!p.startsWith("/Carnet-etude/")) return r.fulfill({ status: 404, body: "hors du site" });
    const f = p.slice("/Carnet-etude/".length) || "index.html";
    r.fulfill({ path: join(web, "app", f) });
  });
  pg = await c.newPage();
});
after(() => browser.close());

test("l'app s'ouvre à son adresse en ligne, tous les fichiers sont trouvés", async () => {
  await pg.goto(BASE); await pg.waitForSelector("#f-connexion");
  assert.ok(demandes.every(p => p.startsWith("/Carnet-etude/")), "aucun fichier demandé hors du sous-dossier : " + demandes.join(", "));
  for (const f of ["config.js", "backend.js"]) assert.ok(demandes.includes("/Carnet-etude/" + f), f + " chargé");
});

test("le lien de connexion ramène à l'adresse de l'app", async () => {
  await pg.click("#lien-code"); await pg.fill("#k-email", "moi@test.cd"); await pg.click("#k-send"); await pg.waitForSelector("#f-k-code:not([hidden])");
  assert.equal((await pg.evaluate(() => window.__fake.emails[0])).redirect, BASE);
  await pg.click("[data-vue-aller=connexion]"); await pg.click("#lien-oubli"); await pg.fill("#o-email", "moi@test.cd"); await pg.click("#o-send"); await pg.waitForSelector("#f-o-code:not([hidden])");
  assert.equal((await pg.evaluate(() => window.__fake.emails[1])).redirect, BASE);
  await pg.click("[data-vue-aller=connexion]"); await pg.waitForSelector("#login-google"); await pg.click("#login-google");
  await pg.waitForFunction(() => window.__fake.oauth.length === 1);
  assert.equal((await pg.evaluate(() => window.__fake.oauth[0])).redirectTo, BASE);
});

test("config publique : projet et clé publique, jamais de clé secrète", () => {
  const cfg = readFileSync(join(web, "app/config.js"), "utf8");
  assert.match(cfg, /https:\/\/xyrlifukufcntwinrtvz\.supabase\.co/); assert.match(cfg, /sb_publishable_/);
  for (const f of ["config.js", "backend.js", "index.html"]) {
    const t = readFileSync(join(web, "app", f), "utf8");
    assert.doesNotMatch(t, /sb_secret_|sk-ant-|service_role"?\s*:|eyJhbGciOi/, f + " ne contient aucune clé secrète");
  }
});

test("manifeste d'installation valide", () => {
  const m = JSON.parse(readFileSync(join(web, "app/manifest.webmanifest"), "utf8"));
  assert.equal(m.lang, "fr"); assert.equal(m.start_url, "./"); assert.equal(m.display, "standalone");
  assert.equal(m.icons[0].src, "icone.svg");
});

test("lien d'e-mail au format token_hash : l'app valide la connexion et nettoie l'adresse", async () => {
  await pg.evaluate(() => localStorage.clear());
  await pg.goto(BASE + "?token_hash=hash-valide&type=email");
  await pg.waitForSelector("#f-profil", { timeout: 10000 });
  assert.equal(pg.url(), BASE, "token_hash retiré de l'adresse");
  assert.deepEqual(await pg.evaluate(() => window.__fake.verifications), [{ token_hash: "hash-valide", type: "email" }]);
});

test("lien d'e-mail périmé ou déjà utilisé : message rassurant, on peut redemander un lien", async () => {
  await pg.evaluate(() => localStorage.clear());
  await pg.goto(BASE + "?token_hash=perime&type=email");
  await pg.waitForSelector("#f-connexion");
  assert.match(await pg.textContent("#login-err"), /n'est plus valable.*redemande un e-mail/);
  assert.equal(pg.url(), BASE);
  assert.equal(await pg.isVisible("#f-connexion"), true);
});

test("adresse partagée avec une erreur (#error=…) : même message, adresse nettoyée", async () => {
  await pg.evaluate(() => localStorage.clear());
  await pg.goto("about:blank");   // sinon un simple changement de « # » ne recharge pas la page
  await pg.goto(BASE + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  await pg.waitForSelector("#f-connexion");
  assert.match(await pg.textContent("#login-err"), /n'est plus valable/);
  assert.equal(pg.url(), BASE);
});

test("échec de la connexion Google : la vraie raison est affichée, pas « lien expiré »", async () => {
  await pg.goto("about:blank");
  await pg.goto(BASE + "#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%253A+4%252F0Ab");
  await pg.waitForSelector("#f-connexion");
  const t = await pg.textContent("#login-err");
  assert.match(t, /La connexion n'a pas abouti/); assert.match(t, /Unable to exchange external code: 4\/0Ab/, "message décodé (%3A, %2F)");
  assert.doesNotMatch(t, /expiré/);
  assert.equal(pg.url(), BASE);
  await pg.goto("about:blank");
  await pg.goto(BASE + "?error=access_denied&error_description=");
  await pg.waitForSelector("#f-connexion");
  assert.match(await pg.textContent("#login-err"), /Connexion annulée/);
  assert.equal(pg.url(), BASE);
});

test("lien « mot de passe oublié » (token_hash, type=recovery) : écran du nouveau mot de passe", async () => {
  await pg.evaluate(() => localStorage.clear());
  await pg.goto(BASE + "?token_hash=hash-valide-recup&type=recovery");
  await pg.waitForSelector("#f-nouveau", { timeout: 10000 });
  assert.equal(pg.url(), BASE);
  assert.deepEqual(await pg.evaluate(() => window.__fake.verifications.at(-1)), { token_hash: "hash-valide-recup", type: "recovery" });
});

test("Facebook : bouton affiché dès qu'il est activé dans Supabase ; jamais de bouton Apple", async () => {
  reglages = { external: { email: true, google: true, facebook: true, apple: true } };
  await pg.evaluate(() => localStorage.clear());
  await pg.goto("about:blank"); await pg.goto(BASE); await pg.waitForSelector("#login-facebook");
  assert.deepEqual(await pg.$$eval("[data-fournisseur]", b => b.map(x => x.textContent)), ["Continuer avec Google", "Continuer avec Facebook"], "Apple n'est pas proposé, même activé dans Supabase");
  await pg.click("#login-facebook"); await pg.waitForFunction(() => window.__fake.oauth.some(o => o.provider === "facebook"));
  assert.equal((await pg.evaluate(() => window.__fake.oauth.at(-1))).redirectTo, BASE);
  reglages = { external: { email: true, google: false, facebook: false, apple: false } };
  await pg.goto("about:blank"); await pg.goto(BASE); await pg.waitForSelector("#f-connexion"); await pg.waitForTimeout(300);
  assert.equal(await pg.locator("[data-fournisseur]").count(), 0, "aucun bouton si aucun fournisseur");
});

test("page de confidentialité : en ligne, liée depuis l'écran de connexion, avec la section suppression (Google, Facebook)", async () => {
  reglages = { external: { email: true, google: true } };
  await pg.evaluate(() => localStorage.clear());
  await pg.goto("about:blank"); await pg.goto(BASE); await pg.waitForSelector("#f-connexion");
  await Promise.all([pg.waitForURL(BASE + "confidentialite.html"), pg.click("a[href='confidentialite.html']")]);
  assert.match(await pg.textContent("h1"), /Politique de confidentialité/);
  assert.equal(await pg.locator("#suppression").count(), 1, "ancre #suppression pour Facebook");
  assert.match(await pg.textContent("body"), /Anthropic/);
  const html = readFileSync(join(web, "app/confidentialite.html"), "utf8");
  assert.doesNotMatch(html, /<script/i, "page statique, sans script");
});

test("table des profils absente dans Supabase : l'app démarre, « Mon compte » s'ouvre avec la déconnexion", async () => {
  await pg.goto("about:blank"); await pg.goto(BASE);
  await pg.evaluate(() => { localStorage.clear(); });
  await pg.goto("about:blank"); await pg.goto(BASE); await pg.waitForSelector("#f-connexion");
  await pg.evaluate(() => { window.__fakeOAuth("sans@test.cd", "Sans Profil"); window.__fake.echecs.profils = "Could not find the table 'public.profils' in the schema cache";
    window.__fake.tables.projets.push({ id: "psp", owner: window.__fake.session.user.id, titre: "Projet", type: "etude", matiere: "", objectif: "", echeance: null, parent_id: null, focus: null, nb_supports: 0, plan: [], evolutions: [], extra: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    window.__fakeSave(); });
  await pg.reload(); await pg.waitForSelector("[data-a=compte]");
  await pg.click("[data-a=compte]"); await pg.waitForSelector("#compte");
  assert.match(await pg.textContent("#compte"), /profil n'est pas disponible/);
  assert.equal(await pg.isVisible("#f-compte"), false);
  await pg.click("#m-sortir"); await Promise.all([pg.waitForEvent("load"), pg.click("#m-sortir")]);
  await pg.waitForSelector("#f-connexion");
});

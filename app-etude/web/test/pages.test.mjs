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

before(async () => {
  browser = await chromium.launch();
  const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await c.addInitScript({ path: join(here, "fake_supabase.js") });
  await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await c.route(/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/, r => { const m = r.request().url().match(/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/); r.fulfill({ path: join(web, "node_modules", m[1], m[2]) }); });
  await c.route(/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/, r => r.fulfill({ body: "", contentType: "text/javascript" }));
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
  await pg.goto(BASE); await pg.waitForSelector("#login");
  assert.ok(demandes.every(p => p.startsWith("/Carnet-etude/")), "aucun fichier demandé hors du sous-dossier : " + demandes.join(", "));
  for (const f of ["config.js", "backend.js"]) assert.ok(demandes.includes("/Carnet-etude/" + f), f + " chargé");
});

test("le lien de connexion ramène à l'adresse de l'app", async () => {
  await pg.fill("#login-email", "moi@test.cd"); await pg.click("#login-send"); await pg.waitForSelector("#login-code:not([hidden])");
  assert.equal((await pg.evaluate(() => window.__fake.emails[0])).redirect, BASE);
  await pg.click("#login-back"); await pg.click("#login-google");
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

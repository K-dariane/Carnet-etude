// Test de bout en bout de l'app web (Playwright + faux Supabase + fausse fonction « chat »).
// Vérifie la connexion, l'enregistrement dans les tables avec les champs attendus, les fichiers et l'IA.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preparer } from "../supabase/functions/_shared/chat.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const nm = join(web, "node_modules");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let browser, ctx, pg, erreurs = [], appels = [], refusees = [], reponseChat = null, demiCaracteres = 0;
let reglages = { external: { email: true, google: true, facebook: false, apple: false } };
const REPONSE = "### Intégration par parties\nD'après ton cours *cours*, \\[ \\int u v' = [uv] - \\int u' v \\]\n- Résultat : \\(x e^x - e^x + C\\)";
const ndjson = (texte, extra = {}) => texte.match(/[\s\S]{1,25}/g).map(d => JSON.stringify({ type: "texte", delta: d })).join("\n") + "\n" +
  JSON.stringify({ type: "fin", text: texte, tronque: false, modele: "claude-haiku-5-5", tokens: 1234, quota: { utilise: 1234, limite: 200000, reinitialisation: "2026-11-09T00:00:00+01:00" }, ...extra }) + "\n";

async function nouvellePage(context) {
  const p = await context.newPage();
  p.on("pageerror", e => erreurs.push("pageerror " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(m.text())) erreurs.push("console " + m.text()); });
  return p;
}
async function contexte() {
  const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await c.addInitScript({ path: join(here, "fake_supabase.js") });
  await c.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await c.route(/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/, r => {
    const m = r.request().url().match(/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    r.fulfill({ path: join(nm, m[1], m[2]) });
  });
  // Enregistrée après la règle générale : Playwright essaie les règles de la plus récente à la plus ancienne.
  await c.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/, r => r.fulfill({ body: "/* remplacé par le faux client */", contentType: "text/javascript" }));
  await c.route("http://carnet.test/**", r => {
    const f = new URL(r.request().url()).pathname.replace(/^\/$/, "/index.html");
    if (f === "/config.js") return r.fulfill({ contentType: "text/javascript", body: 'window.CARNET_CONFIG = { supabaseUrl: "https://fake.supabase.test", supabaseAnonKey: "cle-publique-test" };' });
    r.fulfill({ path: join(web, "app", f) });
  });
  await c.route("https://fake.supabase.test/auth/v1/settings", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(reglages) }));
  await c.route("https://fake.supabase.test/storage/**", r => r.fulfill({ body: PNG, contentType: "image/png" }));
  await c.route("https://fake.supabase.test/functions/v1/chat", async r => {
    const body = JSON.parse(r.request().postData()); const headers = r.request().headers();
    appels.push({ body, headers });
    // La fausse fonction applique la vraie vérification du serveur : l'app doit envoyer des demandes acceptées.
    const v = preparer(body);
    // Comme la vraie API : un demi-caractère (coupe au milieu de 𝑥, emoji…) rend la demande illisible.
    if (!("code" in v) && v.messages.some(m => typeof m.content === "string" ? !m.content.isWellFormed() : m.content.some(b => b.text && !b.text.isWellFormed()))) {
      demiCaracteres++;
      return r.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "erreur", code: "requete_invalide", message: "La demande envoyée n'est pas valide.", detail: "The request body is not valid JSON: unexpected end of hex escape" }) + "\n" });
    }
    if ("code" in v) { refusees.push({ body, v }); return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ erreur: { code: v.code, message: "La demande envoyée n'est pas valide. Recharge la page et réessaie.", raison: v.raison } }) }); }
    if (reponseChat) return reponseChat(r, body);
    // Avec les sorties structurées, Claude répond { "etapes": [...] } (format imposé par la fonction serveur).
    // Plan : Claude répond par une liste numérotée (ici avec introduction, gras et conclusion, comme en vrai).
    if (body.tache === "plan") return r.fulfill({ contentType: "application/x-ndjson", body: ndjson(/Un plan existe déjà/.test(body.prompt)
      ? "1. Exercices guidés — 10 calculs avec correction\n2. Sujet type — 1 h chrono"
      : "Voici ton plan :\n\n1. **Revoir les primitives** — Tableau des primitives usuelles\n2. Formule IPP — Choisir u et v'\n3. Exercices — 10 calculs\n\nBon courage !") });
    if (body.tache === "resume") return r.fulfill({ contentType: "application/x-ndjson", body: ndjson("- Notions vues : IPP\n- Difficulté : choix de u") });
    if (body.tache === "transcription") return r.fulfill({ contentType: "application/x-ndjson", body: ndjson("Théorème de Rolle : f(a) = f(b)") });
    r.fulfill({ contentType: "application/x-ndjson", body: ndjson(REPONSE) });
  });
  return c;
}
const fake = () => pg.evaluate(() => window.__fake);
const attendre = (fn, ms = 8000) => pg.waitForFunction(fn, null, { timeout: ms });

before(async () => { browser = await chromium.launch(); ctx = await contexte(); pg = await nouvellePage(ctx); });
after(async () => { await browser.close(); });

test("création de compte : formulaire vérifié, e-mail d'activation, code, profil enregistré", async () => {
  await pg.goto("http://carnet.test/");
  await pg.waitForSelector("#f-connexion");
  assert.match(await pg.textContent("#app"), /Connecte-toi pour retrouver tes projets/);
  await pg.waitForSelector("#login-google");
  assert.equal(await pg.locator("#login-facebook, #login-apple").count(), 0, "Facebook caché tant qu'il n'est pas activé ; pas d'Apple");
  assert.equal(await pg.isVisible("#login-err"), false);
  await pg.click("[data-vue-aller=inscription]"); await pg.waitForSelector("#f-inscription");
  const err = () => pg.textContent("#login-err");
  await pg.click("#i-go"); assert.equal(await err(), "Écris ton prénom.");
  await pg.fill("#i-prenom", "Moi"); await pg.fill("#i-email", "Moi@Test.cd"); await pg.fill("#i-mdp", "court1"); await pg.click("#i-go");
  assert.match(await err(), /au moins 8 caractères/);
  await pg.fill("#i-mdp", "motdepasse1"); await pg.fill("#i-mdp2", "autrechose1"); await pg.click("#i-go");
  assert.equal(await err(), "Les deux mots de passe ne sont pas identiques.");
  await pg.fill("#i-mdp2", "motdepasse1"); await pg.click("#i-go"); assert.equal(await err(), "Choisis ton niveau d'étude.");
  await pg.check("#i-niveau-secondaire"); await pg.click("#i-go"); assert.equal(await err(), "Indique si tu as 18 ans ou plus.");
  assert.equal(await pg.isVisible("#i-accord"), false);
  await pg.check("#i-majeur-non"); assert.equal(await pg.isVisible("#i-accord"), true);
  await pg.click("#i-go"); assert.match(await err(), /accord d'un parent/);
  await pg.check("#i-accord");
  await pg.click("[data-voir=i-mdp]"); assert.equal(await pg.getAttribute("#i-mdp", "type"), "text", "bouton 👁 : mot de passe affiché");
  await pg.click("#i-go");
  await pg.waitForSelector("#f-verif");
  assert.match(await pg.textContent("#login-info"), /moi@test\.cd/);
  let f = await fake();
  assert.deepEqual(f.inscriptions[0], { email: "moi@test.cd", redirect: "http://carnet.test/", data: { prenom: "Moi", niveau: "secondaire", majeur: false, accord_parental: true } });
  assert.equal(f.client.key, "cle-publique-test"); assert.equal(f.client.flowType, "implicit");
  await pg.click("#v-renvoyer"); await attendre(() => window.__fake.emails.some(e => e.type === "renvoi-signup"));
  await pg.fill("#v-code", "000000"); await pg.click("#v-go");
  await attendre(() => /Code incorrect ou expiré/.test(document.querySelector("#login-err").textContent));
  await pg.fill("#v-code", "123456"); await pg.click("#v-go");
  await pg.waitForSelector("#pform");
  assert.match(await pg.textContent("#app"), /Bienvenue dans ton carnet/);
  f = await fake();
  assert.deepEqual(f.tables.profils.map(({ owner, prenom, niveau, majeur, accord_parental }) => ({ owner, prenom, niveau, majeur, accord_parental })),
    [{ owner: A, prenom: "Moi", niveau: "secondaire", majeur: false, accord_parental: true }]);
});

test("compte déjà existant : message clair, pas de second compte", async () => {
  const c2 = await contexte(); const p2 = await nouvellePage(c2);
  await p2.goto("http://carnet.test/"); await p2.waitForSelector("#f-connexion");
  await p2.evaluate(d => { window.__fake.comptes = d; window.__fakeSave(); }, (await fake()).comptes);
  await p2.click("[data-vue-aller=inscription]"); await p2.waitForSelector("#f-inscription");
  await p2.fill("#i-prenom", "Moi"); await p2.fill("#i-email", "moi@test.cd"); await p2.fill("#i-mdp", "motdepasse2"); await p2.fill("#i-mdp2", "motdepasse2");
  await p2.check("#i-niveau-universitaire"); await p2.check("#i-majeur-oui"); await p2.click("#i-go");
  await p2.waitForFunction(() => /existe déjà/.test(document.querySelector("#login-err").textContent));
  assert.equal(await p2.evaluate(() => window.__fake.comptes.length), 1);
  await c2.close();
});

test("projet : enregistré dans la table projets avec les champs de la V1", async () => {
  await pg.fill("#f-titre", "Intégrales – Analyse 2"); await pg.check("#f-type-exercices"); await pg.fill("#f-matiere", "Mathématiques");
  await pg.fill("#f-objectif", "Maîtriser l'intégration par parties"); await pg.fill("#f-echeance", "2026-11-20");
  await pg.click("button[type=submit]");
  await pg.waitForSelector("#drop");
  const p = (await fake()).tables.projets[0];
  assert.equal(p.owner, A); assert.equal(p.titre, "Intégrales – Analyse 2"); assert.equal(p.type, "exercices");
  assert.equal(p.matiere, "Mathématiques"); assert.equal(p.echeance, "2026-11-20"); assert.equal(p.nb_supports, 0);
  assert.deepEqual(p.plan, []); assert.match(p.created_at, /^\d{4}-\d\d-\d\dT/); assert.deepEqual(p.extra, {});
});

test("supports : PDF texte extrait et fichier dans Storage, note, compteur à jour", async () => {
  await pg.setInputFiles("#supfile", join(here, "fixtures", "cours.pdf"));
  await attendre(() => document.querySelectorAll(".sup").length === 1, 15000);
  await pg.click('summary:has-text("Écrire une note")'); await pg.fill("#note-txt", "Le prof insiste sur LIATE."); await pg.click("[data-a=add-note]");
  await attendre(() => document.querySelectorAll(".sup").length === 2);
  await attendre(() => window.__fake.tables.projets[0].nb_supports === 2);
  const f = await fake();
  const pdf = f.tables.supports.find(s => s.kind === "pdf");
  assert.match(pdf.texte, /Integration par parties/);
  assert.match(pdf.asset_id, new RegExp(`^${A}/f/[a-z0-9]{10}\\.pdf$`));
  assert.equal(pdf.url, "storage:supports/" + pdf.asset_id, "la base garde la référence, pas le lien temporaire");
  assert.equal(f.fichiers["supports/" + pdf.asset_id].type, "application/pdf");
  assert.equal(f.tables.supports.find(s => s.kind === "note").texte, "Le prof insiste sur LIATE.");
  assert.match(await pg.getAttribute(".sup a[href*='fake.supabase.test/storage']", "href"), /object\/sign\/supports\//, "lien « Ouvrir l'original » temporaire");
});

test("plan : Claude analyse les supports et l'objectif, liste numérotée lue, plan affiché en direct", async () => {
  await pg.click("[data-tab=plan]");
  assert.equal(await pg.textContent("#genplan"), "Créer le plan avec le tuteur");
  await pg.click("#genplan"); await pg.waitForSelector(".step");
  const a = appels.at(-1);
  assert.equal(a.body.tache, "plan"); assert.equal(a.body.tier, "default"); assert.equal(typeof a.body.prompt, "string");
  assert.equal(a.body.format, undefined, "plus de format JSON imposé");
  assert.ok(a.body.prompt.includes("Niveau de l'élève : secondaire."), "niveau aussi pour le plan");
  assert.ok(a.body.prompt.includes("Integration par parties") && a.body.prompt.includes("LIATE"), "supports analysés");
  assert.ok(a.body.prompt.includes("Maîtriser l'intégration par parties"), "objectif");
  assert.ok(a.body.prompt.includes("1. Titre court de l'étape — ce qu'il faut faire concrètement"));
  assert.equal(a.headers.authorization, "Bearer jeton-moi@test.cd"); assert.equal(a.headers.apikey, "cle-publique-test");
  assert.deepEqual(await pg.$$eval(".step .t b", b => b.map(x => x.textContent)), ["Revoir les primitives", "Formule IPP", "Exercices"]);
  assert.equal(await pg.textContent(".step .t small"), "Tableau des primitives usuelles");
  await pg.click(".step input[type=checkbox]");
  await attendre(() => window.__fake.tables.projets[0].plan.length === 3 && window.__fake.tables.projets[0].plan[0].fait === true);
  assert.deepEqual(Object.keys((await fake()).tables.projets[0].plan[0]).sort(), ["detail", "fait", "id", "titre"]);
});

test("plan adaptatif : les étapes faites sont gardées, Claude propose la suite", async () => {
  assert.equal(await pg.textContent("#genplan"), "Adapter le plan avec le tuteur");
  await pg.click("#genplan"); assert.equal(await pg.textContent("#genplan"), "Confirmer ?");
  await pg.click("#genplan");
  await attendre(() => window.__fake.tables.projets[0].plan.map(s => s.titre).join("|") === "Revoir les primitives|Exercices guidés|Sujet type");
  const a = appels.at(-1);
  assert.ok(a.body.prompt.includes("Un plan existe déjà") && a.body.prompt.includes("[fait] Revoir les primitives"));
  const plan = (await fake()).tables.projets[0].plan;
  assert.deepEqual(plan.map(s => s.fait), [true, false, false]);
  assert.equal(await pg.locator(".step").count(), 3);
});

test("plan avec un long cours de maths coupé au milieu d'un caractère spécial (𝑥) : le plan arrive quand même", async () => {
  await pg.click("[data-tab=supports]"); await pg.click('summary:has-text("Écrire une note")');
  // 80 001 caractères : la coupe à 40 000 du contexte du plan tombe au milieu d'un 𝑥 (deux morceaux).
  await pg.evaluate(() => { document.querySelector("#note-nom").value = "Cours long"; document.querySelector("#note-txt").value = "a" + "𝑥".repeat(40000); });
  await pg.click("[data-a=add-note]");
  await attendre(() => window.__fake.tables.supports.some(s => s.nom === "Cours long"));
  await pg.click("[data-tab=plan]"); await pg.click("#genplan"); await pg.click("#genplan");
  await attendre(() => /Plan adapté/.test(document.querySelector("#toast").textContent), 15000);
  assert.equal(demiCaracteres, 0, "aucune demande avec un demi-caractère n'atteint l'API");
  assert.ok(!appels.at(-1).body.prompt.isWellFormed(), "le cas est bien reproduit : l'app envoie un texte coupé…");
  // …et c'est la fonction serveur qui le nettoie (vérifié par la fausse fonction, qui applique preparer()).
  const id = (await fake()).tables.supports.find(s => s.nom === "Cours long").id;
  await pg.click("[data-tab=supports]");
  const btn = pg.locator(`[data-a=del-sup][data-id="${id}"]`); await btn.click(); await btn.click();
  await attendre(() => !window.__fake.tables.supports.some(s => s.nom === "Cours long"));
  await pg.click("[data-tab=plan]");
});

test("enregistrement : un demi-caractère est nettoyé avant d'aller dans la base", async () => {
  assert.equal(await pg.evaluate(() => window.__bienForme("Soit \ud835")), "Soit \ufffd");
  assert.equal(await pg.evaluate(() => window.__bienForme("𝑥 ∈ ℝ 😀")), "𝑥 ∈ ℝ 😀");
});

test("plan : réponse sans étape lisible ou erreur du serveur → message clair, ancien plan intact", async () => {
  reponseChat = (r, body) => body.tache === "plan" ? r.fulfill({ contentType: "application/x-ndjson", body: ndjson("Je ne peux pas faire de plan sans plus d'informations.") }) : null;
  await pg.click("#genplan"); await pg.click("#genplan");
  await attendre(() => /pas proposé d'étapes lisibles/.test(document.querySelector("#toast").textContent));
  assert.equal(await pg.locator(".step").count(), 3);
  reponseChat = (r, body) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ erreur: { code: "requete_invalide", message: "La demande envoyée n'est pas valide.", raison: "x" } }) });
  await pg.click("#genplan"); await pg.click("#genplan");
  await attendre(() => /n'est pas valide/.test(document.querySelector("#toast").textContent));
  assert.equal((await fake()).tables.projets[0].plan.length, 3);
  reponseChat = null;
});

test("plan : réponse de Claude lue quelle que soit sa forme", async () => {
  const P = '[{"titre":"Revoir","detail":"x"}]';
  const cas = { "JSON pur": P, "bloc json": "```json\n" + P + "\n```", "phrase avant": "Voici ton plan :\n" + P,
    "phrase après": P + "\n\nBon courage !", "avant et après": "Voici :\n" + P + "\nBonne révision", "objet etapes": '{"etapes":' + P + "}",
    "crochets dans le texte": "Plan [4 étapes] :\n" + P + " [fin]" };
  const r = await pg.evaluate(c => Object.fromEntries(Object.entries(c).map(([k, v]) => { const o = window.__extraireJson(v); return [k, Array.isArray(o) ? o : o && o.etapes]; })), cas);
  for (const [k, v] of Object.entries(r)) assert.deepEqual(v, [{ titre: "Revoir", detail: "x" }], k);
  assert.equal(await pg.evaluate(() => window.__extraireJson("pas de json ici")), undefined);
});

test("séance : réponse affichée, contexte avec les supports, conversation enregistrée", async () => {
  await pg.click("[data-tab=seance]");
  await pg.fill("#msg", "Explique-moi l’IPP avec x e^x"); await pg.click("#sendbtn");
  await attendre(() => document.querySelectorAll(".msg.assistant").length === 1 && !document.querySelector("[data-a=stop]"), 15000);
  await pg.waitForTimeout(1200);
  assert.ok(await pg.locator("mjx-container").count() >= 2, "formules affichées");
  const a = appels.at(-1);
  assert.equal(a.body.tache, "seance"); assert.equal(a.body.tier, "default");
  assert.equal(a.body.messages[0].role, "user");
  assert.ok(a.body.messages[0].content.includes("Integration par parties") && a.body.messages[0].content.includes("LIATE"));
  assert.equal(a.body.messages.at(-1).content, "Explique-moi l’IPP avec x e^x");
  assert.ok(a.body.messages[0].content.startsWith("Tu es le tuteur personnel d'un élève ou d'un étudiant, dans son « Carnet d'étude »."));
  assert.ok(a.body.messages[0].content.includes("Niveau de l'élève : secondaire. Langage clair et accessible"), "consigne de niveau envoyée à Claude");
  await attendre(() => (window.__fake.tables.fils[0] || {}).turns?.length === 2);
  const fil = (await fake()).tables.fils[0];
  assert.equal(fil.id, "principal"); assert.deepEqual(fil.turns.map(t => t.role), ["user", "assistant"]);
  assert.equal(fil.turns[1].content, REPONSE);
});

test("mode approfondi et photo jointe : Sonnet demandé, photo dans Storage, référence dans la conversation", async () => {
  await pg.check("#deep");
  await pg.setInputFiles("#chatimg", { name: "tableau.png", mimeType: "image/png", buffer: PNG });
  await pg.waitForSelector("#pendingimg img, .pending img, img[alt='Photo jointe']");
  await pg.fill("#msg", "Corrige ce que j'ai écrit"); await pg.click("#sendbtn");
  await attendre(() => document.querySelectorAll(".msg.assistant").length === 2 && !document.querySelector("[data-a=stop]"), 15000);
  const a = appels.at(-1);
  assert.equal(a.body.tier, "complex"); assert.equal(a.body.images.length, 1);
  assert.match(a.body.images[0].media_type, /^image\/(jpeg|png)$/); assert.ok(a.body.images[0].data.length > 10);
  await attendre(() => window.__fake.tables.fils[0].turns.length === 4);
  const t = (await fake()).tables.fils[0].turns[2];
  assert.equal(t.hadImg, true); assert.match(t.img, new RegExp(`^storage:supports/${A}/f/`));
  assert.match(await pg.getAttribute(".msg.user img.thumb", "src"), /fake\.supabase\.test\/storage\/v1\/object\/sign\//);
  await pg.uncheck("#deep");
});

test("quota atteint : message clair, rien d'ajouté à la conversation", async () => {
  reponseChat = (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ erreur: { code: "quota_atteint", message: "Tu as utilisé tout ton crédit d'étude d'aujourd'hui. Il se recharge cette nuit à minuit." } }) });
  await pg.fill("#msg", "Encore une question"); await pg.click("#sendbtn");
  await attendre(() => !document.querySelector("#toast").hidden && /crédit/.test(document.querySelector("#toast").textContent));
  assert.equal(await pg.textContent("#toast"), "Tu as utilisé tout ton crédit d'étude d'aujourd'hui. Il se recharge cette nuit à minuit.");
  assert.equal(await pg.locator(".msg.assistant").count(), 2);
  reponseChat = null;
});

test("refus de Claude : texte partiel jeté, message affiché", async () => {
  reponseChat = r => r.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "texte", delta: "Début" }) + "\n" + JSON.stringify({ type: "erreur", code: "refused", message: "Le tuteur n'a pas pu répondre à cette demande. Reformule-la." }) + "\n" });
  await pg.fill("#msg", "Question refusée"); await pg.click("#sendbtn");
  await attendre(() => /Reformule-la/.test(document.querySelector("#toast").textContent));
  await pg.waitForTimeout(300);
  assert.equal(await pg.locator(".msg.assistant").count(), 2, "pas de réponse partielle ajoutée");
  reponseChat = null;
});

test("sous-projet : supports copiés avec la référence du fichier, sans le posséder", async () => {
  await pg.click("[data-panel=sub]"); await pg.waitForSelector("#subform");
  await pg.check("#subtype-quiz"); await pg.fill("#sub-focus", "Intégration par parties"); await pg.click("#sub-go");
  await attendre(() => document.querySelector(".family") && /Sous-projet de/.test(document.querySelector(".family").textContent), 15000);
  const f = await fake();
  const enfant = f.tables.projets.find(p => p.parent_id); const parent = f.tables.projets.find(p => !p.parent_id);
  assert.equal(enfant.parent_id, parent.id); assert.equal(enfant.focus, "Intégration par parties"); assert.equal(enfant.type, "quiz");
  const copies = f.tables.supports.filter(s => s.projet_id === enfant.id);
  const pdf = copies.find(s => s.kind === "pdf");
  assert.equal(pdf.herite, true); assert.equal(pdf.asset_id, null);
  assert.match(pdf.url, new RegExp(`^storage:supports/${A}/f/[a-z0-9]{10}\\.pdf$`));
  assert.equal(pdf.url, f.tables.supports.find(s => s.projet_id === parent.id && s.kind === "pdf").url, "référence storage:, pas un lien temporaire");
  assert.ok(copies.some(s => s.nom === "Résumé de la séance du projet principal"));
  assert.equal(appels.at(-1).body.tache, "resume");
  assert.equal(enfant.nb_supports, copies.length);
});

test("rechargement : session gardée, projets et conversation retrouvés", async () => {
  await pg.reload(); await pg.waitForSelector(".card");
  assert.equal(await pg.locator("#login").count(), 0);
  assert.equal(await pg.locator(".subcards .card").count(), 1);
  await pg.click(".cards > .card"); await pg.waitForSelector(".msg.assistant", { timeout: 8000 });
  assert.equal(await pg.locator(".msg.assistant").count(), 2);
});

test("suppression d'un support : fichier supprimé du stockage", async () => {
  await pg.click("[data-tab=supports]"); await attendre(() => document.querySelectorAll(".sup").length >= 2);
  const avant = Object.keys((await fake()).fichiers).filter(k => k.endsWith(".pdf")).length;
  const btn = pg.locator(".sup", { hasText: "cours" }).first().locator("[data-a=del-sup]");
  await btn.click(); await btn.click();
  await attendre(() => !window.__fake.tables.supports.some(s => s.kind === "pdf" && s.asset_id));
  assert.equal(Object.keys((await fake()).fichiers).filter(k => k.endsWith(".pdf")).length, avant - 1);
  assert.ok((await fake()).tables.supports.some(s => s.kind === "pdf" && s.herite), "la copie du sous-projet reste");
});

test("autre testeur venu par Google : choisit son niveau à la première connexion, ne voit rien de A", async () => {
  const c2 = await contexte(); const p2 = await nouvellePage(c2);
  await p2.goto("http://carnet.test/"); await p2.waitForSelector("#login-google");
  await p2.click("#login-google");
  await p2.waitForFunction(() => window.__fake.oauth.length === 1);
  assert.deepEqual(await p2.evaluate(() => window.__fake.oauth[0]), { provider: "google", redirectTo: "http://carnet.test/" });
  // Le faux Supabase est propre à chaque navigateur : on y recopie les données de A pour vérifier le filtrage.
  const donnees = await fake();
  await p2.evaluate(d => { window.__fake.tables = d.tables; window.__fakeOAuth("b@test.cd", "Bob Martin"); window.__fakeSave(); }, donnees);
  await p2.reload(); await p2.waitForSelector("#f-profil");
  assert.equal(await p2.inputValue("#p-prenom"), "Bob", "prénom repris du compte Google");
  await p2.click("#p-go"); await p2.waitForFunction(() => /Choisis ton niveau/.test(document.querySelector("#login-err").textContent));
  await p2.check("#p-niveau-universitaire"); await p2.check("#p-majeur-oui"); await p2.click("#p-go");
  await p2.waitForSelector("#pform");
  assert.match(await p2.textContent("#app"), /Bienvenue/, "B arrive sur un carnet vide");
  assert.equal(await p2.evaluate(() => window.__fake.tables.profils.find(p => p.owner.startsWith("bbbb")).niveau), "universitaire");
  await c2.close();
});

test("Mon compte : niveau modifié (et pris en compte par Claude), puis déconnexion en deux clics", async () => {
  await pg.click("[data-a=home]").catch(() => {}); await pg.waitForSelector("[data-a=compte]");
  await pg.click("[data-a=compte]"); await pg.waitForSelector("#compte");
  assert.equal(await pg.inputValue("#m-prenom"), "Moi");
  assert.equal(await pg.isChecked("#m-niveau-secondaire"), true);
  await attendre(() => /il te reste environ 75 %/.test(document.querySelector("#compte-credit").textContent));
  await pg.check("#m-niveau-universitaire"); await pg.check("#m-majeur-oui"); await pg.click("#m-go");
  await attendre(() => /Profil enregistré/.test(document.querySelector("#compte-err").textContent));
  assert.equal((await fake()).tables.profils[0].niveau, "universitaire");
  assert.equal(await pg.isVisible("#m-mdp"), false, "section mot de passe repliée par défaut");
  await pg.click("#compte summary"); await pg.fill("#m-mdp", "nouveaumdp2"); await pg.fill("#m-mdp2", "nouveaumdp2"); await pg.click("#m-mdp-go");
  await attendre(() => /Mot de passe enregistré/.test(document.querySelector("#compte-err").textContent));
  await pg.click("#compte-fermer"); assert.equal(await pg.locator("#compte").count(), 0);
  await pg.click(".cards > .card"); await pg.waitForSelector("#msg");
  await pg.fill("#msg", "Et maintenant ?"); await pg.click("#sendbtn");
  await attendre(() => !document.querySelector("[data-a=stop]") && document.querySelectorAll(".msg.assistant").length >= 3, 15000);
  assert.ok(appels.at(-1).body.messages[0].content.includes("Niveau de l'étudiant : universitaire."));
  await pg.click("[data-a=home]"); await pg.click("[data-a=compte]"); await pg.waitForSelector("#m-sortir");
  await pg.click("#m-sortir"); assert.equal(await pg.textContent("#m-sortir"), "Confirmer ?");
  await Promise.all([pg.waitForEvent("load"), pg.click("#m-sortir")]);
  await pg.waitForSelector("#f-connexion");
});

test("connexion par mot de passe : mauvais mot de passe refusé, bon accepté", async () => {
  await pg.fill("#c-email", "moi@test.cd"); await pg.fill("#c-mdp", "faux12345"); await pg.click("#c-go");
  await attendre(() => /incorrect/.test(document.querySelector("#login-err").textContent));
  assert.equal(await pg.textContent("#login-err"), "Adresse e-mail ou mot de passe incorrect.");
  await pg.fill("#c-mdp", "nouveaumdp2"); await pg.click("#c-go");
  await pg.waitForSelector(".card");
  await pg.click("[data-a=compte]"); await pg.click("#m-sortir"); await Promise.all([pg.waitForEvent("load"), pg.click("#m-sortir")]);
  await pg.waitForSelector("#f-connexion");
});

test("mot de passe oublié : e-mail, code, nouveau mot de passe, reconnexion", async () => {
  await pg.click("#lien-oubli"); await pg.waitForSelector("#f-o-email");
  await pg.fill("#o-email", "moi@test.cd"); await pg.click("#o-send"); await pg.waitForSelector("#f-o-code:not([hidden])");
  assert.match(await pg.textContent("#o-sent"), /Si un compte existe avec moi@test\.cd/);
  assert.deepEqual((await fake()).emails.at(-1), { email: "moi@test.cd", type: "recovery", redirect: "http://carnet.test/" });
  await pg.fill("#o-code", "123456"); await pg.click("#o-go");
  await pg.waitForSelector("#f-nouveau");
  await pg.fill("#n-mdp", "recupere123"); await pg.fill("#n-mdp2", "recupere12"); await pg.click("#n-go");
  assert.equal(await pg.textContent("#login-err"), "Les deux mots de passe ne sont pas identiques.");
  await pg.fill("#n-mdp2", "recupere123"); await pg.click("#n-go");
  await pg.waitForSelector(".card");
  assert.equal((await fake()).comptes.find(c => c.email === "moi@test.cd").password, "recupere123");
});

test("connexion par code (sans mot de passe) : toujours possible en secours", async () => {
  await pg.click("[data-a=compte]"); await pg.click("#m-sortir"); await Promise.all([pg.waitForEvent("load"), pg.click("#m-sortir")]);
  await pg.waitForSelector("#lien-code"); await pg.click("#lien-code");
  await pg.fill("#k-email", "moi@test.cd"); await pg.click("#k-send"); await pg.waitForSelector("#f-k-code:not([hidden])");
  assert.equal((await fake()).emails.at(-1).type, "magiclink");
  await pg.fill("#k-code", "123456"); await pg.click("#k-go");
  await pg.waitForSelector(".card");
});

test("le mot « Claude » n'apparaît nulle part à l'écran : on parle du tuteur", async () => {
  await pg.goto("http://carnet.test/"); await pg.waitForSelector(".card, #f-connexion");
  const textes = [];
  const relever = async () => textes.push(await pg.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[placeholder],[aria-label],[title]")].map(e => [e.placeholder, e.getAttribute("aria-label"), e.title].join(" ")).join(" ")));
  await relever();
  if (await pg.locator(".cards > .card").count()) {
    await pg.click(".cards > .card"); await pg.waitForSelector("#msg"); await relever();
    for (const t of ["plan", "supports"]) { await pg.click(`[data-tab=${t}]`); await pg.waitForTimeout(200); await relever(); }
    await pg.click("[data-a=home]"); await pg.click("[data-a=compte]"); await pg.waitForSelector("#compte"); await relever(); await pg.click("#compte-fermer");
  }
  assert.doesNotMatch(textes.join(" "), /Claude/);
});

test("base injoignable : message clair, pas de mode local", async () => {
  await pg.evaluate(() => { window.__fake.session = { access_token: "x", user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "moi@test.cd" } }; window.__fake.echecs.projets = "connexion perdue"; window.__fakeSave(); });
  await pg.reload();
  await attendre(() => /Carnet indisponible/.test(document.querySelector("#app").textContent));
  assert.match(await pg.textContent("#app"), /Impossible de joindre le serveur du carnet/);
  assert.equal(await pg.locator("#localbanner").count(), 0);
});

test("aucune erreur JavaScript pendant tout le parcours", () => {
  assert.deepEqual(erreurs, []);
  assert.deepEqual(refusees, [], "aucune demande de l'app refusée par la vérification du serveur");
});

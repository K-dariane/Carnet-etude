// Tests du téléversement des fichiers de l'artifact vers Supabase Storage (faux serveur local).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { televerser, URL_PROJET } from "../import/televerser.mjs";

const dossier = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fichiers");
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let server, url, recues = [], reponse = 200;
before(async () => {
  server = createServer((req, res) => {
    const morceaux = []; req.on("data", c => morceaux.push(c));
    req.on("end", () => { recues.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(morceaux) }); res.writeHead(reponse); res.end("{}"); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("adresse du projet par défaut", () => assert.equal(URL_PROJET, "https://xyrlifukufcntwinrtvz.supabase.co"));

test("envoie chaque fichier dans <uid>/import/, avec le bon type et en remplacement", async () => {
  recues = []; reponse = 200;
  const r = await televerser({ url, cle: "cle-service", owner: OWNER, dossier, log: () => {} });
  assert.equal(r.ok.length, 2); assert.equal(r.echecs.length, 0);
  const jpg = recues.find(x => x.url.endsWith(".jpg"));
  assert.equal(jpg.method, "POST");
  assert.equal(jpg.url, `/storage/v1/object/supports/${OWNER}/import/d65927aa4753977e63d6b78677d0a79c.jpg`);
  assert.equal(jpg.headers.authorization, "Bearer cle-service"); assert.equal(jpg.headers.apikey, "cle-service");
  assert.equal(jpg.headers["content-type"], "image/jpeg"); assert.equal(jpg.headers["x-upsert"], "true");
  assert.deepEqual(jpg.body, readFileSync(join(dossier, "d65927aa4753977e63d6b78677d0a79c.jpg")));
  assert.equal(recues.find(x => x.url.endsWith(".pdf")).headers["content-type"], "application/pdf");
  assert.ok(!recues.some(x => x.url.includes("LISEZMOI")), "les autres fichiers sont ignorés");
});

test("erreurs : message clair pour chaque cas", async () => {
  for (const [code, re] of [[403, /clé refusée/], [404, /bucket « supports » introuvable/], [413, /trop gros/]]) {
    reponse = code;
    const r = await televerser({ url, cle: "x", owner: OWNER, dossier, log: () => {} });
    assert.equal(r.ok.length, 0); assert.match(r.echecs[0].raison, re);
  }
  const r = await televerser({ url: "http://127.0.0.1:1", cle: "x", owner: OWNER, dossier, log: () => {} });
  assert.match(r.echecs[0].raison, /réseau/);
  await assert.rejects(televerser({ url, owner: OWNER, dossier }), /SUPABASE_SERVICE_ROLE_KEY/);
  await assert.rejects(televerser({ url, cle: "x", owner: "moi@mail.com", dossier }), /uuid/);
});

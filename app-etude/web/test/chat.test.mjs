// Tests de la fonction serveur « chat » avec le vrai SDK Anthropic et une fausse API Claude locale :
// aucun appel réel, aucun coût. Lancer : npm test (depuis app-etude/web).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { handle, MODELES, LIMITES } from "../supabase/functions/_shared/chat.ts";

/* ---------- Fausse API Claude ---------- */
let server, base, requetes = [], connexionsFermees = 0;
const sse = (res, events, { delai = 0, coupure } = {}) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const suivant = () => {
    if (res.destroyed) return;
    if (i === coupure) return;                          // l'API « reste ouverte » (pour tester l'arrêt)
    if (i >= events.length) return res.end();
    const e = events[i++]; res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    setTimeout(suivant, delai);
  };
  suivant();
};
const evenements = (morceaux, { stop = "end_turn", usage = { input_tokens: 1200, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 }, sortie = 50, model = "claude-haiku-5-5" } = {}) => [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  ...morceaux.map(t => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } })),
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { ...usage, output_tokens: sortie } },
  { type: "message_stop" },
];

before(async () => {
  server = createServer((req, res) => {
    let raw = ""; req.on("data", c => raw += c);
    req.on("end", () => {
      const body = JSON.parse(raw); requetes.push({ headers: req.headers, body });
      res.on("close", () => { if (!res.writableEnded) connexionsFermees++; });
      const last = body.messages.at(-1); const txt = typeof last.content === "string" ? last.content : last.content.at(-1).text;
      if (txt.includes("#429")) { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "x" } })); }
      if (txt.includes("#529")) { res.writeHead(529, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } })); }
      if (txt.includes("#format400") && body.output_config && body.output_config.format) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "output_config.format: schema not supported" } })); }
      if (txt.includes("#400")) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages: bad thing" } })); }
      if (txt.includes("#refus")) return sse(res, evenements([], { stop: "refusal", sortie: 0 }));
      if (txt.includes("#vide")) return sse(res, evenements([], { sortie: 3 }));
      if (txt.includes("#coupe")) return sse(res, evenements(["Début de la réponse"], { stop: "max_tokens", sortie: 16000 }));
      if (txt.includes("#lent")) return sse(res, evenements(["a", "b", "c", "d", "e", "f"]), { delai: 120 });
      if (txt.includes("#pendu")) return sse(res, evenements(["premier morceau"]), { delai: 20, coupure: 7 });
      sse(res, evenements(["### Intégration ", "par parties\n", "\\( u v' \\)"], { model: body.model }), { delai: 5 });
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/* ---------- Dépendances simulées ---------- */
let appels, quotaUtilise, quotaLimite;
beforeEach(() => { requetes = []; appels = []; quotaUtilise = 1000; quotaLimite = 500000; connexionsFermees = 0; });
const deps = (o = {}) => ({
  anthropic: new Anthropic({ apiKey: "cle-de-test", baseURL: base, maxRetries: 0 }),
  sdk: Anthropic,
  userFromToken: async t => (t === "jeton-valide" ? { id: "u-1" } : null),
  quota: async () => ({ utilise: quotaUtilise, limite: quotaLimite, reinitialisation: "2026-11-09T00:00:00+01:00" }),
  enregistrer: async a => { appels.push(a); },
  ...o,
});
const requete = (body, { jeton = "jeton-valide", signal, method = "POST", origin } = {}) => new Request("http://fn/chat", {
  method, signal, body: method === "POST" ? JSON.stringify(body) : undefined,
  headers: { "content-type": "application/json", ...(jeton ? { authorization: "Bearer " + jeton } : {}), ...(origin ? { origin } : {}) },
});
const lignes = async res => (await res.text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
const conv = txt => ({ messages: [{ role: "user", content: "CONSIGNES ET SUPPORTS…" }, { role: "assistant", content: "D'accord." }, { role: "user", content: txt }], tache: "seance" });

/* ---------- Cas normaux ---------- */
test("séance normale : Haiku, effort medium, cache, réponse relayée morceau par morceau", async () => {
  const res = await handle(requete(conv("Explique l'IPP")), deps());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /ndjson/);
  const l = await lignes(res);
  assert.deepEqual(l.filter(x => x.type === "texte").map(x => x.delta), ["### Intégration ", "par parties\n", "\\( u v' \\)"]);
  const fin = l.at(-1);
  assert.equal(fin.type, "fin"); assert.equal(fin.text, "### Intégration par parties\n\\( u v' \\)"); assert.equal(fin.tronque, false);
  assert.equal(fin.modele, "claude-haiku-5-5"); assert.equal(fin.tokens, 1200 + 800 + 50);
  assert.equal(fin.quota.utilise, 1000 + 2050); assert.equal(fin.quota.limite, 500000);
  const r = requetes[0].body;
  assert.equal(r.model, "claude-haiku-5-5"); assert.equal(r.max_tokens, 16000); assert.equal(r.stream, true);
  assert.deepEqual(r.output_config, { effort: "medium" }); assert.deepEqual(r.cache_control, { type: "ephemeral" });
  assert.equal(r.fallbacks, undefined); assert.equal(r.temperature, undefined);
  assert.equal(requetes[0].headers["anthropic-beta"], undefined);
  assert.equal(requetes[0].headers["x-api-key"], "cle-de-test");
  assert.deepEqual(r.messages.map(m => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(appels, [{ owner: "u-1", tache: "seance", modele: "claude-haiku-5-5", statut: "ok", input_tokens: 1200, cache_creation_tokens: 800, cache_read_tokens: 0, output_tokens: 50 }]);
});

test("mode approfondi : Sonnet, effort high, repli serveur en cas de refus", async () => {
  const l = await lignes(await handle(requete({ ...conv("Démontre Rolle"), tier: "complex" }), deps()));
  assert.equal(l.at(-1).modele, "claude-sonnet-5-5");
  const { body, headers } = requetes[0];
  assert.equal(body.model, MODELES.complex.model); assert.deepEqual(body.output_config, { effort: "high" });
  assert.equal(body.fallbacks, "default"); assert.match(headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(appels[0].modele, "claude-sonnet-5-5");
});

test("affichage au fil de l'écriture : les morceaux arrivent avant la fin de la réponse", async () => {
  const res = await handle(requete(conv("#lent")), deps());
  const reader = res.body.getReader(); const t0 = Date.now(); const arrivees = []; let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += new TextDecoder().decode(value);
    for (const l of buf.split("\n").slice(0, -1)) { const o = JSON.parse(l); if (o.type === "texte") arrivees.push(Date.now() - t0); }
    buf = buf.split("\n").at(-1);
  }
  const fin = Date.now() - t0;
  assert.equal(arrivees.length, 6);
  assert.ok(fin - arrivees[0] >= 600, `premier morceau à ${arrivees[0]} ms, fin à ${fin} ms`);
  assert.ok(arrivees[5] - arrivees[0] >= 400, `morceaux étalés (${arrivees.join(", ")} ms) : pas de mise en mémoire tampon`);
});

test("prompt simple et images : images placées avant le texte du dernier message", async () => {
  const png = Buffer.from("faux-png").toString("base64");
  const l = await lignes(await handle(requete({ prompt: "Transcris cette page", tache: "transcription", images: [{ media_type: "image/png", data: png }, { media_type: "image/jpeg", data: png }] }), deps()));
  assert.equal(l.at(-1).type, "fin");
  const c = requetes[0].body.messages[0].content;
  assert.deepEqual(c.map(b => b.type), ["image", "image", "text"]);
  assert.deepEqual(c[0].source, { type: "base64", media_type: "image/png", data: png });
  assert.equal(c[2].text, "Transcris cette page");
  assert.equal(appels[0].tache, "transcription");
});

test("réponse coupée (max_tokens) : signalée, texte gardé", async () => {
  const fin = (await lignes(await handle(requete(conv("#coupe")), deps()))).at(-1);
  assert.equal(fin.type, "fin"); assert.equal(fin.tronque, true); assert.equal(fin.text, "Début de la réponse");
  assert.equal(appels[0].statut, "tronque");
});

/* ---------- Refus et erreurs ---------- */
test("sans connexion ou jeton invalide : 401 session_expired, Claude pas appelé", async () => {
  for (const jeton of [null, "faux"]) {
    const res = await handle(requete(conv("x"), { jeton }), deps());
    assert.equal(res.status, 401); assert.equal((await res.json()).erreur.code, "session_expired");
  }
  assert.equal(requetes.length, 0);
});

test("quota atteint : 429 quota_atteint avec la date de remise à zéro, Claude pas appelé", async () => {
  quotaUtilise = 500000;
  const res = await handle(requete(conv("x")), deps());
  assert.equal(res.status, 429);
  const e = (await res.json()).erreur;
  assert.equal(e.code, "quota_atteint"); assert.match(e.message, /quota de la semaine/);
  assert.equal(e.quota.reinitialisation, "2026-11-09T00:00:00+01:00");
  assert.equal(requetes.length, 0); assert.equal(appels.length, 0);
});

test("forme envoyée par l'app (consignes puis question, deux messages étudiant à la suite) : acceptée et regroupée", async () => {
  const body = { messages: [{ role: "user", content: "CONSIGNES ET SUPPORTS\n\n---\nLa conversation avec l'étudiant commence ci-dessous." },
    { role: "user", content: "Explique l'IPP" }], tier: "default", tache: "seance" };
  const l = await lignes(await handle(requete(body), deps()));
  assert.equal(l.at(-1).type, "fin");
  const m = requetes[0].body.messages;
  assert.equal(m.length, 1); assert.equal(m[0].role, "user");
  assert.equal(m[0].content, "CONSIGNES ET SUPPORTS\n\n---\nLa conversation avec l'étudiant commence ci-dessous.\n\nExplique l'IPP");
  // Suite de séance : consignes, question, réponse, nouvelle question ; un message vide est ignoré.
  requetes = [];
  await lignes(await handle(requete({ messages: [{ role: "user", content: "C" }, { role: "user", content: "Q1" }, { role: "assistant", content: "R1" }, { role: "assistant", content: " " }, { role: "user", content: "Q2" }] }), deps()));
  assert.deepEqual(requetes[0].body.messages, [{ role: "user", content: "C\n\nQ1" }, { role: "assistant", content: "R1" }, { role: "user", content: "Q2" }]);
});

test("plan : format imposé à Claude (sorties structurées) ; format inconnu refusé", async () => {
  await lignes(await handle(requete({ prompt: "Propose un plan", tache: "plan", format: "plan" }), deps()));
  const oc = requetes[0].body.output_config;
  assert.equal(oc.effort, "medium"); assert.equal(oc.format.type, "json_schema");
  assert.deepEqual(oc.format.schema.required, ["etapes"]);
  assert.deepEqual(oc.format.schema.properties.etapes.items.required, ["titre", "detail"]);
  requetes = [];
  await lignes(await handle(requete({ prompt: "Bonjour", tache: "seance" }), deps()));
  assert.equal(requetes[0].body.output_config.format, undefined, "pas de format imposé pour une séance");
  const res = await handle(requete({ prompt: "x", format: "roman" }), deps());
  assert.equal(res.status, 400); assert.match((await res.json()).erreur.raison, /format de réponse « roman » inconnu/);
});

test("format refusé par l'API : nouvel essai sans format, le plan arrive quand même", async () => {
  const journal = [];
  const l = await lignes(await handle(requete({ prompt: "Plan #format400", tache: "plan", format: "plan" }), deps({ log: (...a) => journal.push(a.join(" ")) })));
  assert.equal(l.at(-1).type, "fin");
  assert.equal(requetes.length, 2);
  assert.ok(requetes[0].body.output_config.format); assert.equal(requetes[1].body.output_config.format, undefined);
  assert.equal(requetes[1].body.output_config.effort, "medium");
  assert.ok(journal.some(x => /format refusé.*schema not supported/.test(x)));
});

test("autre refus de l'API (400) : erreur avec le détail de l'API", async () => {
  const l = await lignes(await handle(requete(conv("#400")), deps({ log: () => {} })));
  assert.equal(l.at(-1).code, "requete_invalide"); assert.equal(l.at(-1).detail, "messages: bad thing");
  assert.equal(requetes.length, 1, "pas de nouvel essai sans format imposé");
});

test("texte coupé au milieu d'un caractère spécial : nettoyé avant l'envoi à l'API", async () => {
  await lignes(await handle(requete({ messages: [{ role: "user", content: "Cours : Soit \ud835" }, { role: "user", content: "et 𝜋 ≈ 3,14 \udc65" }], tache: "plan" }), deps()));
  const c = requetes[0].body.messages[0].content;
  assert.equal(c, "Cours : Soit \ufffd\n\net 𝜋 ≈ 3,14 \ufffd");
  assert.ok(c.isWellFormed());
});

test("requêtes invalides : 400 ou 413, message en français", async () => {
  const cas = [
    [{}, 400, "requete_invalide"],
    [{ messages: [] }, 400, "requete_invalide"],
    [{ messages: [{ role: "assistant", content: "x" }] }, 400, "requete_invalide"],
    [{ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }, 400, "requete_invalide"],
    [{ messages: [{ role: "system", content: "a" }] }, 400, "requete_invalide"],
    [{ prompt: "x".repeat(LIMITES.octetsTexte + 1) }, 413, "prompt_too_large"],
    [{ prompt: "x", images: [{ media_type: "image/svg+xml", data: "AAAA" }] }, 400, "image_rejected"],
    [{ prompt: "x", images: [{ media_type: "image/png", data: "pas du base64 !" }] }, 400, "image_rejected"],
    [{ prompt: "x", images: Array(6).fill({ media_type: "image/png", data: "AAAA" }) }, 400, "image_rejected"],
  ];
  for (const [body, status, code] of cas) {
    const res = await handle(requete(body), deps());
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
    const e = (await res.json()).erreur; assert.equal(e.code, code); assert.ok(e.message.length > 10);
    if (code === "requete_invalide") assert.ok(e.raison && e.raison.length > 5, "raison donnée : " + JSON.stringify(e));
  }
  const brut = await handle(new Request("http://fn/chat", { method: "POST", body: "{pas du json", headers: { authorization: "Bearer jeton-valide" } }), deps());
  assert.equal(brut.status, 400);
  assert.equal(requetes.length, 0);
});

test("refus de Claude : erreur refused, consommation enregistrée", async () => {
  const l = await lignes(await handle(requete(conv("#refus")), deps()));
  assert.deepEqual(l.at(-1), { type: "erreur", code: "refused", message: "Le tuteur n'a pas pu répondre à cette demande. Reformule-la." });
  assert.equal(appels[0].statut, "refus"); assert.equal(appels[0].input_tokens, 1200);
});

test("réponse vide : erreur empty_completion", async () => {
  const l = await lignes(await handle(requete(conv("#vide")), deps()));
  assert.equal(l.at(-1).code, "empty_completion");
  assert.equal(appels[0].output_tokens, 3);
});

test("API saturée ou limite de débit : erreur claire, rien de compté", async () => {
  assert.equal((await lignes(await handle(requete(conv("#429")), deps()))).at(-1).code, "rate_limited");
  assert.equal((await lignes(await handle(requete(conv("#529")), deps()))).at(-1).code, "indisponible");
  assert.equal(appels.length, 0);
});

test("le testeur arrête la réponse : appel à Claude coupé, consommation partielle enregistrée", async () => {
  const res = await handle(requete(conv("#pendu")), deps());
  const reader = res.body.getReader();
  const premier = JSON.parse(new TextDecoder().decode((await reader.read()).value).split("\n")[0]);
  assert.equal(premier.delta, "premier morceau");
  await reader.cancel();
  for (let i = 0; i < 50 && (!appels.length || !connexionsFermees); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(connexionsFermees, 1, "la connexion vers Claude est fermée");
  assert.equal(appels[0].statut, "interrompu"); assert.equal(appels[0].input_tokens, 1200);
});

test("une panne de l'enregistrement ne casse pas la réponse", async () => {
  const l = await lignes(await handle(requete(conv("x")), deps({ enregistrer: async () => { throw new Error("db"); }, log: () => {} })));
  assert.equal(l.at(-1).type, "fin");
});

test("quota illisible : 500, Claude pas appelé", async () => {
  const res = await handle(requete(conv("x")), deps({ quota: async () => { throw new Error("db"); }, log: () => {} }));
  assert.equal(res.status, 500); assert.equal(requetes.length, 0);
});

test("CORS : pré-vol accepté, origine filtrée si une liste est donnée", async () => {
  const pre = await handle(requete(null, { method: "OPTIONS", origin: "https://app.test" }), deps());
  assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  const ok = await handle(requete(null, { method: "OPTIONS", origin: "https://app.test" }), deps({ origines: ["https://app.test"] }));
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.test");
  const non = await handle(requete(null, { method: "OPTIONS", origin: "https://pirate.test" }), deps({ origines: ["https://app.test"] }));
  assert.equal(non.headers.get("access-control-allow-origin"), "null");
});

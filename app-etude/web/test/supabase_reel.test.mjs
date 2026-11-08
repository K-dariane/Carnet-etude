// Vérifie, avec la vraie bibliothèque supabase-js (version figée), la forme exacte des requêtes
// qu'utilise app/backend.js : filtres par propriétaire, upsert, mise à jour, liens temporaires, connexion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const recues = [];
const faux = async (url, init = {}) => {
  recues.push({ url: String(url), method: init.method || "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
  const u = String(url);
  const json = u.includes("/object/sign/") ? [{ path: "u1/f/a.pdf", signedURL: "/object/sign/supports/u1/f/a.pdf?token=t", error: null }]
    : u.includes("/auth/v1/otp") ? {} : [{ id: "p1" }];
  return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
};
const sb = createClient("https://projet.supabase.co", "cle-publique", { auth: { persistSession: false, flowType: "implicit" }, global: { fetch: faux } });
const derniere = () => recues.at(-1);

test("lecture des supports d'un projet : filtres owner et projet_id", async () => {
  await sb.from("supports").select("*").eq("owner", "u1").eq("projet_id", "p1");
  const r = derniere(); const u = new URL(r.url);
  assert.equal(u.pathname, "/rest/v1/supports");
  assert.equal(u.searchParams.get("owner"), "eq.u1"); assert.equal(u.searchParams.get("projet_id"), "eq.p1"); assert.equal(u.searchParams.get("select"), "*");
  assert.equal(r.headers.apikey, "cle-publique");
});

test("création : upsert sur le bon conflit", async () => {
  await sb.from("fils").upsert({ projet_id: "p1", id: "principal", owner: "u1", turns: [] }, { onConflict: "projet_id,id" });
  const r = derniere(); const u = new URL(r.url);
  assert.equal(r.method, "POST"); assert.equal(u.searchParams.get("on_conflict"), "projet_id,id");
  assert.match(r.headers.prefer, /resolution=merge-duplicates/);
  assert.deepEqual(JSON.parse(r.body), { projet_id: "p1", id: "principal", owner: "u1", turns: [] });
});

test("mise à jour : PATCH filtré, lignes modifiées renvoyées", async () => {
  const { data } = await sb.from("projets").update({ plan: [] }).eq("owner", "u1").eq("id", "p1").select("id");
  const r = derniere(); const u = new URL(r.url);
  assert.equal(r.method, "PATCH"); assert.equal(u.searchParams.get("id"), "eq.p1"); assert.equal(u.searchParams.get("owner"), "eq.u1");
  assert.match(r.headers.prefer, /return=representation/); assert.deepEqual(data, [{ id: "p1" }]);
});

test("suppression : DELETE filtré", async () => {
  await sb.from("supports").delete().eq("owner", "u1").eq("projet_id", "p1").eq("id", "s1");
  const u = new URL(derniere().url);
  assert.equal(derniere().method, "DELETE"); assert.equal(u.searchParams.get("id"), "eq.s1");
});

test("liens temporaires : forme de la réponse utilisée par backend.js", async () => {
  const { data, error } = await sb.storage.from("supports").createSignedUrls(["u1/f/a.pdf"], 86400);
  assert.equal(error, null);
  assert.equal(new URL(derniere().url).pathname, "/storage/v1/object/sign/supports");
  assert.deepEqual(JSON.parse(derniere().body), { expiresIn: 86400, paths: ["u1/f/a.pdf"] });
  assert.match(data[0].signedUrl, /^https:\/\/projet\.supabase\.co\/storage\/v1\/object\/sign\/supports\/u1\/f\/a\.pdf\?token=t/);
  // backend.js retrouve la référence à partir de ce lien :
  const m = data[0].signedUrl.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?]+)\/([^?#]+)/);
  assert.equal(m[1], "supports"); assert.equal(decodeURIComponent(m[2]), "u1/f/a.pdf");
});

test("lien de connexion par e-mail : adresse de retour transmise", async () => {
  await sb.auth.signInWithOtp({ email: "moi@test.cd", options: { emailRedirectTo: "https://carnet.test/", shouldCreateUser: true } });
  const r = derniere(); const u = new URL(r.url);
  assert.equal(u.pathname, "/auth/v1/otp"); assert.equal(u.searchParams.get("redirect_to"), "https://carnet.test/");
  assert.equal(JSON.parse(r.body).email, "moi@test.cd"); assert.equal(JSON.parse(r.body).create_user, true);
});

test("lien d'e-mail token_hash : l'app le valide par /auth/v1/verify", async () => {
  await sb.auth.verifyOtp({ token_hash: "abc123", type: "email" });
  const r = derniere();
  assert.equal(new URL(r.url).pathname, "/auth/v1/verify"); assert.equal(r.method, "POST");
  assert.deepEqual(JSON.parse(r.body).token_hash, "abc123"); assert.equal(JSON.parse(r.body).type, "email");
});

test("crédit du jour : « Mon compte » appelle la fonction ia_mon_quota", async () => {
  await sb.rpc("ia_mon_quota");
  const r = derniere();
  assert.equal(new URL(r.url).pathname, "/rest/v1/rpc/ia_mon_quota"); assert.equal(r.method, "POST");
});

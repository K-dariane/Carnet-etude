// Tests du schéma Supabase (règles d'accès, cascades) et du script d'import.
// Lancer : npm test   (depuis app-etude/web)
// Option : IMPORT_REEL=<dossier ou .json> pour tester aussi l'import sur un vrai export (jamais commité).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startPg, psql } from "./pg.mjs";
import { readExport, collect, toRows, toSql, listeFichiers } from "../import/import.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let pg; let url;
const q = (s, o) => psql(url, s, o);
const fails = (s, o, re) => assert.throws(() => q(s, o), re);

before(async () => {
  pg = await startPg(); url = pg.url;
  q("drop schema if exists public cascade; create schema public; grant usage, create on schema public to public;");
  q(readFileSync(join(web, "supabase/tests/auth_stub.sql"), "utf8"));
  q("truncate auth.users cascade;");
  for (const f of readdirSync(join(web, "supabase/migrations")).sort()) q(readFileSync(join(web, "supabase/migrations", f), "utf8"));
  q(`insert into auth.users (id, email) values ('${A}', 'a@test.cd'), ('${B}', 'b@test.cd');`);
});
after(() => pg && pg.stop());

/* ---------- Schéma et règles d'accès ---------- */
test("un testeur crée un projet, un support et une conversation chez lui", () => {
  q(`insert into projets (id, titre, type) values ('pa1', 'Projet de A', 'etude');
     insert into supports (id, projet_id, nom, kind, texte) values ('sa1', 'pa1', 'cours', 'note', 'abc');
     insert into fils (projet_id, turns) values ('pa1', '[{"role":"user","content":"Salut","ts":1}]');`, { as: A });
  assert.equal(q("select owner || ' ' || nb_supports || ' ' || plan::text from projets where id = 'pa1'", { as: A }), `${A} 0 []`);
  assert.equal(q("select id from fils where projet_id = 'pa1'", { as: A }), "principal");
  assert.match(q("select carnet_id()"), /^[a-z0-9]{20}$/);
});

test("un autre testeur ne voit ni ne modifie rien de A", () => {
  assert.equal(q("select count(*) from projets", { as: B }), "0");
  assert.equal(q("select count(*) from supports", { as: B }), "0");
  assert.equal(q("select count(*) from fils", { as: B }), "0");
  q("update projets set titre = 'piraté' where id = 'pa1'; delete from supports where id = 'sa1'; delete from fils;", { as: B });
  assert.equal(q("select titre from projets where id = 'pa1'"), "Projet de A");
  assert.equal(q("select count(*) from supports where id = 'sa1'"), "1");
  assert.equal(q("select count(*) from fils"), "1");
});

test("impossible d'écrire au nom d'un autre ou dans son projet", () => {
  fails(`insert into projets (id, owner, titre) values ('pb_fake', '${A}', 'x')`, { as: B }, /row-level security/);
  fails("insert into supports (projet_id, kind) values ('pa1', 'note')", { as: B }, /foreign key|violates/);
  fails("insert into fils (projet_id) values ('pa1')", { as: B }, /foreign key|violates/);
  q("insert into projets (id, titre) values ('pb1', 'Projet de B')", { as: B });
  fails("update projets set parent_id = 'pa1' where id = 'pb1'", { as: B }, /foreign key/);
  fails(`update projets set owner = '${A}' where id = 'pb1'`, { as: B }, /row-level security/);
});

test("un visiteur non connecté n'a aucun accès", () => {
  fails("select count(*) from projets", { as: "anon" }, /permission denied/);
  fails("insert into projets (titre) values ('x')", { as: "anon" }, /permission denied/);
});

test("valeurs refusées : type, kind, titre vide", () => {
  fails("insert into projets (titre, type) values ('x', 'inconnu')", { as: A }, /check/);
  fails("insert into projets (titre) values ('')", { as: A }, /check/);
  fails("insert into supports (projet_id, kind) values ('pa1', 'video')", { as: A }, /check/);
  fails("insert into projets (titre, plan) values ('x', '{}')", { as: A }, /check/);
});

test("suppression d'un projet : supports et conversation supprimés, sous-projets gardés", () => {
  q(`insert into projets (id, titre, parent_id) values ('pa2', 'Sous-projet', 'pa1');
     insert into supports (id, projet_id, kind) values ('sa2', 'pa2', 'note');`, { as: A });
  q("delete from projets where id = 'pa1'", { as: A });
  assert.equal(q("select count(*) from supports where projet_id = 'pa1'"), "0");
  assert.equal(q("select count(*) from fils where projet_id = 'pa1'"), "0");
  assert.equal(q("select coalesce(parent_id, 'null') || ' ' || owner from projets where id = 'pa2'"), `null ${A}`);
  assert.equal(q("select count(*) from supports where projet_id = 'pa2'"), "1");
});

test("suppression du compte : toutes ses données partent", () => {
  q(`insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.cd')`);
  q("insert into projets (id, titre) values ('pc1', 'C'); insert into supports (projet_id, kind) values ('pc1', 'note'); insert into fils (projet_id) values ('pc1');", { as: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  q("delete from auth.users where email = 'c@test.cd'");
  assert.equal(q("select (select count(*) from projets where id = 'pc1') + (select count(*) from supports where projet_id = 'pc1') + (select count(*) from fils where projet_id = 'pc1')"), "0");
});

/* ---------- Import ---------- */
const fixture = join(here, "fixtures/export");

test("lecture de l'export : 3 projets, 3 supports, 1 conversation, document racine ignoré", () => {
  const c = collect(readExport(fixture));
  assert.equal(c.projets.length, 3);
  assert.deepEqual(c.ignores, ["data/users/u_test/carnet"]);
  const { rows, notes } = toRows(c);
  assert.equal(rows.supports.length, 3); assert.equal(rows.fils.length, 1);
  assert.equal(rows.projets.at(-1).id, "psub000000000000000002", "le sous-projet passe après son projet principal");
  assert.ok(notes.some(n => /nbSupports corrigé 5 → 2/.test(n)));
  assert.ok(notes.some(n => /orphelin.*devient autonome/.test(n)));
});

test("import dans la base : champs, dates et JSON identiques à la V1", () => {
  const conv = toRows(collect(readExport(fixture)));
  q(toSql(conv, { email: "A@test.cd" }));
  const p = JSON.parse(q("select row_to_json(p) from projets p where id = 'pmaths00000000000001'", { as: A }));
  assert.equal(p.owner, A);
  assert.equal(p.titre, "Analyse 2 – l'intégrale");
  assert.equal(p.objectif, "Maîtriser l'IPP $$ et les « guillemets »");
  assert.equal(p.echeance, "2026-11-20");
  assert.equal(p.nb_supports, 2);
  assert.deepEqual(p.plan, [{ id: "s1", titre: "Primitives", detail: "Tableau", fait: true }, { id: "s2", titre: "IPP", detail: "Choisir u et v'", fait: false }]);
  assert.deepEqual(p.evolutions, [{ de: "etude", vers: "exercices", date: 1793309500000 }]);
  assert.deepEqual(p.extra, { couleur: "bleu" });
  assert.equal(q("select (extract(epoch from created_at) * 1000)::bigint || ' ' || (extract(epoch from updated_at) * 1000)::bigint from projets where id = 'pmaths00000000000001'"), "1793309294310 1793309633030");
  const s = JSON.parse(q("select row_to_json(s) from supports s where id = 'smaths0000000000pdf1'", { as: A }));
  assert.equal(s.texte, "Intégration par parties : ∫u v' = [uv] − ∫u' v 'cité'");
  assert.equal(s.pages, 8); assert.equal(s.tronque, false); assert.equal(s.actif, true); assert.equal(s.herite, null);
  assert.equal(q("select actif from supports where id = 'smaths000000000note1'"), "f");
  const img = JSON.parse(q("select row_to_json(s) from supports s where id = 'ssub0000000000image1'"));
  assert.equal(img.asset_id, "d65927aa4753977e63d6b78677d0a79c"); assert.equal(img.url, "/_blob/d65927aa4753977e63d6b78677d0a79c"); assert.equal(img.herite, true);
  const turns = JSON.parse(q("select turns from fils where projet_id = 'pmaths00000000000001' and id = 'principal'"));
  assert.deepEqual(turns.map(t => t.role), ["user", "assistant", "event"]);
  assert.equal(turns[0].img, "/_blob/abc"); assert.equal(turns[1].content, "### IPP\n\\[ \\int u v' \\]");
  assert.equal(q("select parent_id || ' ' || focus || ' ' || coalesce(echeance::text, 'null') from projets where id = 'psub000000000000000002'"), "pmaths00000000000001 IPP null");
  assert.equal(q("select coalesce(parent_id, 'null') || ' ' || (extra ->> 'parentIdOrigine') from projets where id = 'porphelin00000000003'"), "null disparu0000000000000");
  assert.equal(q("select count(*) from projets", { as: B }), "1", "B ne voit que son propre projet");
});

test("relancer l'import ne crée pas de doublons", () => {
  const conv = toRows(collect(readExport(fixture)));
  q(toSql(conv, { owner: A }));
  assert.equal(q(`select count(*) from projets where owner = '${A}' and id like 'p%0%'`), "3");
  assert.equal(q("select count(*) from supports where projet_id in ('pmaths00000000000001', 'psub000000000000000002')"), "3");
  assert.equal(q("select count(*) from fils where projet_id = 'pmaths00000000000001'"), "1");
});

test("compte inconnu : import refusé, rien n'est écrit", () => {
  const conv = toRows(collect(readExport(fixture)));
  fails(toSql(conv, { email: "personne@test.cd" }), {}, /Compte introuvable/);
});

test("projet déjà pris par un autre compte : import annulé en entier", () => {
  const before = q(`select count(*) from projets where owner = '${B}'`);
  const conv = toRows(collect(readExport(fixture)));
  fails(toSql(conv, { email: "b@test.cd" }), {}, /appartient déjà à un autre compte/);
  assert.equal(q(`select count(*) from projets where owner = '${B}'`), before);
});

test("export au format fichier JSON (chemins du mode test local/carnet)", () => {
  const docs = { "local/carnet/projets/ploc0000000000000001": { titre: "Local", type: "autre", createdAt: 1, updatedAt: 2 },
    "local/carnet/projets/ploc0000000000000001/supports/sloc1": { nom: "n", kind: "note", texte: "t" } };
  const conv = toRows(collect(docs));
  q(toSql(conv, { owner: B }));
  assert.equal(q("select titre || ' ' || nb_supports from projets where id = 'ploc0000000000000001'", { as: B }), "Local 1");
});

test("données invalides : message clair", () => {
  assert.throws(() => toRows(collect({ "x/projets/p1": { titre: "T", type: "bizarre" } })), /type inconnu « bizarre »/);
  assert.throws(() => toRows(collect({ "x/projets/p1": { type: "etude" } })), /pas de titre/);
  assert.throws(() => toSql({ rows: { projets: [], supports: [], fils: [] } }, {}), /--email ou --owner/);
});

/* ---------- Fichiers (Storage) ---------- */
test("stockage : bucket privé, chaque testeur ne touche qu'à son dossier", () => {
  assert.equal(q("select public || ' ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'supports'"),
    "false 10485760 image/jpeg,image/png,image/webp,image/gif,application/pdf");
  q(`insert into storage.objects (bucket_id, name) values ('supports', '${A}/import/photo.jpg'), ('supports', '${A}/pa9/cours.pdf')`, { as: A });
  q(`insert into storage.objects (bucket_id, name) values ('supports', '${B}/import/b.jpg')`, { as: B });
  fails(`insert into storage.objects (bucket_id, name) values ('supports', '${B}/vol.jpg')`, { as: A }, /row-level security/);
  fails(`insert into storage.objects (bucket_id, name) values ('supports', 'photo-sans-dossier.jpg')`, { as: A }, /row-level security/);
  assert.equal(q("select count(*) from storage.objects", { as: A }), "2");
  assert.equal(q("select count(*) from storage.objects", { as: B }), "1");
  q(`update storage.objects set name = '${A}/renomme.jpg' where name like '${B}/%'; delete from storage.objects where name like '${B}/%'`, { as: A });
  assert.equal(q(`select count(*) from storage.objects where name like '${B}/%'`), "1", "A ne peut ni renommer ni supprimer le fichier de B");
  fails(`update storage.objects set name = '${B}/pris.jpg' where name = '${A}/pa9/cours.pdf'`, { as: A }, /row-level security/);
  q(`delete from storage.objects where name = '${A}/pa9/cours.pdf'`, { as: A });
  assert.equal(q("select count(*) from storage.objects", { as: A }), "1");
  fails("select count(*) from storage.objects", { as: "anon" }, /permission denied/);
});

test("import avec fichiers : adresses /_blob/ remplacées par Storage, copies sans asset_id, fichiers absents signalés", () => {
  const f1 = "11111111111111111111111111111111", f2 = "22222222222222222222222222222222", f3 = "33333333333333333333333333333333";
  const docs = {
    "data/users/x/carnet/projets/pfic0000000000000001": { titre: "Avec fichiers", type: "etude", createdAt: 1, updatedAt: 2 },
    "data/users/x/carnet/projets/pfic0000000000000001/supports/sfic1": { nom: "photo", kind: "image", texte: "t1", url: `/_blob/${f1}`, assetId: f1 },
    "data/users/x/carnet/projets/pfic0000000000000001/supports/sfic2": { nom: "cours perdu", kind: "pdf", texte: "t2", url: `/_blob/${f2}`, assetId: f2 },
    "data/users/x/carnet/projets/pfic0000000000000001/fil/principal": { turns: [
      { role: "user", content: "photo", hadImg: true, img: `/_blob/${f1}`, ts: 1 }, { role: "user", content: "autre", img: `/_blob/${f3}`, ts: 2 }] },
    "data/users/x/carnet/projets/pfic0000000000000002": { titre: "Sous-projet", type: "quiz", parentId: "pfic0000000000000001", createdAt: 3, updatedAt: 4 },
    "data/users/x/carnet/projets/pfic0000000000000002/supports/sfic3": { nom: "photo", kind: "image", texte: "t1", url: `/_blob/${f1}`, herite: true },
  };
  const conv = toRows(collect(docs), { fichiers: new Map([[f1, f1 + ".jpg"]]) });
  assert.equal(conv.notes.filter(n => /introuvable/.test(n)).length, 2);
  q(toSql(conv, { email: "a@test.cd" }));
  const sup = id => JSON.parse(q(`select row_to_json(s) from supports s where id = '${id}'`, { as: A }));
  const chemin = `${A}/import/${f1}.jpg`;
  assert.equal(sup("sfic1").url, "storage:supports/" + chemin); assert.equal(sup("sfic1").asset_id, chemin);
  assert.equal(sup("sfic3").url, "storage:supports/" + chemin); assert.equal(sup("sfic3").asset_id, null, "une copie ne possède pas le fichier");
  assert.equal(sup("sfic2").url, null); assert.equal(sup("sfic2").asset_id, null); assert.equal(sup("sfic2").texte, "t2");
  assert.deepEqual(sup("sfic2").extra, { urlOrigine: `/_blob/${f2}`, assetIdOrigine: f2 });
  const turns = JSON.parse(q("select turns from fils where projet_id = 'pfic0000000000000001'", { as: A }));
  assert.equal(turns[0].img, "storage:supports/" + chemin); assert.equal(turns[0].hadImg, true);
  assert.equal(turns[1].img, undefined); assert.equal(turns[1].imgOrigine, `/_blob/${f3}`); assert.equal(turns[1].content, "autre");
  // Sans --fichiers : rien n'est réécrit (comportement d'avant).
  assert.equal(toRows(collect(docs)).rows.supports.find(r => r.id === "sfic1").url, `/_blob/${f1}`);
});

test("liste des fichiers : seuls les noms <assetId>.<ext> comptent", () => {
  const m = listeFichiers(join(here, "fixtures/fichiers"));
  assert.deepEqual([...m.entries()].sort(), [["d65927aa4753977e63d6b78677d0a79c", "d65927aa4753977e63d6b78677d0a79c.jpg"], ["ffffffffffffffffffffffffffffffff", "ffffffffffffffffffffffffffffffff.pdf"]]);
});

/* ---------- Profils ---------- */
test("profil : chacun crée et modifie le sien, ne voit pas celui des autres", () => {
  q(`insert into profils (prenom, niveau, majeur) values ('Ana', 'universitaire', true)`, { as: A });
  q(`insert into profils (prenom, niveau, majeur, accord_parental) values ('Bob', 'primaire', false, true)`, { as: B });
  assert.equal(q("select owner || ' ' || niveau from profils", { as: A }), `${A} universitaire`);
  assert.equal(q("select count(*) from profils", { as: B }), "1");
  q("update profils set niveau = 'secondaire'", { as: A });
  assert.equal(q(`select niveau from profils where owner = '${A}'`), "secondaire");
  q(`update profils set niveau = 'universitaire' where owner = '${B}'`, { as: A });
  assert.equal(q(`select niveau from profils where owner = '${B}'`), "primaire", "A ne peut pas modifier le profil de B");
  fails(`insert into profils (owner, niveau, majeur) values ('${B}', 'primaire', true)`, { as: A }, /row-level security|duplicate/);
  fails("delete from profils", { as: A }, /permission denied/);
  fails("select * from profils", { as: "anon" }, /permission denied/);
});

test("profil : niveau inconnu refusé ; mineur sans accord parental refusé", () => {
  fails(`update profils set niveau = 'maternelle' where owner = '${A}'`, { as: A }, /check/);
  fails(`update profils set majeur = false, accord_parental = false where owner = '${A}'`, { as: A }, /check/);
});

/* ---------- Consommation IA et quota ---------- */
test("semaine du quota : du lundi 00:00 au lundi suivant, heure de Kinshasa", () => {
  const debut = t => q(`select to_char(ia_debut_semaine('${t}'::timestamptz) at time zone 'Africa/Kinshasa', 'YYYY-MM-DD HH24:MI')`);
  assert.equal(debut("2026-11-04 15:00+01"), "2026-11-02 00:00");
  assert.equal(debut("2026-11-08 23:59+01"), "2026-11-02 00:00", "dimanche soir : encore la même semaine");
  assert.equal(debut("2026-11-08 23:30+00"), "2026-11-09 00:00", "dimanche 23:30 UTC = lundi 00:30 à Kinshasa");
  assert.equal(debut("2026-11-02 00:00+01"), "2026-11-02 00:00");
});

test("quota : seuls les tokens de la semaine en cours comptent, 500 000 par défaut", () => {
  q(`insert into ia_appels (owner, tache, modele, statut, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, created_at) values
     ('${A}', 'seance', 'claude-haiku-5-5', 'ok', 1000, 200, 300, 500, now()),
     ('${A}', 'plan', 'claude-sonnet-5-5', 'tronque', 10, 0, 0, 90, now()),
     ('${A}', 'seance', 'claude-haiku-5-5', 'ok', 99999, 0, 0, 1, ia_debut_semaine() - interval '1 second'),
     ('${B}', 'seance', 'claude-haiku-5-5', 'ok', 7, 0, 0, 0, now());`, { as: "service" });
  assert.equal(q(`select total_tokens from ia_appels where owner = '${A}' and tache = 'plan'`), "100");
  const [utilise, limite, reinit] = q(`select utilise, limite, (reinitialisation = ia_debut_semaine() + interval '7 days') from ia_quota('${A}')`, { as: "service" }).split("|");
  assert.equal(utilise, "2100"); assert.equal(limite, "500000"); assert.equal(reinit, "t");
  assert.equal(q(`select utilise || '/' || limite from ia_quota('dddddddd-0000-4000-8000-000000000000')`, { as: "service" }), "0/500000", "nouveau testeur : rien consommé");
});

test("quota : réglage général et exception par testeur", () => {
  q("update ia_config set quota_semaine = 300000");
  assert.equal(q(`select limite from ia_quota('${A}')`, { as: "service" }), "300000");
  q(`insert into ia_quotas (owner, quota_semaine) values ('${A}', 1000000)`);
  assert.equal(q(`select limite from ia_quota('${A}')`, { as: "service" }), "1000000");
  assert.equal(q(`select limite from ia_quota('${B}')`, { as: "service" }), "300000");
  q(`delete from ia_quotas; update ia_config set quota_semaine = 500000`);
});

test("quota : un testeur voit sa consommation, pas celle des autres, et ne peut rien écrire", () => {
  assert.equal(q("select count(*) from ia_appels", { as: A }), "3");
  assert.equal(q("select count(*) from ia_appels", { as: B }), "1");
  assert.equal(q("select utilise || '/' || limite from ia_mon_quota()", { as: A }), "2100/500000");
  assert.equal(q("select utilise from ia_mon_quota()", { as: B }), "7");
  fails(`insert into ia_appels (owner, tache, modele, statut) values ('${A}', 'seance', 'x', 'ok')`, { as: A }, /permission denied/);
  fails("delete from ia_appels", { as: A }, /permission denied/);
  fails(`select * from ia_quota('${B}')`, { as: A }, /permission denied/);
  fails("update ia_config set quota_semaine = 999999999", { as: A }, /permission denied/);
  fails(`insert into ia_quotas values ('${A}', 999999999)`, { as: A }, /permission denied/);
  fails("select * from ia_mon_quota()", { as: "anon" }, /permission denied/);
  fails("select count(*) from ia_appels", { as: "anon" }, /permission denied/);
});

test("quota : valeurs refusées", () => {
  fails(`insert into ia_appels (owner, tache, modele, statut) values ('${A}', 'piratage', 'x', 'ok')`, { as: "service" }, /check/);
  fails(`insert into ia_appels (owner, tache, modele, statut, output_tokens) values ('${A}', 'seance', 'x', 'ok', -5)`, { as: "service" }, /check/);
});

test("import d'un vrai export (si IMPORT_REEL est défini, avec FICHIERS_REEL pour les photos et PDF)", { skip: !process.env.IMPORT_REEL }, () => {
  const c = collect(readExport(process.env.IMPORT_REEL));
  const conv = toRows(c, { fichiers: process.env.FICHIERS_REEL ? listeFichiers(process.env.FICHIERS_REEL) : undefined });
  if (process.env.FICHIERS_REEL) {
    assert.deepEqual(conv.notes.filter(n => /introuvable/.test(n)), [], "tous les fichiers référencés sont fournis");
    assert.ok(conv.rows.supports.every(s => !s.url || s.url.startsWith("storage:supports/")), "plus aucune adresse /_blob/");
  }
  q(`insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'reel@test.cd') on conflict do nothing`);
  q(toSql(conv, { email: "reel@test.cd" }));
  const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  assert.equal(+q("select count(*) from projets", { as: D }), conv.rows.projets.length);
  assert.equal(+q("select count(*) from supports", { as: D }), conv.rows.supports.length);
  assert.equal(+q("select count(*) from fils", { as: D }), conv.rows.fils.length);
  // Le texte des supports est identique, caractère par caractère.
  for (const s of conv.rows.supports) assert.equal(q(`select md5(texte) from supports where id = '${s.id}'`, { as: D }), md5(s.texte));
  console.log(`  vrai export : ${conv.rows.projets.length} projets, ${conv.rows.supports.length} supports, ${conv.rows.fils.length} conversations`);
  for (const n of conv.notes) console.log("  note : " + n);
});

import { createHash } from "node:crypto";
const md5 = s => createHash("md5").update(s, "utf8").digest("hex");

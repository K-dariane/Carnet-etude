#!/usr/bin/env node
// Import des projets de l'artifact « Carnet d'étude » (V1) vers Supabase.
//
// Entrée : l'export de la base de l'artifact, au choix :
//   - un dossier au format de l'outil d'export (…/data/users/<id>/carnet/projets/<id>.json,
//     …/projets/<id>/supports/<id>.json, …/projets/<id>/fil/principal.json) ;
//   - un fichier JSON { "<chemin du document>": { …champs… }, … }.
// Sortie : un script SQL à exécuter dans l'éditeur SQL de Supabase (ou avec psql).
//   Il tourne dans une transaction : s'il échoue, rien n'est importé.
//   Il peut être relancé : les projets déjà importés sont mis à jour, pas dupliqués.
//
// Utilisation :
//   node import.mjs <export> --email ton@adresse.com [--out import.sql]
//   node import.mjs <export> --owner <uuid>          [--out import.sql]
// Le compte doit déjà exister : connecte-toi une fois à l'app avant l'import.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = ["etude", "revision", "exercices", "devoir", "quiz", "examen", "autre"];
const KINDS = ["pdf", "image", "note"];
const PROJET_COLS = ["titre", "type", "matiere", "objectif", "echeance", "parentId", "focus", "nbSupports", "plan", "evolutions", "createdAt", "updatedAt"];
const SUPPORT_COLS = ["nom", "kind", "texte", "actif", "url", "assetId", "pages", "tronque", "herite", "createdAt"];

/* ---------- Lecture de l'export ---------- */
export function readExport(src) {
  const docs = {};
  if (statSync(src).isDirectory()) {
    const walk = d => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (n.endsWith(".json")) docs[relative(src, f).split(sep).join("/").replace(/\.json$/, "")] = JSON.parse(readFileSync(f, "utf8"));
      }
    };
    walk(src);
  } else Object.assign(docs, JSON.parse(readFileSync(src, "utf8")));
  return docs;
}

/* Range les documents par projet, quel que soit le préfixe (data/users/<id>/carnet ou local/carnet). */
export function collect(docs) {
  const projets = new Map(); const ignores = [];
  const get = id => { if (!projets.has(id)) projets.set(id, { id, data: null, supports: [], fils: [] }); return projets.get(id); };
  for (const [path, data] of Object.entries(docs)) {
    const m = path.match(/(?:^|\/)projets\/([^/]+)(?:\/(supports|fil)\/([^/]+))?$/);
    if (!m || !data || typeof data !== "object") { ignores.push(path); continue; }
    const p = get(m[1]);
    if (!m[2]) p.data = data;
    else if (m[2] === "supports") p.supports.push({ id: m[3], data });
    else p.fils.push({ id: m[3], data });
  }
  const orphelins = [...projets.values()].filter(p => !p.data);
  for (const o of orphelins) { projets.delete(o.id); ignores.push(`projets/${o.id} (supports ou fil sans projet)`); }
  return { projets: [...projets.values()], ignores };
}

/* ---------- Conversion en lignes ---------- */
const clean = v => typeof v === "string" ? v.replace(/\u0000/g, "")
  : Array.isArray(v) ? v.map(clean)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v;
const extraOf = (d, cols) => Object.fromEntries(Object.entries(d).filter(([k]) => !cols.includes(k)));
const ms = v => Number.isFinite(v) ? v : (typeof v === "string" && !isNaN(Date.parse(v)) ? Date.parse(v) : null);
const dateOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export function toRows(collected) {
  const { projets } = collected; const notes = []; const ids = new Set(projets.map(p => p.id));
  const rows = { projets: [], supports: [], fils: [] };
  for (const p of projets) {
    const d = clean(p.data); const extra = extraOf(d, PROJET_COLS);
    if (!d.titre || !String(d.titre).trim()) throw new Error(`Projet ${p.id} : pas de titre.`);
    if (!TYPES.includes(d.type)) throw new Error(`Projet ${p.id} : type inconnu « ${d.type} ».`);
    let parentId = d.parentId || null;
    if (parentId && !ids.has(parentId)) {
      notes.push(`Projet « ${d.titre} » : projet principal ${parentId} absent de l'export, le sous-projet devient autonome.`);
      extra.parentIdOrigine = parentId; parentId = null;
    }
    if (d.echeance && !dateOk(d.echeance)) { notes.push(`Projet « ${d.titre} » : échéance illisible « ${d.echeance} », conservée dans extra.`); extra.echeanceOrigine = d.echeance; }
    const nb = p.supports.length;
    if (Number.isFinite(d.nbSupports) && d.nbSupports !== nb) notes.push(`Projet « ${d.titre} » : nbSupports corrigé ${d.nbSupports} → ${nb} (nombre réel de supports).`);
    const created = ms(d.createdAt) ?? ms(d.updatedAt) ?? Date.now();
    rows.projets.push({
      id: p.id, titre: String(d.titre), type: d.type, matiere: d.matiere ?? "", objectif: d.objectif ?? "",
      echeance: dateOk(d.echeance) ? d.echeance : null, parent_id: parentId, focus: d.focus ?? null, nb_supports: nb,
      plan: Array.isArray(d.plan) ? d.plan : [], evolutions: Array.isArray(d.evolutions) ? d.evolutions : [], extra,
      created_at: created, updated_at: ms(d.updatedAt) ?? created
    });
    for (const s of p.supports) {
      const x = clean(s.data);
      if (!KINDS.includes(x.kind)) throw new Error(`Support ${s.id} du projet « ${d.titre} » : kind inconnu « ${x.kind} ».`);
      rows.supports.push({
        id: s.id, projet_id: p.id, nom: x.nom ?? "", kind: x.kind, texte: x.texte ?? "", actif: x.actif !== false,
        url: x.url ?? null, asset_id: x.assetId ?? null, pages: Number.isFinite(x.pages) ? x.pages : null,
        tronque: typeof x.tronque === "boolean" ? x.tronque : null, herite: typeof x.herite === "boolean" ? x.herite : null,
        extra: extraOf(x, SUPPORT_COLS), created_at: ms(x.createdAt) ?? created
      });
    }
    for (const f of p.fils) {
      const x = clean(f.data);
      if (!Array.isArray(x.turns)) throw new Error(`Conversation ${f.id} du projet « ${d.titre} » : champ turns absent.`);
      rows.fils.push({ projet_id: p.id, id: f.id, turns: x.turns, updated_at: ms(d.updatedAt) ?? created });
    }
  }
  // Les projets principaux avant leurs sous-projets (contrainte de clé étrangère).
  const depth = new Map(); const byId = new Map(rows.projets.map(r => [r.id, r]));
  const dep = (r, seen = new Set()) => {
    if (depth.has(r.id)) return depth.get(r.id);
    if (!r.parent_id || seen.has(r.id)) return 0;
    seen.add(r.id); const v = 1 + dep(byId.get(r.parent_id), seen); depth.set(r.id, v); return v;
  };
  rows.projets.sort((a, b) => dep(a) - dep(b));
  return { rows, notes };
}

/* ---------- Génération du SQL ---------- */
const lit = v => v === null || v === undefined ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const json = v => lit(JSON.stringify(v)) + "::jsonb";
const ts = v => `to_timestamp(${Number(v)} / 1000.0)`;
const bool = v => v === null ? "null" : v ? "true" : "false";
const num = v => v === null ? "null" : String(Math.trunc(v));

export function toSql({ rows }, { email, owner }) {
  if (!email && !owner) throw new Error("Indique le compte de destination : --email ou --owner.");
  if (owner && !/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("--owner doit être un identifiant (uuid) Supabase.");
  const who = email ? `email = ${lit(String(email).trim().toLowerCase())}` : `id = ${lit(owner)}`;
  const L = [];
  L.push("-- Import généré par import.mjs le " + new Date().toISOString());
  L.push(`-- ${rows.projets.length} projets, ${rows.supports.length} supports, ${rows.fils.length} conversations.`);
  L.push("begin;");
  L.push(`create temp table _import_owner on commit drop as select id from auth.users where ${who};`);
  L.push(`do $$ begin if (select count(*) from _import_owner) <> 1 then raise exception 'Compte introuvable (${(email || owner).replace(/['$\\]/g, "")}) : connecte-toi une fois à l''app, puis relance l''import.'; end if; end $$;`);
  // Un identifiant déjà pris par un autre compte bloque tout l'import.
  if (rows.projets.length) L.push(`do $$ begin if exists (select 1 from public.projets where id in (${rows.projets.map(r => lit(r.id)).join(", ")}) and owner <> (select id from _import_owner)) then raise exception 'Un projet de l''export appartient déjà à un autre compte : import annulé.'; end if; end $$;`);
  for (const r of rows.projets) {
    L.push(`insert into public.projets (id, owner, titre, type, matiere, objectif, echeance, parent_id, focus, nb_supports, plan, evolutions, extra, created_at, updated_at) values (${[
      lit(r.id), "(select id from _import_owner)", lit(r.titre), lit(r.type), lit(r.matiere), lit(r.objectif), r.echeance ? lit(r.echeance) + "::date" : "null",
      lit(r.parent_id), lit(r.focus), num(r.nb_supports), json(r.plan), json(r.evolutions), json(r.extra), ts(r.created_at), ts(r.updated_at)
    ].join(", ")})\n  on conflict (id) do update set titre = excluded.titre, type = excluded.type, matiere = excluded.matiere, objectif = excluded.objectif, echeance = excluded.echeance, parent_id = excluded.parent_id, focus = excluded.focus, nb_supports = excluded.nb_supports, plan = excluded.plan, evolutions = excluded.evolutions, extra = excluded.extra, created_at = excluded.created_at, updated_at = excluded.updated_at;`);
  }
  for (const r of rows.supports) {
    L.push(`insert into public.supports (id, owner, projet_id, nom, kind, texte, actif, url, asset_id, pages, tronque, herite, extra, created_at) values (${[
      lit(r.id), "(select id from _import_owner)", lit(r.projet_id), lit(r.nom), lit(r.kind), lit(r.texte), bool(r.actif), lit(r.url), lit(r.asset_id),
      num(r.pages), bool(r.tronque), bool(r.herite), json(r.extra), ts(r.created_at)
    ].join(", ")})\n  on conflict (id) do update set projet_id = excluded.projet_id, nom = excluded.nom, kind = excluded.kind, texte = excluded.texte, actif = excluded.actif, url = excluded.url, asset_id = excluded.asset_id, pages = excluded.pages, tronque = excluded.tronque, herite = excluded.herite, extra = excluded.extra, created_at = excluded.created_at\n  where supports.owner = excluded.owner;`);
  }
  for (const r of rows.fils) {
    L.push(`insert into public.fils (owner, projet_id, id, turns, updated_at) values ((select id from _import_owner), ${lit(r.projet_id)}, ${lit(r.id)}, ${json(r.turns)}, ${ts(r.updated_at)})\n  on conflict (projet_id, id) do update set turns = excluded.turns, updated_at = excluded.updated_at;`);
  }
  // Vérification finale : tout est bien chez le bon compte.
  const chk = (table, n, idCol = "id") => n ? `if (select count(*) from public.${table} where owner = (select id from _import_owner) and ${idCol} in (${rows[table].map(r => lit(table === "fils" ? r.projet_id + "/" + r.id : r.id)).join(", ")})) <> ${n} then raise exception 'Vérification ${table} échouée : import annulé.'; end if;` : "";
  L.push(`do $$ begin ${[chk("projets", rows.projets.length), chk("supports", rows.supports.length), chk("fils", rows.fils.length, "projet_id || '/' || id")].join(" ")} end $$;`);
  L.push("commit;");
  return L.join("\n") + "\n";
}

/* ---------- Ligne de commande ---------- */
function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i]; else args._.push(a);
  }
  if (!args._[0]) {
    console.error("Utilisation : node import.mjs <export (dossier ou .json)> --email ton@adresse.com [--out import.sql]");
    process.exit(2);
  }
  const { projets, ignores } = collect(readExport(args._[0]));
  const conv = toRows({ projets });
  const sql = toSql(conv, { email: args.email, owner: args.owner });
  if (args.out) writeFileSync(args.out, sql); else process.stdout.write(sql);
  const r = conv.rows;
  console.error(`Prêt : ${r.projets.length} projets, ${r.supports.length} supports, ${r.fils.length} conversations.`);
  for (const n of conv.notes) console.error("Note : " + n);
  for (const i of ignores) console.error("Ignoré : " + i);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error("Import impossible : " + e.message); process.exit(1); }
}

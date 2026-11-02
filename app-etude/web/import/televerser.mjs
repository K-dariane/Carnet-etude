#!/usr/bin/env node
// Téléverse les photos et PDF de l'artifact vers Supabase Storage (bucket « supports »),
// dans le dossier du compte : <uid>/import/<assetId>.<ext>. À lancer avant ou après import.mjs.
// Relançable : un fichier déjà présent est remplacé, pas dupliqué.
//
// Utilisation (sur ton ordinateur, jamais dans le navigateur) :
//   SUPABASE_SERVICE_ROLE_KEY=… node televerser.mjs --dossier <fichiers> --owner <uuid>
//   SUPABASE_URL est facultatif (par défaut : le projet du carnet).
// La clé service_role donne tous les droits sur le projet : ne la mets jamais dans le code ni dans le dépôt.

import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { listeFichiers } from "./import.mjs";

export const URL_PROJET = "https://xyrlifukufcntwinrtvz.supabase.co";
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };

export async function televerser({ url = URL_PROJET, cle, owner, dossier, fetchImpl = fetch, log = console.error }) {
  if (!cle) throw new Error("Clé manquante : définis SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API).");
  if (!owner || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) throw new Error("--owner doit être ton identifiant Supabase (uuid), visible dans Authentication → Users.");
  const fichiers = [...listeFichiers(dossier).values()];
  if (!fichiers.length) throw new Error(`Aucun fichier <assetId>.<ext> dans ${dossier}.`);
  const ok = []; const echecs = [];
  for (const f of fichiers) {
    const type = TYPES[extname(f).toLowerCase()];
    if (!type) { echecs.push({ f, raison: "format non accepté" }); continue; }
    const chemin = `${owner.toLowerCase()}/import/${f}`;
    try {
      const r = await fetchImpl(`${url.replace(/\/$/, "")}/storage/v1/object/supports/${chemin}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, apikey: cle, "Content-Type": type, "x-upsert": "true", "Cache-Control": "max-age=3600" },
        body: readFileSync(join(dossier, f)),
      });
      if (r.ok) { ok.push(chemin); log(`Envoyé : ${chemin}`); }
      else {
        const t = await r.text().catch(() => "");
        const raison = r.status === 401 || r.status === 403 ? "clé refusée (vérifie SUPABASE_SERVICE_ROLE_KEY)"
          : r.status === 404 ? "bucket « supports » introuvable (exécute d'abord la migration 20261102000003_stockage.sql)"
          : r.status === 413 ? "fichier trop gros (10 Mo au plus)"
          : `erreur ${r.status} ${t.slice(0, 200)}`;
        echecs.push({ f, raison }); log(`Échec : ${f} — ${raison}`);
      }
    } catch (e) { echecs.push({ f, raison: "réseau : " + e.message }); log(`Échec : ${f} — réseau : ${e.message}`); }
  }
  return { ok, echecs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2); const arg = k => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : undefined; };
  televerser({ url: process.env.SUPABASE_URL || URL_PROJET, cle: process.env.SUPABASE_SERVICE_ROLE_KEY, owner: arg("owner"), dossier: arg("dossier") })
    .then(({ ok, echecs }) => {
      console.error(`Terminé : ${ok.length} fichier(s) envoyé(s), ${echecs.length} échec(s).`);
      process.exit(echecs.length ? 1 : 0);
    })
    .catch(e => { console.error("Téléversement impossible : " + e.message); process.exit(1); });
}

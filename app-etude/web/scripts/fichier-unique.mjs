// Fabrique la version « un seul fichier » de la fonction chat, à coller dans l'éditeur du tableau de bord
// Supabase (Edge Functions → Deploy a new function → Via Editor). Ne pas modifier le résultat à la main :
// modifier supabase/functions/chat/index.ts ou _shared/chat.ts, puis relancer : node scripts/fichier-unique.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const f = join(web, "supabase/functions");
const imports = JSON.parse(readFileSync(join(f, "chat/deno.json"), "utf8")).imports;

export function fabriquer() {
  let coeur = readFileSync(join(f, "_shared/chat.ts"), "utf8");
  let entree = readFileSync(join(f, "chat/index.ts"), "utf8");
  coeur = coeur.replace(/^import type Anthropic from "@anthropic-ai\/sdk";\n/m, "");
  entree = entree.replace(/^import \{ handle, type Appel, type Deps, type Quota \} from "\.\.\/_shared\/chat\.ts";\n/m, "");
  for (const [nom, cible] of Object.entries(imports)) entree = entree.replaceAll(`from "${nom}"`, `from "${cible}"`);
  if (/from "@|_shared/.test(coeur + entree)) throw new Error("import non remplacé");
  const lignesImport = entree.match(/^import .*;\n/gm).join("");
  entree = entree.replace(/^import .*;\n/gm, "");
  return "// FICHIER FABRIQUÉ AUTOMATIQUEMENT par scripts/fichier-unique.mjs — ne pas modifier à la main.\n" +
    "// Fonction « chat » en un seul fichier, à coller dans l'éditeur Supabase (Edge Functions).\n" +
    lignesImport + "\n" + coeur + "\n/* ---------- Point d'entrée ---------- */\n" + entree;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sortie = join(web, "deploiement/chat-un-fichier.ts");
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, fabriquer());
  console.log("Écrit : " + sortie);
}

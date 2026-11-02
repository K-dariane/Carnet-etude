// Le fichier à coller dans Supabase doit correspondre exactement au code testé de la fonction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fabriquer } from "../scripts/fichier-unique.mjs";

test("deploiement/chat-un-fichier.ts est à jour (sinon : node scripts/fichier-unique.mjs)", () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), "../deploiement/chat-un-fichier.ts");
  assert.equal(readFileSync(f, "utf8"), fabriquer());
});

// Postgres jetable pour les tests : utilise $PGURL s'il est défini,
// sinon démarre un serveur temporaire (Postgres 15 ou plus, binaires locaux).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const asRoot = process.getuid && process.getuid() === 0;
const run = (cmd, args, opts = {}) => asRoot
  ? execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], opts)
  : execFileSync(cmd, args, opts);

function pgBin() {
  // La version installée la plus récente, à partir de 15 (les machines GitHub passent d'une version à l'autre).
  const trouvees = existsSync("/usr/lib/postgresql") ? readdirSync("/usr/lib/postgresql") : [];
  const version = trouvees.map(Number).filter(v => v >= 15 && existsSync(`/usr/lib/postgresql/${v}/bin/initdb`)).sort((a, b) => b - a)[0];
  if (version) return `/usr/lib/postgresql/${version}/bin`;
  throw new Error("Postgres 15+ introuvable (trouvé : " + (trouvees.join(", ") || "rien") + "). Installe-le ou définis PGURL.");
}

export async function startPg() {
  if (process.env.PGURL) return { url: process.env.PGURL, stop() {} };
  const bin = pgBin();
  const dir = mkdtempSync(join(tmpdir(), "carnet-pg-")); chmodSync(dir, 0o777);
  const data = join(dir, "data"); const port = String(54000 + Math.floor(Math.random() * 900));
  run(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C.UTF-8"], { stdio: "ignore" });
  run(join(bin, "pg_ctl"), ["-D", data, "-o", `-p ${port} -k ${dir} -c listen_addresses=''`, "-w", "-l", join(dir, "log"), "start"], { stdio: "ignore" });
  return {
    url: `postgresql://postgres@/postgres?host=${dir}&port=${port}`,
    stop() { try { run(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"], { stdio: "ignore" }); } catch {} rmSync(dir, { recursive: true, force: true }); }
  };
}

// Exécute un script SQL. as = uuid → rôle « authenticated » avec ce compte ; "anon" → visiteur ; "service" → fonction serveur.
export function psql(url, script, { as } = {}) {
  let head = "";
  if (as === "anon") head = "set role anon;\n";
  else if (as === "service") head = "set role service_role;\n";
  else if (as) head = `set role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${as}","role":"authenticated"}', false) \\g /dev/null\n`;
  const r = spawnSync("psql", [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { input: head + script, encoding: "utf8" });
  if (r.status !== 0) { const e = new Error((r.stderr || "").trim() || "psql a échoué"); e.stderr = r.stderr; throw e; }
  return r.stdout.trim();
}

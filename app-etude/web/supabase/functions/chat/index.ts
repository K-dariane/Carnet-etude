// Fonction serveur « chat » (Supabase Edge Function, Deno).
// Secrets nécessaires : ANTHROPIC_API_KEY (à ajouter) ; SUPABASE_URL et la clé serveur (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS) sont fournis par Supabase.
// Déployer avec --no-verify-jwt : la fonction vérifie elle-même le jeton du testeur (auth.getUser).
// Facultatif : ALLOWED_ORIGINS = adresses de l'app séparées par des virgules (ex. https://carnet.example.com).
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { handle, type Appel, type Quota } from "../_shared/chat.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Secret manquant : ${k}`);
  return v;
};

// Clé serveur : ancienne clé service_role, ou nouvelle clé secrète (sb_secret_…) fournie dans SUPABASE_SECRET_KEYS.
function cleServeur(): string {
  const ancienne = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (ancienne) return ancienne;
  try {
    const cles = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    const v = cles.default || Object.values(cles)[0];
    if (v) return v;
  } catch { /* format inattendu */ }
  throw new Error("Secret manquant : SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS");
}

const anthropic = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 2 });
const admin = createClient(env("SUPABASE_URL"), cleServeur(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(req => handle(req, {
  anthropic,
  sdk: Anthropic,
  origines: (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean),
  async userFromToken(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  async quota(owner): Promise<Quota> {
    const { data, error } = await admin.rpc("ia_quota", { p_owner: owner }).single();
    if (error) throw error;
    const d = data as { utilise: number; limite: number; reinitialisation: string };
    return { utilise: Number(d.utilise), limite: Number(d.limite), reinitialisation: d.reinitialisation };
  },
  async enregistrer(appel: Appel) {
    const { error } = await admin.from("ia_appels").insert(appel);
    if (error) throw error;
  },
  log: (...a) => console.error(...a),
}));

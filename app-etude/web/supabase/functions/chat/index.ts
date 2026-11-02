// Fonction serveur « chat » (Supabase Edge Function, Deno).
// Secrets nécessaires : ANTHROPIC_API_KEY (à ajouter) ; SUPABASE_URL et la clé serveur (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS) sont fournis par Supabase.
// Déployer avec --no-verify-jwt : la fonction vérifie elle-même le jeton du testeur (auth.getUser).
// Facultatif : ALLOWED_ORIGINS = adresses de l'app séparées par des virgules (ex. https://carnet.example.com).
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { handle, type Appel, type Deps, type Quota } from "../_shared/chat.ts";

// Configuration lue à la première requête : si un secret manque, la fonction répond quand même
// et donne le NOM du secret manquant (jamais sa valeur), au lieu de planter au démarrage.
function cleServeur(): string | null {
  // Ancienne clé service_role, ou nouvelle clé secrète (sb_secret_…) fournie dans SUPABASE_SECRET_KEYS.
  const ancienne = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (ancienne) return ancienne;
  try {
    const cles = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    return cles.default || Object.values(cles)[0] || null;
  } catch { return null; }
}

type Pret = { deps: Deps } | { manquants: string[] };
let pret: Pret | null = null;
function configurer(): Pret {
  const cleClaude = Deno.env.get("ANTHROPIC_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const cle = cleServeur();
  const manquants = [
    ...(cleClaude ? [] : ["ANTHROPIC_API_KEY"]),
    ...(url ? [] : ["SUPABASE_URL"]),
    ...(cle ? [] : ["SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEYS)"]),
  ];
  if (manquants.length) return { manquants };
  const anthropic = new Anthropic({ apiKey: cleClaude!, maxRetries: 2 });
  const admin = createClient(url!, cle!, { auth: { persistSession: false, autoRefreshToken: false } });
  return { deps: {
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
  } };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(req => {
  if (!pret || "manquants" in pret) pret = configurer();   // réessaie tant que la configuration est incomplète
  const p = pret;
  if ("manquants" in p) {
    console.error("Secrets manquants :", p.manquants.join(", "));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return new Response(JSON.stringify({ erreur: { code: "configuration",
      message: "Le serveur du carnet n'est pas encore configuré. Préviens l'équipe.", manquants: p.manquants } }),
      { status: 503, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  }
  return handle(req, p.deps);
});

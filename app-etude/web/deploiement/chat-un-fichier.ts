// FICHIER FABRIQUÉ AUTOMATIQUEMENT par scripts/fichier-unique.mjs — ne pas modifier à la main.
// Fonction « chat » en un seul fichier, à coller dans l'éditeur Supabase (Edge Functions).
import Anthropic from "npm:@anthropic-ai/sdk@0.135.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// Cœur de la fonction serveur « chat » : vérifie le testeur et son quota, appelle Claude,
// renvoie la réponse au fil de l'écriture et enregistre la consommation.
// Aucune dépendance directe à Deno ou à Supabase : tout passe par `deps`, pour pouvoir tester sous Node.
//
// Requête (POST, JSON) :
//   { messages: [{ role: "user" | "assistant", content: string }, …],   // ou prompt: string
//     tier: "default" | "complex",      // "complex" = mode approfondi
//     tache: "seance" | "transcription" | "plan" | "resume" | "autre",
//     images: [{ media_type: "image/jpeg" | "image/png", data: "<base64>" }] }  // jointes au dernier message
// Réponse : flux NDJSON (une ligne JSON par événement) :
//   { type: "texte", delta }   … puis   { type: "fin", text, tronque, modele, tokens, quota }
//   ou { type: "erreur", code, message } si Claude échoue en cours de route.
// Erreurs avant le flux : statut HTTP + { erreur: { code, message } }.


export const MODELES = {
  default: { model: "claude-haiku-5-5", effort: "medium" },
  complex: { model: "claude-sonnet-5-5", effort: "high" },
} as const;
export const MAX_TOKENS = 16000;
export const LIMITES = {
  octetsTexte: 300_000,        // texte total envoyé (la V1 vise 245 000)
  images: 5,
  octetsImage: 5_000_000,      // une image en base64
  octetsCorps: 12_000_000,     // requête entière
  messages: 200,
};
const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const TACHES = ["seance", "transcription", "plan", "resume", "autre"];

/* Formats de réponse imposés à Claude (sorties structurées de l'API) : la réponse respecte exactement le schéma. */
export const FORMATS: Record<string, Record<string, unknown>> = {
  plan: {
    type: "object",
    properties: {
      etapes: {
        type: "array",
        items: {
          type: "object",
          properties: { titre: { type: "string" }, detail: { type: "string" } },
          required: ["titre", "detail"],
          additionalProperties: false,
        },
      },
    },
    required: ["etapes"],
    additionalProperties: false,
  },
};

export const MESSAGES_ERREUR: Record<string, string> = {
  session_expired: "Ta session a expiré : reconnecte-toi puis réessaie.",
  quota_atteint: "Tu as utilisé tout ton quota de la semaine. Il se remet à zéro lundi.",
  requete_invalide: "La demande envoyée n'est pas valide. Recharge la page et réessaie.",
  prompt_too_large: "Trop de contenu envoyé d'un coup. Désactive quelques supports ou efface la conversation.",
  image_rejected: "Cette image n'a pas été acceptée (format ou taille). Essaie une autre photo.",
  rate_limited: "Le tuteur est très demandé en ce moment. Réessaie dans une minute.",
  refused: "Le tuteur n'a pas pu répondre à cette demande. Reformule-la.",
  empty_completion: "Le tuteur n'a rien répondu. Reformule ou demande moins à la fois.",
  indisponible: "Le tuteur est indisponible pour le moment. Réessaie dans quelques minutes.",
  erreur_serveur: "Problème sur le serveur. Réessaie ; si ça continue, préviens l'équipe.",
};

export interface Quota { utilise: number; limite: number; reinitialisation: string }
export interface Appel {
  owner: string; tache: string; modele: string;
  statut: "ok" | "tronque" | "refus" | "interrompu" | "erreur";
  input_tokens: number; cache_creation_tokens: number; cache_read_tokens: number; output_tokens: number;
}
export interface Deps {
  anthropic: Pick<Anthropic, "beta">;
  sdk: { APIError: typeof Anthropic.APIError; APIUserAbortError: typeof Anthropic.APIUserAbortError; RateLimitError: typeof Anthropic.RateLimitError };
  userFromToken(jwt: string): Promise<{ id: string } | null>;
  quota(owner: string): Promise<Quota>;
  enregistrer(appel: Appel): Promise<void>;
  origines?: string[];           // origines autorisées (CORS) ; vide ou absent = toutes
  log?(...a: unknown[]): void;
}

type Msg = { role: "user" | "assistant"; content: string };
type Img = { media_type: string; data: string };

const enc = new TextEncoder();
const octets = (s: string) => enc.encode(s).length;

function cors(req: Request, deps: Deps): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const ok = !deps.origines || !deps.origines.length || deps.origines.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (deps.origines?.length ? origin : "*") : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function erreur(req: Request, deps: Deps, status: number, code: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ erreur: { code, message: MESSAGES_ERREUR[code] || MESSAGES_ERREUR.erreur_serveur, ...extra } }),
    { status, headers: { ...cors(req, deps), "Content-Type": "application/json; charset=utf-8" } });
}

/* Valide la requête et construit les messages pour l'API. Renvoie un code d'erreur (avec la raison) ou les paramètres.
   Plusieurs messages du même rôle à la suite sont acceptés et regroupés : la V1 envoie les consignes et les supports
   dans un premier message « user », suivi directement de la question de l'étudiant. */
export function preparer(body: unknown): { code: string; raison?: string } | { messages: Anthropic.Beta.BetaMessageParam[]; tier: "default" | "complex"; tache: string; format?: string } {
  const refus = (raison: string) => ({ code: "requete_invalide", raison });
  if (!body || typeof body !== "object") return refus("corps de la demande absent ou illisible");
  const b = body as Record<string, unknown>;
  let brut: Msg[];
  if (typeof b.prompt === "string") brut = [{ role: "user", content: b.prompt }];
  else if (Array.isArray(b.messages)) brut = b.messages as Msg[];
  else return refus("ni « messages » ni « prompt »");
  if (!brut.length) return refus("aucun message");
  if (brut.length > LIMITES.messages) return refus(`plus de ${LIMITES.messages} messages`);
  let total = 0;
  const msgs: Msg[] = [];
  for (let i = 0; i < brut.length; i++) {
    const m = brut[i];
    if (!m || typeof m.content !== "string") return refus(`message ${i + 1} : contenu absent`);
    if (m.role !== "user" && m.role !== "assistant") return refus(`message ${i + 1} : rôle « ${String(m?.role)} » inconnu`);
    if (!m.content.trim()) continue;                       // message vide : ignoré
    total += octets(m.content);
    const prec = msgs[msgs.length - 1];
    if (prec && prec.role === m.role) prec.content += "\n\n" + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }
  if (!msgs.length) return refus("tous les messages sont vides");
  if (msgs[0].role !== "user") return refus("le premier message doit venir de l'étudiant");
  if (msgs[msgs.length - 1].role !== "user") return refus("le dernier message doit venir de l'étudiant");
  if (total > LIMITES.octetsTexte) return { code: "prompt_too_large" };
  const imgs = (b.images ?? []) as Img[];
  if (!Array.isArray(imgs) || imgs.length > LIMITES.images) return { code: "image_rejected" };
  for (const im of imgs) {
    if (!im || !TYPES_IMAGE.includes(im.media_type) || typeof im.data !== "string" || !im.data
      || im.data.length > LIMITES.octetsImage || !/^[A-Za-z0-9+/]+={0,2}$/.test(im.data)) return { code: "image_rejected" };
  }
  const tier = b.tier === "complex" ? "complex" : "default";
  const tache = TACHES.includes(b.tache as string) ? (b.tache as string) : "autre";
  const messages: Anthropic.Beta.BetaMessageParam[] = msgs.map((m, i) => {
    if (i !== msgs.length - 1 || !imgs.length) return { role: m.role, content: m.content };
    return { role: "user", content: [
      ...imgs.map(im => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.media_type as "image/jpeg", data: im.data } })),
      { type: "text" as const, text: m.content },
    ] };
  });
  if (b.format !== undefined && !(typeof b.format === "string" && FORMATS[b.format])) return refus(`format de réponse « ${String(b.format)} » inconnu`);
  return { messages, tier, tache, ...(typeof b.format === "string" ? { format: b.format } : {}) };
}

/* Paramètres envoyés à Claude. */
export function parametres(messages: Anthropic.Beta.BetaMessageParam[], tier: "default" | "complex", format?: string) {
  const m = MODELES[tier];
  const p: Anthropic.Beta.MessageCreateParamsStreaming = {
    model: m.model,
    max_tokens: MAX_TOKENS,
    stream: true,
    output_config: { effort: m.effort, ...(format && FORMATS[format] ? { format: { type: "json_schema" as const, schema: FORMATS[format] } } : {}) },
    cache_control: { type: "ephemeral" },  // met en cache tout le début de la conversation (consignes, supports)
    messages,
  };
  // Sonnet : en cas de refus pour raison de sécurité, l'API relance la demande sur un autre modèle.
  if (tier === "complex") { p.betas = ["server-side-fallback-2026-07-01"]; p.fallbacks = "default"; }
  return p;
}

// Message d'erreur de l'API Claude (sans secret), pour le diagnostic.
function detailApi(e: unknown): string {
  const err = e as { error?: { error?: { message?: string } }; message?: string };
  return String(err?.error?.error?.message || err?.message || "").slice(0, 300);
}

function codeApi(e: unknown, deps: Deps): string {
  if (e instanceof deps.sdk.RateLimitError) return "rate_limited";
  if (e instanceof deps.sdk.APIError) {
    const s = e.status;
    if (s === 413) return "prompt_too_large";
    if (s === 400) return "requete_invalide";
    if (s === 429) return "rate_limited";
    if (s === 529 || (s && s >= 500)) return "indisponible";
  }
  return "erreur_serveur";
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return erreur(req, deps, 405, "requete_invalide");

  // 1. Qui appelle ?
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const user = jwt ? await deps.userFromToken(jwt).catch(() => null) : null;
  if (!user) return erreur(req, deps, 401, "session_expired");

  // 2. Requête valide ?
  const taille = Number(req.headers.get("content-length") || 0);
  if (taille > LIMITES.octetsCorps) return erreur(req, deps, 413, "prompt_too_large");
  let body: unknown;
  try { const t = await req.text(); if (octets(t) > LIMITES.octetsCorps) return erreur(req, deps, 413, "prompt_too_large"); body = JSON.parse(t); }
  catch { return erreur(req, deps, 400, "requete_invalide"); }
  const prep = preparer(body);
  if ("code" in prep) {
    if (prep.raison) deps.log?.("demande refusée :", prep.raison);
    return erreur(req, deps, prep.code === "prompt_too_large" ? 413 : 400, prep.code, prep.raison ? { raison: prep.raison } : {});
  }

  // 3. Quota de la semaine
  let q: Quota;
  try { q = await deps.quota(user.id); }
  catch (e) { deps.log?.("quota", e); return erreur(req, deps, 500, "erreur_serveur"); }
  if (q.utilise >= q.limite) return erreur(req, deps, 429, "quota_atteint", { quota: q });

  // 4. Appel à Claude, relayé au fil de l'écriture
  const params = parametres(prep.messages, prep.tier, prep.format);
  const ctl = new AbortController();
  req.signal?.addEventListener("abort", () => ctl.abort());
  const usage = { input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };
  const majUsage = (u: Record<string, number | null | undefined> | null | undefined) => {
    if (!u) return;
    if (u.input_tokens != null) usage.input_tokens = u.input_tokens;
    if (u.cache_creation_input_tokens != null) usage.cache_creation_tokens = u.cache_creation_input_tokens;
    if (u.cache_read_input_tokens != null) usage.cache_read_tokens = u.cache_read_input_tokens;
    if (u.output_tokens != null) usage.output_tokens = u.output_tokens;
  };
  const total = () => usage.input_tokens + usage.cache_creation_tokens + usage.cache_read_tokens + usage.output_tokens;

  let ferme = false;
  const flux = new ReadableStream<Uint8Array>({
    async start(c) {
      const envoyer = (o: unknown) => { if (!ferme) { try { c.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { ferme = true; } } };
      let statut: Appel["statut"] = "erreur"; let texte = ""; let modele: string = params.model;
      const lancer = async (p: typeof params) => {
        const stream = deps.anthropic.beta.messages.stream(p, { signal: ctl.signal });
        for await (const ev of stream) {
          if (ev.type === "message_start") { majUsage(ev.message.usage as never); if (ev.message.model) modele = ev.message.model; }
          else if (ev.type === "message_delta") majUsage(ev.usage as never);
          else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { texte += ev.delta.text; envoyer({ type: "texte", delta: ev.delta.text }); }
        }
        return stream.finalMessage();
      };
      try {
        let fin;
        try { fin = await lancer(params); }
        catch (e) {
          // Format de réponse refusé par l'API (400 avant tout texte) : on relance sans format imposé ;
          // l'app sait lire la réponse libre.
          if (!(e instanceof deps.sdk.APIError && e.status === 400 && params.output_config?.format && !texte)) throw e;
          deps.log?.("format refusé par l'API, nouvel essai sans format :", detailApi(e));
          const { format: _f, ...oc } = params.output_config!;
          fin = await lancer({ ...params, output_config: oc });
        }
        majUsage(fin.usage as never); if (fin.model) modele = fin.model;
        if (fin.stop_reason === "refusal") { statut = "refus"; envoyer({ type: "erreur", code: "refused", message: MESSAGES_ERREUR.refused }); }
        else if (!texte.trim()) { statut = "ok"; envoyer({ type: "erreur", code: "empty_completion", message: MESSAGES_ERREUR.empty_completion }); }
        else {
          statut = fin.stop_reason === "max_tokens" ? "tronque" : "ok";
          envoyer({ type: "fin", text: texte, tronque: statut === "tronque", modele, tokens: total(),
            quota: { ...q, utilise: q.utilise + total() } });
        }
      } catch (e) {
        if (ctl.signal.aborted || e instanceof deps.sdk.APIUserAbortError) statut = "interrompu";
        else {
          deps.log?.("claude", e); const code = codeApi(e, deps); const detail = detailApi(e);
          envoyer({ type: "erreur", code, message: MESSAGES_ERREUR[code], ...(detail && code !== "rate_limited" ? { detail } : {}) });
        }
      } finally {
        if (total() > 0 || statut !== "erreur") {
          await deps.enregistrer({ owner: user.id, tache: prep.tache, modele, statut, ...usage }).catch(e => deps.log?.("enregistrer", e));
        }
        if (!ferme) { ferme = true; try { c.close(); } catch { /* déjà ferme */ } }
      }
    },
    cancel() { ferme = true; ctl.abort(); },
  });
  return new Response(flux, { headers: { ...cors(req, deps), "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/* ---------- Point d'entrée ---------- */
// Fonction serveur « chat » (Supabase Edge Function, Deno).
// Secrets nécessaires : ANTHROPIC_API_KEY (à ajouter) ; SUPABASE_URL et la clé serveur (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS) sont fournis par Supabase.
// Déployer avec --no-verify-jwt : la fonction vérifie elle-même le jeton du testeur (auth.getUser).
// Facultatif : ALLOWED_ORIGINS = adresses de l'app séparées par des virgules (ex. https://carnet.example.com).

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

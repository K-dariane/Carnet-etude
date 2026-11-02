// Vérifie la fonction « chat » dans Deno, l'environnement réel des Edge Functions Supabase.
// Lancer : npm run test:deno
import Anthropic from "@anthropic-ai/sdk";
import { handle, type Appel } from "../supabase/functions/_shared/chat.ts";

const ev = (o: Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
let ferme = false;
const api = Deno.serve({ port: 0, onListen() {} }, async req => {
  const body = await req.json();
  const pendu = JSON.stringify(body).includes("#pendu");
  const evs = [
    ev({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, output_tokens: 1 } } }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bonjour " } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Deno" } }),
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } }),
    ev({ type: "message_stop" }),
  ];
  let i = 0;
  return new Response(new ReadableStream({
    async pull(c) {
      if (pendu && i === 3) { await new Promise(r => setTimeout(r, 10_000)); }
      if (i >= evs.length) return c.close();
      c.enqueue(new TextEncoder().encode(evs[i++]));
    },
    cancel() { ferme = true; },
  }), { headers: { "content-type": "text/event-stream" } });
});
const appels: Appel[] = [];
const deps = {
  anthropic: new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${api.addr.port}`, maxRetries: 0 }),
  sdk: Anthropic,
  userFromToken: async () => ({ id: "u" }),
  quota: async () => ({ utilise: 0, limite: 500000, reinitialisation: "x" }),
  enregistrer: async (a: Appel) => { appels.push(a); },
};
const req = (t: string) => new Request("http://fn", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify({ prompt: t }) });
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

Deno.test("réponse relayée sous Deno", async () => {
  const lignes = (await (await handle(req("Salut"), deps)).text()).trim().split("\n").map(l => JSON.parse(l));
  eq(lignes.map(l => l.type), ["texte", "texte", "fin"], "événements");
  eq(lignes[2].text, "Bonjour Deno", "texte"); eq(lignes[2].tokens, 22, "tokens");
  eq(appels.at(-1)?.statut, "ok", "statut");
});

Deno.test("arrêt par le testeur sous Deno : appel coupé et compté", async () => {
  const res = await handle(req("#pendu"), deps);
  const r = res.body!.getReader();
  await r.read(); await r.cancel();
  for (let i = 0; i < 100 && !(ferme && appels.at(-1)?.statut === "interrompu"); i++) await new Promise(r => setTimeout(r, 20));
  eq(ferme, true, "connexion vers Claude fermée");
  eq(appels.at(-1)?.statut, "interrompu", "statut");
  await api.shutdown();
});

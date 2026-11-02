(() => {
  const store = new Map(); const subs = [];
  const notify = () => subs.forEach(f => f());
  const snapDoc = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path), metadata:{fromCache:false,hasPendingWrites:false} });
  const docRef = (path) => ({ id: path.split("/").pop(), path,
    get: async () => snapDoc(path),
    set: async (d) => { store.set(path, JSON.parse(JSON.stringify(d))); setTimeout(notify, 10); },
    update: async (d) => { if (!store.has(path)) throw {code:"invalid_argument"}; store.set(path, {...store.get(path), ...JSON.parse(JSON.stringify(d))}); setTimeout(notify,10); },
    delete: async () => { store.delete(path); setTimeout(notify,10); },
    onSnapshot: (next) => { const f = () => next(snapDoc(path)); subs.push(f); setTimeout(f, 5); return () => subs.splice(subs.indexOf(f),1); },
    collection: (c) => colRef(path + "/" + c) });
  const colRef = (path) => { const docs = () => [...store.keys()].filter(k => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).map(snapDoc);
    const q = { get: async () => ({ docs: docs(), size: docs().length, empty: !docs().length }),
      onSnapshot: (next) => { const f = () => { const d = docs(); next({ docs: d, size: d.length, empty: !d.length, docChanges: () => [], metadata:{} }); }; subs.push(f); setTimeout(f, 5); return () => subs.splice(subs.indexOf(f),1); } };
    return { path, ...q, doc: (id) => docRef(path + "/" + (id || Math.random().toString(36).slice(2))), add: async (d) => { const r = docRef(path + "/" + Math.random().toString(36).slice(2)); await r.set(d); return r; } };
  };
  const db = { doc: docRef, collection: colRef };
  const reply = "### Intégration par parties\nD'après ton cours *cours*, la formule est :\n\\[ \\int u v' \\,dx = [uv] - \\int u' v \\,dx \\]\nAvec \\(u = x\\) et **\\(v' = e^x\\)** :\n\n" + "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 120\"><rect width=\"300\" height=\"120\" fill=\"#fff\"/><line x1=\"20\" y1=\"100\" x2=\"280\" y2=\"100\" stroke=\"#222\"/><path d=\"M20 100 Q150 0 280 30\" stroke=\"#2442c4\" fill=\"none\" stroke-width=\"3\"/><text x=\"150\" y=\"115\" font-size=\"14\" font-family=\"sans-serif\">x e^x</text></svg>\n```\n\n- Résultat : $x e^x - e^x + C$\n\nVeux-tu un exercice ?";
  const sample = async (input, opts = {}) => { window.__lastInput = input; window.__lastOpts = opts; let t = ""; for (const ch of reply.match(/[\s\S]{1,40}/g)) { await new Promise(r => setTimeout(r, 20)); t += ch; opts.onText && opts.onText({ text: t, delta: ch }); } return { text: reply, truncated: false, modelTierApplied: "default" }; };
  sample.json = async () => [{ titre: "Revoir les primitives", detail: "Tableau des primitives" }, { titre: "Formule IPP", detail: "Choisir u et v'" }, { titre: "Exercices", detail: "10 calculs" }];
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 5e6, mediaTypes: ["image/jpeg","image/png"] } });
  const assets = { upload: async (b) => ({ id: "a1", url: URL.createObjectURL(b) }), delete: async () => {} };
  const user = { id: async () => "u123" };
  const caps = { db, sample, assets, user };
  window.claude = { use: async (n) => caps[n] ?? null };
  window.__store = store;
})();

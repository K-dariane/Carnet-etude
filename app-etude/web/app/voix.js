/* Carnet d'étude — version web : la voix.
   Dictée (reconnaissance vocale du téléphone) et lecture à voix haute (voix française du téléphone), gratuites.
   paroles() transforme une réponse (Markdown + formules LaTeX) en texte qui se lit bien à voix haute :
   « \frac{a}{b} » → « a sur b », « x^2 » → « x au carré », schémas et tableaux annoncés au lieu d'être lus. */
"use strict";
(function () {
  /* ---------- Formules → paroles ---------- */
  const GREC = { alpha: "alpha", beta: "bêta", gamma: "gamma", delta: "delta", epsilon: "epsilon", varepsilon: "epsilon", zeta: "dzêta",
    eta: "êta", theta: "thêta", lambda: "lambda", mu: "mu", nu: "nu", xi: "xi", pi: "pi", rho: "rhô", sigma: "sigma", tau: "tau",
    phi: "phi", varphi: "phi", chi: "khi", psi: "psi", omega: "oméga", Gamma: "gamma", Delta: "delta",
    Theta: "thêta majuscule", Lambda: "lambda majuscule", Pi: "pi majuscule", Sigma: "sigma majuscule", Phi: "phi majuscule", Omega: "oméga majuscule" };
  const COMMANDES = {
    times: " fois ", cdot: " fois ", div: " divisé par ", pm: " plus ou moins ", mp: " moins ou plus ",
    leq: " inférieur ou égal à ", le: " inférieur ou égal à ", geq: " supérieur ou égal à ", ge: " supérieur ou égal à ",
    neq: " différent de ", ne: " différent de ", approx: " environ égal à ", simeq: " environ égal à ", equiv: " équivalent à ",
    in: " appartient à ", notin: " n'appartient pas à ", subset: " inclus dans ", subseteq: " inclus dans ", cup: " union ", cap: " inter ",
    to: " vers ", rightarrow: " vers ", mapsto: " associe ", Rightarrow: " implique ", implies: " implique ",
    Leftrightarrow: " équivaut à ", iff: " équivaut à ", infty: " l'infini ", forall: " pour tout ", exists: " il existe ",
    partial: " d rond ", nabla: " nabla ", emptyset: " l'ensemble vide ", varnothing: " l'ensemble vide ", angle: " angle ",
    perp: " perpendiculaire à ", parallel: " parallèle à ", dots: " … ", ldots: " … ", cdots: " … ", circ: " rond ",
    sin: " sinus ", cos: " cosinus ", tan: " tangente ", arcsin: " arc sinus ", arccos: " arc cosinus ", arctan: " arc tangente ",
    ln: " logarithme népérien de ", log: " logarithme de ", exp: " exponentielle de ", max: " maximum ", min: " minimum ", det: " déterminant ",
    "%": " pour cent ", ",": " ", ";": " ", "!": "", quad: " ", qquad: " ", displaystyle: "", left: "", right: "", big: "", Big: "",
  };
  const SYMBOLES = { "≤": " inférieur ou égal à ", "≥": " supérieur ou égal à ", "≠": " différent de ", "≈": " environ égal à ",
    "∈": " appartient à ", "∉": " n'appartient pas à ", "⊂": " inclus dans ", "∪": " union ", "∩": " inter ", "→": " vers ",
    "⇒": " implique ", "⇔": " équivaut à ", "∞": " l'infini ", "∀": " pour tout ", "∃": " il existe ", "√": " racine carrée de ",
    "∫": " intégrale de ", "∑": " somme de ", "∂": " d rond ", "×": " fois ", "÷": " divisé par ", "±": " plus ou moins ",
    "π": " pi ", "Δ": " delta ", "α": " alpha ", "β": " bêta ", "θ": " thêta ", "λ": " lambda ", "μ": " mu ", "σ": " sigma ", "ω": " oméga ",
    "ℝ": " R ", "ℕ": " N ", "ℤ": " Z ", "ℚ": " Q ", "ℂ": " C ", "²": " au carré ", "³": " au cube ", "°": " degrés " };
  const remplacerSymboles = t => t.replace(/[≤≥≠≈∈∉⊂∪∩→⇒⇔∞∀∃√∫∑∂×÷±πΔαβθλμσωℝℕℤℚℂ²³°]/g, c => SYMBOLES[c]);

  // Lit le groupe {…} (ou un seul caractère) à partir de i ; renvoie [contenu, fin].
  function groupe(t, i) {
    while (t[i] === " ") i++;
    if (t[i] !== "{") return [t[i] || "", i + 1];
    let n = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "{") n++;
      else if (t[j] === "}" && --n === 0) return [t.slice(i + 1, j), j + 1];
    }
    return [t.slice(i + 1), t.length];
  }
  // Remplace « \nom{a}{b}… » (de l'intérieur vers l'extérieur) par fn(a, b, …).
  function commande(t, nom, nbArgs, fn, optionnel) {
    for (let garde = 0; garde < 200; garde++) {
      const re = new RegExp("\\\\" + nom + "(?![A-Za-z])");
      const m = re.exec(t); if (!m) return t;
      let i = m.index + m[0].length; let opt = null;
      if (optionnel && t[i] === "[") { const f = t.indexOf("]", i); opt = t.slice(i + 1, f); i = f + 1; }
      const args = [];
      for (let k = 0; k < nbArgs; k++) { const [a, f] = groupe(t, i); args.push(a); i = f; }
      t = t.slice(0, m.index) + fn(...args.map(a => maths(a)), opt && maths(opt)) + t.slice(i);
    }
    return t;
  }
  // Indice et exposant après \int, \sum, \lim : renvoie { bas, haut, suite }.
  function bornes(t) {
    let bas = "", haut = "", i = 0;
    for (let k = 0; k < 2; k++) {
      while (t[i] === " ") i++;
      if (t[i] === "_") { const [g, f] = groupe(t, i + 1); bas = maths(g); i = f; }
      else if (t[i] === "^") { const [g, f] = groupe(t, i + 1); haut = maths(g); i = f; }
    }
    return { bas, haut, suite: t.slice(i) };
  }

  function maths(tex) {
    let t = String(tex);
    t = commande(t, "(?:text|mathrm|textbf|mathbf|mathit|operatorname)", 1, a => " " + a + " ");
    t = commande(t, "mathbb", 1, a => " " + a + " ");
    t = commande(t, "[dt]?frac", 2, (a, b) => ` ${a} sur ${b} `);
    t = commande(t, "sqrt", 1, (a, n) => {
      const k = (n || "").trim();
      return !k || k === "2" ? ` racine carrée de ${a} ` : k === "3" ? ` racine cubique de ${a} ` : ` racine ${k}ième de ${a} `;
    }, true);
    t = commande(t, "vec", 1, a => ` vecteur ${a} `);
    t = commande(t, "overrightarrow", 1, a => ` vecteur ${a} `);
    t = commande(t, "overline", 1, a => ` ${a} `);
    t = commande(t, "binom", 2, (a, b) => ` ${b} parmi ${a} `);
    for (const [nom, mot, lien] of [["iiint", "intégrale triple", "de"], ["iint", "intégrale double", "de"], ["int", "intégrale", "de"],
      ["sum", "somme", "de"], ["prod", "produit", "de"], ["lim", "limite", "de"]]) {
      for (let garde = 0; garde < 50; garde++) {
        const m = new RegExp("\\\\" + nom + "(?![A-Za-z])").exec(t); if (!m) break;
        const b = bornes(t.slice(m.index + m[0].length));
        let dit = ` ${mot} `;
        const debut = b.bas.match(/^\s*(.+?)\s+égal\s+(.+?)\s*$/);
        if (nom === "lim" && b.bas) dit += `quand ${b.bas.replace(/\s+vers\s+/, " tend vers ")} `;
        else if ((nom === "sum" || nom === "prod") && debut && b.haut) dit += `pour ${debut[1]} allant de ${debut[2]} à ${b.haut} `;
        else if (b.bas && b.haut) dit += `de ${b.bas} à ${b.haut} `;
        else if (b.bas) dit += `sur ${b.bas} `;
        t = t.slice(0, m.index) + dit + lien + " " + b.suite;
      }
    }
    // Exposants et indices.
    t = t.replace(/\^\s*\{?\\circ\}?/g, " degrés ");
    for (let garde = 0; garde < 100; garde++) {
      const i = t.search(/[\^_]/); if (i < 0) break;
      const [g, f] = groupe(t, i + 1); const v = maths(g).trim();
      const dit = t[i] === "_" ? ` indice ${v} ` : v === "2" ? " au carré " : v === "3" ? " au cube " : ` puissance ${v.replace(/^-\s*/, "moins ")} `;
      t = t.slice(0, i) + dit + t.slice(f);
    }
    t = t.replace(/\\([A-Za-z]+|[%,;!])/g, (m, c) => COMMANDES[c] ?? (GREC[c] ? ` ${GREC[c]} ` : " "));
    t = t.replace(/(\w+)\s*!/g, " factorielle $1 ");
    t = t.replace(/([A-Za-z])''/g, "$1 seconde ").replace(/([A-Za-z])'/g, "$1 prime ");
    t = t.replace(/\b([fghuvFGP])((?:\s+(?:prime|seconde))?)\s*\(([^()]*)\)/g, (m, f, p, x) => `${f}${p} de ${x}`);
    t = remplacerSymboles(t)
      .replace(/<=/g, " inférieur ou égal à ").replace(/>=/g, " supérieur ou égal à ").replace(/!=/g, " différent de ")
      .replace(/=/g, " égal ").replace(/\+/g, " plus ").replace(/(^|[\s(])-(?=\s*[\w(\\])/g, "$1 moins ").replace(/(\w|\))\s*-\s*/g, "$1 moins ")
      .replace(/\//g, " sur ").replace(/</g, " inférieur à ").replace(/>/g, " supérieur à ").replace(/\*/g, " fois ")
      .replace(/[{}()[\]|\\&]/g, " ");
    return t.replace(/\s+/g, " ");
  }

  function paroles(md) {
    let t = String(md || "");
    t = t.replace(/```\s*svg[\s\S]*?(?:```|$)/gi, " (schéma affiché à l'écran). ")
      .replace(/```[\s\S]*?(?:```|$)/g, " (code affiché à l'écran). ")
      .replace(/(?:^[ \t]*\|.*\|[ \t]*(?:\n|$))+/gm, " (tableau affiché à l'écran).\n");
    t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g,
      (m, a, b, c, d) => " " + maths(a ?? b ?? c ?? d) + " ");
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*>\s?/gm, "").replace(/^\s*[-*•+]\s+/gm, "")
      .replace(/\*\*|__|`/g, "").replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, "$1$2")
      .replace(/^\s*-{3,}\s*$/gm, "");
    t = remplacerSymboles(t)
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
      .normalize("NFKC");           // 𝑥 → x, ﬁ → fi…
    return t.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  }

  /* ---------- Lecture à voix haute ---------- */
  const synth = window.speechSynthesis;
  let voixFr = null;
  const choisirVoix = () => {
    const v = synth ? synth.getVoices() : [];
    voixFr = v.find(x => /^fr[-_]FR/i.test(x.lang) && x.localService) || v.find(x => /^fr[-_]FR/i.test(x.lang)) || v.find(x => /^fr/i.test(x.lang)) || null;
  };
  if (synth) { choisirVoix(); synth.addEventListener?.("voiceschanged", choisirVoix); }
  let lectureId = 0;
  // Découpe en phrases d'au plus 220 caractères : certains téléphones coupent les longues lectures.
  function phrases(t) {
    const out = [];
    for (const p of t.split(/(?<=[.!?…:;])\s+|\n+/)) {
      let r = p.trim();
      while (r.length > 220) { const k = r.lastIndexOf(" ", 220); out.push(r.slice(0, k > 60 ? k : 220)); r = r.slice(k > 60 ? k + 1 : 220); }
      if (r) out.push(r);
    }
    return out;
  }
  function lire(md, { surFin } = {}) {
    if (!synth) { surFin && surFin(); return; }
    arreter();
    const id = ++lectureId; const morceaux = phrases(paroles(md));
    if (!morceaux.length) { surFin && surFin(); return; }
    let i = 0;
    const suivant = () => {
      if (id !== lectureId) return;
      if (i >= morceaux.length) { lectureId++; surFin && surFin(); return; }
      const u = new SpeechSynthesisUtterance(morceaux[i++]);
      u.lang = "fr-FR"; if (voixFr) u.voice = voixFr; u.rate = 1;
      u.onend = suivant; u.onerror = suivant;
      synth.speak(u);
    };
    suivant();
  }
  function arreter() { lectureId++; if (synth) synth.cancel(); }
  const enLecture = () => !!synth && synth.speaking;
  // iOS n'autorise la voix qu'après un geste : à appeler dans un clic.
  function debloquer() { if (synth) { const u = new SpeechSynthesisUtterance(""); u.volume = 0; synth.speak(u); } }

  /* ---------- Dictée ---------- */
  const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ERREURS = {
    "not-allowed": "Autorise l'accès au micro pour ce site (réglages du navigateur), puis réessaie.",
    "service-not-allowed": "Autorise l'accès au micro pour ce site (réglages du navigateur), puis réessaie.",
    "no-speech": "Je n'ai rien entendu. Touche le micro et parle juste après.",
    "audio-capture": "Aucun micro trouvé sur cet appareil.",
    "network": "La dictée a besoin d'internet. Vérifie ta connexion puis réessaie.",
  };
  let reco = null;
  function dicter({ surTexte, surFin, surErreur } = {}) {
    if (!Reco) { surErreur && surErreur("La dictée n'est pas disponible dans ce navigateur. Essaie Chrome ou Safari."); return; }
    arreterDictee(); arreter();
    const r = new Reco(); reco = r;
    r.lang = "fr-FR"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = "", erreur = null;
    r.onresult = e => {
      let provisoire = ""; final = "";
      for (let k = 0; k < e.results.length; k++) {
        const x = e.results[k][0].transcript;
        if (e.results[k].isFinal) final += x; else provisoire += x;
      }
      surTexte && surTexte((final + provisoire).trim(), !provisoire);
    };
    r.onerror = e => { erreur = e.error; if (e.error !== "aborted") surErreur && surErreur(ERREURS[e.error] || "La dictée n'a pas marché. Réessaie."); };
    r.onend = () => { if (reco === r) reco = null; surFin && surFin(final.trim(), erreur); };
    try { r.start(); } catch { reco = null; surErreur && surErreur("La dictée n'a pas pu démarrer. Touche le micro pour réessayer."); }
  }
  function arreterDictee() { if (reco) { const r = reco; reco = null; try { r.abort(); } catch { /* déjà arrêtée */ } } }
  const enDictee = () => !!reco;

  window.carnetVoix = {
    peutDicter: () => !!Reco, peutLire: () => !!synth,
    dicter, arreterDictee, enDictee, lire, arreter, enLecture, debloquer, paroles,
  };
})();

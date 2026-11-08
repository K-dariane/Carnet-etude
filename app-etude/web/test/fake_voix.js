// Fausse voix pour les tests : reconnaissance vocale (dictée) et synthèse vocale (lecture), sans micro ni haut-parleur.
// window.__dictees : nombre de dictées démarrées ; window.__lu : phrases lues ; window.__phraseDictee : ce que « dit » l'élève.
(() => {
  window.__dictees = 0; window.__lu = []; window.__phraseDictee = "Explique la dérivée";
  class FausseReco {
    start() {
      window.__dictees++; this.actif = true;
      const res = (t, fin) => { const r = [{ transcript: t }]; r.isFinal = fin; return r; };
      setTimeout(() => this.actif && this.onresult && this.onresult({ results: [res(window.__phraseDictee.split(" ")[0], false)] }), 30);
      setTimeout(() => this.actif && this.onresult && this.onresult({ results: [res(window.__phraseDictee, true)] }), 80);
      setTimeout(() => { if (this.actif) { this.actif = false; this.onend && this.onend(); } }, 120);
    }
    abort() { if (this.actif) { this.actif = false; this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); } }
    stop() { this.abort(); }
  }
  for (const nom of ["SpeechRecognition", "webkitSpeechRecognition"]) Object.defineProperty(window, nom, { configurable: true, writable: true, value: FausseReco });
  let parle = false;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => [{ lang: "fr-FR", localService: true, name: "Voix test" }],
    addEventListener() {},
    get speaking() { return parle; },
    speak(u) { if (!u.text) return; parle = true; window.__lu.push(u.text); setTimeout(() => { parle = false; u.onend && u.onend(); }, 20); },
    cancel() { parle = false; },
  } });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
})();

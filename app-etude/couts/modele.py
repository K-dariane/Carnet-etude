# Prix par million de tokens (Claude API, octobre 2026)
P = {
 "haiku":  dict(i=0.10, o=0.50, w=0.125, r=0.01),   # cache supposé aux mêmes multiplicateurs (1,25x / 0,1x)
 "sonnet": dict(i=2.00, o=10.0, w=2.50,  r=0.20),
 "opus":   dict(i=4.00, o=20.0, w=5.00,  r=0.40),
}
SYS, CTX = 2000, 25000          # instructions + supports de cours (tokens)
USER, ANS = 80, 600             # question / réponse moyennes
OUT_OVERHEAD = 1.3              # marge pour schémas SVG et réflexion

def session(model, n):          # n échanges, cache activé
    p = P[model]; cost = 0; prefix = SYS + CTX
    cost += prefix * p["w"]                              # 1re écriture du cache
    for i in range(n):
        if i: cost += prefix * p["r"] + (USER + ANS) * p["w"]; prefix += USER + ANS
        else: cost += USER * p["i"]
        cost += ANS * OUT_OVERHEAD * p["o"]
    return cost / 1e6

def photo(model):               # transcription d'une photo de cours
    p = P[model]; return ((1600 + 300) * p["i"] + 900 * p["o"]) / 1e6

def mix(n, share_sonnet):
    return (1 - share_sonnet) * session("haiku", n) + share_sonnet * session("sonnet", n)

print("Coût d'une séance d'1 h (15 échanges) :")
for m in P: print(f"  {m:7s} {session(m,15):.4f} $")
print(f"  mix 70% Haiku / 30% Sonnet {mix(15,.3):.4f} $")
print("Séance de 3 h (40 échanges) :", {m: round(session(m,40),3) for m in P}, "mix", round(mix(40,.3),3))
print(f"Photo : haiku {photo('haiku'):.5f} $, sonnet {photo('sonnet'):.4f} $")

# Profils mensuels : (séances d'1 h, photos)
profils = {"léger": (4, 5), "régulier": (12, 15), "intensif": (30, 40)}
print("\nCoût IA par étudiant et par mois (mix 70/30, photos lues par Sonnet) :")
for k, (s, ph) in profils.items():
    c = s * mix(15, .3) + ph * photo("sonnet") + 0.05   # + plans/résumés
    cs = s * session("sonnet", 15) + ph * photo("sonnet") + 0.05
    print(f"  {k:9s} mix {c:.2f} $   | tout Sonnet {cs:.2f} $")

# Coûts fixes mensuels
fixes = {"Base de données + stockage (Supabase Pro)": 25, "Hébergement du site (offre gratuite)": 0,
         "Nom de domaine (~12 $/an)": 1, "Notifications push (Web Push)": 0, "Divers / marge outils": 4}
F = sum(fixes.values()); print("\nCoûts fixes mensuels :", F, "$")

def bilan(prix, n_payants, n_gratuits, profil_payant="régulier"):
    s, ph = profils[profil_payant]
    ia_p = s * mix(15, .3) + ph * photo("sonnet") + 0.05
    ia_g = 3 * session("haiku", 15) + 3 * photo("haiku")      # offre gratuite bridée sur Haiku
    rev = prix * n_payants * (1 - 0.02)                        # ~2 % frais mobile money
    cout = F + ia_p * n_payants + ia_g * n_gratuits
    return rev, cout, rev - cout

print("\nScénarios (prix/mois, payants, gratuits) -> recettes, coûts, résultat :")
for prix in (1.5, 2, 3, 5):
    for n in (20, 100, 500):
        r, c, m = bilan(prix, n, n * 4)
        print(f"  {prix:>4} $  {n:4d} payants + {n*4:4d} gratuits : {r:8.0f} $ {c:8.0f} $ {m:+8.0f} $")

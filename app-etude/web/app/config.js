// Configuration publique de l'app web. Ces deux valeurs peuvent être dans le navigateur :
// la clé « anon » (ou « publishable ») ne donne que les droits prévus par les règles d'accès.
// Ne mets JAMAIS ici la clé service_role ni la clé Claude.
window.CARNET_CONFIG = {
  supabaseUrl: "https://xyrlifukufcntwinrtvz.supabase.co",
  supabaseAnonKey: "à préciser"  // Supabase → Project Settings → API → clé anon / publishable
};

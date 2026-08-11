import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs dans le build : le même `dist/` fonctionne servi depuis un
  // sous-chemin (GitHub Pages : /<repo>/) comme depuis la racine (Crazy Games).
  base: './',
  build: {
    target: 'es2020',
    // Le seed doc impose <= 20 Mo de téléchargement initial ; on veut être averti
    // bien avant d'en approcher. Phaser seul pèse ~1,5 Mo minifié (~350 Ko gzip).
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true, // expose le dev server sur le réseau local (test téléphone)
  },
});

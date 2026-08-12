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
    // Le bundle sort dans `dist/bundle/` et non dans le `dist/assets/` par défaut : depuis
    // le Lot 5, `public/assets/` est **entièrement généré** par `npm run assets` et se
    // recopie tel quel dans `dist/assets/`. Laisser les deux se mélanger rendrait illisible
    // le poids par atlas dans le rapport du CI, et exposerait à une collision de noms entre
    // un fichier du pipeline et un chunk de Vite.
    assetsDir: 'bundle',
  },
  server: {
    host: true, // expose le dev server sur le réseau local (test téléphone)
  },
});

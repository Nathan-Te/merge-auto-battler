import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

/**
 * Le nom du jeu n'est écrit **qu'une fois**, dans `src/i18n/en.json` (`game.title`).
 *
 * `index.html` est un fichier statique : sans ce greffon, le nom vivrait à deux endroits —
 * le dictionnaire pour le jeu, la balise `<title>` pour l'onglet — et le jour où il change,
 * on en oublierait un. Le titre injecté ici est celui de l'onglet **avant** que le jeu ne
 * démarre ; `main.js` le réécrit ensuite dans la langue réellement choisie.
 */
function injectGameTitle() {
  return {
    name: 'merge-battler-title',
    transformIndexHtml(html) {
      const en = JSON.parse(readFileSync(new URL('./src/i18n/en.json', import.meta.url), 'utf8'));
      return html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${en.game.title}</title>`
      );
    },
  };
}

export default defineConfig({
  plugins: [injectGameTitle()],
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

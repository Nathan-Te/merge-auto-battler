/**
 * Galerie d'assets — page statique **générée** par `npm run assets`.
 *
 * C'est **l'outil de revue principal des assets**, et il est conçu pour un téléphone : la
 * boucle visée est « j'envoie une planche depuis l'appli GitHub → le CI la découpe → je
 * regarde la galerie sur le même téléphone → je corrige le manifest ». Tout ce qui suit
 * découle de ça :
 *
 *   - **fond en damier** derrière chaque sprite : c'est le seul moyen de voir qu'un
 *     détourage a laissé un halo blanc ou mangé un bord ;
 *   - **poids et dimensions sous chaque vignette**, parce qu'un sprite trop lourd se
 *     repère à l'œil dans une liste triée ;
 *   - **le budget en tête de page**, comparé au poids réel — la contrainte du seed doc n'a
 *     de valeur que si on la voit à chaque revue, pas une fois en fin de lot ;
 *   - **les manques annoncés** : ce que le jeu sait afficher mais qu'aucune planche ne
 *     fournit. C'est ce qui remplace la lecture du code quand on remplit un manifest.
 *
 * Le CSS est intégré et la page ne charge rien d'autre que ses propres images : elle est
 * consultable hors ligne, et le seed doc interdit de toute façon toute requête externe.
 *
 * Fonction pure : elle prend un modèle et rend une chaîne. Aucun accès disque, donc testable.
 */

/** Poids lisible : on ne montre jamais « 1048576 octets » à quelqu'un qui arbitre. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Les noms viennent du manifest, donc de quelqu'un : ils ne sont jamais sûrs. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #12141c;
  --panel: #191d2a;
  --line: #2c3350;
  --text: #eef1f8;
  --dim: #8f97b0;
  --ok: #6bcb77;
  --warn: #ff9f43;
  --bad: #ff6b6b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0 0 3rem;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header {
  padding: 1rem;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 2;
}
h1 { margin: 0 0 .25rem; font-size: 1.1rem; }
h2 {
  margin: 2rem 1rem .5rem;
  font-size: 1rem;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: .08em;
}
.sub { margin: 0; color: var(--dim); font-size: .82rem; }
.budget { margin-top: .7rem; display: flex; flex-wrap: wrap; gap: .4rem; }
.pill {
  padding: .2rem .55rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: .78rem;
  white-space: nowrap;
}
.pill.ok { border-color: var(--ok); color: var(--ok); }
.pill.warn { border-color: var(--warn); color: var(--warn); }
.pill.bad { border-color: var(--bad); color: var(--bad); }
.grid {
  display: grid;
  /* Trois colonnes sur un téléphone en portrait, davantage dès qu'il y a la place. */
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: .6rem;
  padding: 0 1rem;
}
figure {
  margin: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: .5rem;
  overflow: hidden;
}
.thumb {
  /* Damier : c'est lui qui rend un détourage raté visible d'un coup d'œil. */
  background-color: #20242f;
  background-image:
    linear-gradient(45deg, #2b3040 25%, transparent 25%, transparent 75%, #2b3040 75%),
    linear-gradient(45deg, #2b3040 25%, transparent 25%, transparent 75%, #2b3040 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
  aspect-ratio: 1;
  position: relative;
  overflow: hidden;
}
/*
 * Chaque vignette est une **fenêtre découpée dans l'atlas**, pas un fichier de plus : la
 * galerie est déployée avec le jeu, et réexporter 60 sprites à l'unité doublerait le poids
 * d'assets pour une page de revue. Le facteur d'échelle est calculé à la génération.
 */
.thumb i {
  position: absolute;
  left: 50%;
  top: 50%;
  background-repeat: no-repeat;
  transform-origin: center;
}
figcaption { padding: .35rem .45rem .5rem; font-size: .68rem; line-height: 1.35; }
.name { display: block; word-break: break-all; }
.meta { color: var(--dim); }
.missing { color: var(--warn); }
.orphan { color: var(--bad); }
ul.notes { margin: .4rem 1rem 0; padding-left: 1.1rem; color: var(--dim); font-size: .8rem; }
ul.notes li { margin: .15rem 0; }
footer { margin: 2rem 1rem 0; color: var(--dim); font-size: .75rem; }
`;

/**
 * Rend la page.
 *
 * @param {object} model
 * @param {string} model.generatedAt Horodatage lisible
 * @param {{name: string, file: string, bytes: number, width: number, height: number}[]} model.atlases
 * @param {{category: string, sprites: object[]}[]} model.groups
 * @param {{label: string, bytes: number}[]} model.extras Audio, polices…
 * @param {number} model.totalBytes Poids total du jeu (dist estimé)
 * @param {{target: number, max: number}} model.budgetKb
 * @param {string[]} model.missing Sprites attendus par le jeu et absents
 * @param {string[]} model.orphans Sprites découpés que le jeu n'utilise pas
 * @returns {string} HTML complet
 */
export function renderGallery(model) {
  const { budgetKb, totalBytes } = model;
  const targetBytes = budgetKb.target * 1024;
  const maxBytes = budgetKb.max * 1024;
  const budgetClass = totalBytes > maxBytes ? 'bad' : totalBytes > targetBytes ? 'warn' : 'ok';
  const budgetWord =
    totalBytes > maxBytes
      ? 'au-dessus de la limite dure'
      : totalBytes > targetBytes
        ? 'sous la limite, au-dessus de la cible'
        : 'sous la cible';

  const pills = [
    `<span class="pill ${budgetClass}">total ${formatBytes(totalBytes)} — ${budgetWord}</span>`,
    `<span class="pill">cible ${formatBytes(targetBytes)}</span>`,
    `<span class="pill">limite ${formatBytes(maxBytes)}</span>`,
    ...model.atlases.map(
      (atlas) =>
        `<span class="pill">${escapeHtml(atlas.name)} ${formatBytes(atlas.bytes)} · ` +
        `${atlas.width}×${atlas.height}</span>`
    ),
    ...model.extras.map(
      (extra) => `<span class="pill">${escapeHtml(extra.label)} ${formatBytes(extra.bytes)}</span>`
    ),
  ].join('\n      ');

  const sections = model.groups
    .filter((group) => group.sprites.length > 0)
    .map((group) => {
      const cards = group.sprites
        .map((sprite) => {
          // La vignette occupe au plus 96 px : au-delà, trois colonnes ne tiennent plus
          // sur un téléphone en portrait, qui est l'écran de revue.
          const scale = Math.min(1, 96 / Math.max(sprite.width, sprite.height));
          const style = [
            `width:${sprite.width}px`,
            `height:${sprite.height}px`,
            `background-image:url(${escapeHtml(sprite.atlas)})`,
            `background-position:-${sprite.x}px -${sprite.y}px`,
            `transform:translate(-50%,-50%) scale(${scale.toFixed(3)})`,
          ].join(';');
          return `        <figure>
          <div class="thumb"><i style="${style}"></i></div>
          <figcaption>
            <span class="name">${escapeHtml(sprite.name)}</span>
            <span class="meta">${sprite.width}×${sprite.height} · ≈${formatBytes(sprite.bytes)}</span>
          </figcaption>
        </figure>`;
        })
        .join('\n');
      return `      <h2>${escapeHtml(group.category)} · ${group.sprites.length}</h2>
      <div class="grid">
${cards}
      </div>`;
    })
    .join('\n');

  const notes = [];
  if (model.missing.length > 0) {
    notes.push(
      `<li class="missing"><strong>${model.missing.length} sprite(s) attendus par le jeu et absents</strong> ` +
        `(le greybox vectoriel prend le relais) : ${model.missing.map(escapeHtml).join(', ')}</li>`
    );
  }
  if (model.orphans.length > 0) {
    notes.push(
      `<li class="orphan"><strong>${model.orphans.length} sprite(s) découpés que le jeu n'utilise pas</strong> ` +
        `— faute de frappe dans <code>names</code> ? : ${model.orphans.map(escapeHtml).join(', ')}</li>`
    );
  }
  if (notes.length === 0 && model.groups.some((group) => group.sprites.length > 0)) {
    notes.push('<li>Tous les sprites attendus par le jeu sont fournis.</li>');
  }
  if (model.groups.every((group) => group.sprites.length === 0)) {
    notes.push(
      '<li>Aucune planche découpée : dépose une image dans <code>assets-src/</code> et ' +
        'décris-la dans <code>assets-src/manifest.json</code>.</li>'
    );
  }

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Galerie d'assets — Merge Battler</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <header>
      <h1>Galerie d'assets</h1>
      <p class="sub">
        Page générée par <code>npm run assets</code> le ${escapeHtml(model.generatedAt)} —
        ne pas éditer à la main.
      </p>
      <div class="budget">
      ${pills}
      </div>
      <ul class="notes">
${notes.map((note) => `        ${note}`).join('\n')}
      </ul>
    </header>
${sections}
    <footer>
      Tout problème d'asset se diagnostique ici avant de toucher au code : un sprite mal
      détouré, mal cadré ou absent se voit sur cette page, et se corrige dans
      <code>assets-src/manifest.json</code>.
    </footer>
  </body>
</html>
`;
}

export default renderGallery;

/**
 * Lecture, validation et formules de `balance.json` pour la bande de combat.
 * **Aucune dépendance à Phaser** — tout est testable dans vitest.
 *
 * Deux responsabilités :
 *   - `parseBattleConfig()` : refuse une config incomplète plutôt que d'inventer un
 *     défaut (même règle que `parseSpawnerConfig`, cf. `balance.schema.md`) ;
 *   - les formules de stats : `unitStats()` et `enemyStats()` sont **les seuls** endroits
 *     où l'on calcule une valeur de gameplay à partir du tier ou du numéro de vague.
 *
 * Choix assumé : les stats par tier sont **calculées** (`stat(1) × facteur^(tier-1)`) et
 * non listées. 4 types × 11 tiers feraient 44 lignes à maintenir à la main au Lot 3, pour
 * une courbe que le seed doc veut de toute façon régulière.
 *
 * Depuis le Lot 2.5, les unités **vivent et meurent** : elles ont des PV et une vitesse de
 * marche, et les ennemis ont de quoi les frapper (`damage`, `attackRateMs`, `attackRange`).
 */

/** Rôles reconnus, et clés supplémentaires que chacun exige. */
const ROLE_KEYS = {
  damage: [],
  aoe: ['splashRadius'],
  slow: ['slowFactor', 'slowDurationMs', 'slowRadius'],
  support: ['auraRadius'],
};

const TIER_SCALING_KEYS = ['hp', 'damage', 'fireRateMs', 'range', 'effect'];

/** Lit un nombre obligatoire, avec un message d'erreur qui pointe la clé fautive. */
function num(obj, path, key, { min = 0, max = Infinity, integer = false } = {}) {
  const value = obj?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`balance.json : ${path}.${key} manquant ou non numérique`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`balance.json : ${path}.${key} doit être entier`);
  }
  if (value < min || value > max) {
    throw new Error(`balance.json : ${path}.${key} hors bornes [${min}, ${max}]`);
  }
  return value;
}

function section(balance, key) {
  const raw = balance?.[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`balance.json : section \`${key}\` manquante`);
  }
  return raw;
}

/**
 * Valide et normalise les sections `battle`, `units`, `enemies` et `waves`.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {object} Config normalisée, consommée par `BattleModel` et `DeployQueue`
 */
export function parseBattleConfig(balance) {
  const rawBattle = section(balance, 'battle');
  const units = parseUnits(section(balance, 'units'));
  const enemies = parseEnemies(section(balance, 'enemies'));
  const waves = parseWaves(section(balance, 'waves'), enemies);

  return {
    tickMs: num(rawBattle, 'battle', 'tickMs', { min: 10, max: 500 }),
    maxTicksPerFrame: num(rawBattle, 'battle', 'maxTicksPerFrame', { min: 1, integer: true }),
    laneLength: num(rawBattle, 'battle', 'laneLength', { min: 1 }),
    /** Places de la file de déploiement (les « slots » du Lot 2 ont changé de rôle). */
    slotCount: num(rawBattle, 'battle', 'slotCount', { min: 1, integer: true }),
    /** Rythme de sortie : une unité quitte la file tous les `deployCooldownMs`. */
    deployCooldownMs: num(rawBattle, 'battle', 'deployCooldownMs', { min: 1 }),
    /** Garde-fou de performance : unités simultanées sur le champ de bataille. */
    maxFieldUnits: num(rawBattle, 'battle', 'maxFieldUnits', { min: 1, integer: true }),
    baseHp: num(rawBattle, 'battle', 'baseHp', { min: 1 }),
    maxSupportFireRateBonus: num(rawBattle, 'battle', 'maxSupportFireRateBonus', {
      min: 0,
      max: 0.95,
    }),
    unitTypePattern: parseTypePattern(rawBattle.unitTypePattern, units),
    units,
    enemies,
    waves,
  };
}

function parseTypePattern(pattern, units) {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    throw new Error('balance.json : battle.unitTypePattern doit être une liste non vide');
  }
  for (const type of pattern) {
    if (!units[type]) {
      throw new Error(`balance.json : battle.unitTypePattern référence un type inconnu « ${type} »`);
    }
  }
  return [...pattern];
}

function parseUnits(raw) {
  const types = Object.keys(raw);
  if (types.length === 0) throw new Error('balance.json : section `units` vide');

  const units = {};
  for (const id of types) {
    const def = raw[id];
    const path = `units.${id}`;
    if (!def || typeof def !== 'object') throw new Error(`balance.json : ${path} invalide`);
    if (!ROLE_KEYS[def.role]) {
      throw new Error(`balance.json : ${path}.role inconnu « ${def.role} »`);
    }
    if (typeof def.label !== 'string' || def.label.length === 0) {
      throw new Error(`balance.json : ${path}.label manquant`);
    }

    const unit = {
      id,
      label: def.label,
      role: def.role,
      hp: num(def, path, 'hp', { min: 1 }),
      /** Vitesse de marche, en unités de couloir par seconde. Ne dépend pas du tier. */
      speed: num(def, path, 'speed', { min: 1 }),
      damage: num(def, path, 'damage', { min: 0 }),
      // Une unité de soutien ne frappe pas : une cadence à 0 est légale pour elle seule,
      // et signifie « ne cherche jamais de cible à frapper ».
      fireRateMs: num(def, path, 'fireRateMs', { min: def.role === 'support' ? 0 : 1 }),
      // Portée d'attaque — et, pour tous les rôles, distance à laquelle l'unité **s'arrête**
      // de marcher face à un ennemi. Le soutien ne tire pas mais garde sa distance.
      range: num(def, path, 'range', { min: 1 }),
      tierScaling: parseTierScaling(def.tierScaling, path),
    };

    for (const key of ROLE_KEYS[def.role]) {
      unit[key] = num(def, path, key, {
        min: key === 'slowFactor' ? 0.05 : 1,
        max: key === 'slowFactor' ? 1 : Infinity,
      });
    }
    if (def.role === 'support') unit.buff = parseSupportBuff(def.buff, path);
    if (def.role !== 'support' && unit.fireRateMs <= 0) {
      throw new Error(`balance.json : ${path}.fireRateMs doit être > 0 pour un rôle offensif`);
    }

    units[id] = unit;
  }
  return units;
}

function parseTierScaling(raw, path) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`balance.json : ${path}.tierScaling manquant`);
  }
  const scaling = {};
  for (const key of TIER_SCALING_KEYS) {
    scaling[key] = num(raw, `${path}.tierScaling`, key, { min: 0.1, max: 4 });
  }
  return scaling;
}

function parseSupportBuff(raw, path) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`balance.json : ${path}.buff manquant`);
  }
  return {
    damage: num(raw, `${path}.buff`, 'damage', { min: 0, max: 10 }),
    fireRate: num(raw, `${path}.buff`, 'fireRate', { min: 0, max: 0.95 }),
  };
}

function parseEnemies(raw) {
  const types = Object.keys(raw);
  if (types.length === 0) throw new Error('balance.json : section `enemies` vide');

  const enemies = {};
  for (const id of types) {
    const def = raw[id];
    const path = `enemies.${id}`;
    if (!def || typeof def !== 'object') throw new Error(`balance.json : ${path} invalide`);
    if (typeof def.label !== 'string' || def.label.length === 0) {
      throw new Error(`balance.json : ${path}.label manquant`);
    }
    enemies[id] = {
      id,
      label: def.label,
      hp: num(def, path, 'hp', { min: 1 }),
      speed: num(def, path, 'speed', { min: 1 }),
      damageToBase: num(def, path, 'damageToBase', { min: 0 }),
      /** Dégâts infligés **aux unités** au contact (Lot 2.5 : le combat est mutuel). */
      damage: num(def, path, 'damage', { min: 0 }),
      attackRateMs: num(def, path, 'attackRateMs', { min: 1 }),
      attackRange: num(def, path, 'attackRange', { min: 1 }),
    };
  }
  return enemies;
}

function parseWaves(raw, enemies) {
  const scripted = raw.scripted;
  if (!Array.isArray(scripted) || scripted.length === 0) {
    throw new Error('balance.json : waves.scripted doit contenir au moins une vague');
  }

  const rawScaling = raw.scaling;
  if (!rawScaling || typeof rawScaling !== 'object') {
    throw new Error('balance.json : waves.scaling manquant');
  }

  return {
    firstWaveDelayMs: num(raw, 'waves', 'firstWaveDelayMs', { min: 0 }),
    interWavePauseMs: num(raw, 'waves', 'interWavePauseMs', { min: 0 }),
    spawnGapMs: num(raw, 'waves', 'spawnGapMs', { min: 1 }),
    scripted: scripted.map((entry, index) =>
      parseScriptedWave(entry, `waves.scripted[${index}]`, enemies)
    ),
    infinite: parseComposition(raw.infinite, 'waves.infinite', enemies),
    scaling: {
      hpPerWave: num(rawScaling, 'waves.scaling', 'hpPerWave', { min: 1, max: 3 }),
      speedPerWave: num(rawScaling, 'waves.scaling', 'speedPerWave', { min: 1, max: 3 }),
      damagePerWave: num(rawScaling, 'waves.scaling', 'damagePerWave', { min: 1, max: 3 }),
      countPerWave: num(rawScaling, 'waves.scaling', 'countPerWave', { min: 1, max: 3 }),
      spawnGapPerWave: num(rawScaling, 'waves.scaling', 'spawnGapPerWave', {
        min: 0.5,
        max: 1,
      }),
      minSpawnGapMs: num(rawScaling, 'waves.scaling', 'minSpawnGapMs', { min: 16 }),
      maxCountPerEntry: num(rawScaling, 'waves.scaling', 'maxCountPerEntry', {
        min: 1,
        integer: true,
      }),
    },
  };
}

/**
 * Une vague scriptée, sous l'une de ses deux formes :
 *
 *   - **liste** : la composition seule, cadence et libellé par défaut ;
 *   - **objet** `{ label, spawnGapMs, composition }` : la forme complète, qui permet de
 *     donner à chaque vague sa **texture**. C'est `spawnGapMs` qui fait la différence
 *     entre un rush (arrivées serrées) et un mur (arrivées espacées mais épaisses) — à
 *     nombre d'ennemis égal, ce ne sont pas les mêmes vagues du tout.
 *
 * L'override de cadence est **littéral** : il ne subit pas `spawnGapPerWave`, sinon une
 * texture réglée à la main dériverait avec le numéro de vague.
 */
function parseScriptedWave(raw, path, enemies) {
  if (Array.isArray(raw)) {
    return { label: '', spawnGapMs: null, composition: parseComposition(raw, path, enemies) };
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`balance.json : ${path} doit être une liste ou un objet de vague`);
  }
  if (raw.label !== undefined && typeof raw.label !== 'string') {
    throw new Error(`balance.json : ${path}.label doit être une chaîne`);
  }
  return {
    label: raw.label ?? '',
    spawnGapMs:
      raw.spawnGapMs === undefined ? null : num(raw, path, 'spawnGapMs', { min: 16 }),
    composition: parseComposition(raw.composition, `${path}.composition`, enemies),
  };
}

function parseComposition(raw, path, enemies) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`balance.json : ${path} doit être une liste non vide`);
  }
  return raw.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`balance.json : ${entryPath} invalide`);
    }
    if (!enemies[entry.type]) {
      throw new Error(`balance.json : ${entryPath}.type inconnu « ${entry.type} »`);
    }
    return { type: entry.type, count: num(entry, entryPath, 'count', { min: 1, integer: true }) };
  });
}

// --------------------------------------------------------------------- formules

/**
 * Stats effectives d'une unité, tier et auras de soutien comprises.
 *
 * @param {object} config Config normalisée
 * @param {string} type Id du type d'unité
 * @param {number} tier Tier de l'unité (1 -> maxTier)
 * @param {object} [options]
 * @param {number} [options.supportDamage] Bonus de dégâts cumulé des soutiens à portée (0.3 = +30 %)
 * @param {number} [options.supportFireRate] Bonus de cadence cumulé des soutiens à portée
 * @returns {{role: string, label: string, hp: number, speed: number, damage: number,
 *            fireRateMs: number, range: number, splashRadius: number, slowFactor: number,
 *            slowDurationMs: number, slowRadius: number, auraRadius: number}}
 */
export function unitStats(config, type, tier, options = {}) {
  const def = config.units[type];
  if (!def) throw new Error(`type d'unité inconnu « ${type} »`);

  const { supportDamage = 0, supportFireRate = 0 } = options;
  const steps = Math.max(0, tier - 1);

  const hpScale = def.tierScaling.hp ** steps;
  const damageScale = def.tierScaling.damage ** steps;
  const fireRateScale = def.tierScaling.fireRateMs ** steps;
  const rangeScale = def.tierScaling.range ** steps;
  const effectScale = def.tierScaling.effect ** steps;

  const fireRateBonus = Math.min(supportFireRate, config.maxSupportFireRateBonus);
  const fireRateMs =
    def.fireRateMs <= 0
      ? 0
      : // Jamais plus vite qu'un tick : le modèle ne saurait pas frapper deux fois dans le
        // même pas de temps, et la valeur mentirait sur les DPS réels.
        Math.max(config.tickMs, def.fireRateMs * fireRateScale * (1 - fireRateBonus));

  return {
    role: def.role,
    label: def.label,
    hp: def.hp * hpScale,
    speed: def.speed,
    damage: def.damage * damageScale * (1 + supportDamage),
    fireRateMs,
    range: def.range * rangeScale,
    splashRadius: def.role === 'aoe' ? def.splashRadius * effectScale : 0,
    slowFactor: def.role === 'slow' ? def.slowFactor : 1,
    slowDurationMs: def.role === 'slow' ? def.slowDurationMs * effectScale : 0,
    slowRadius: def.role === 'slow' ? def.slowRadius * effectScale : 0,
    auraRadius: def.role === 'support' ? def.auraRadius * rangeScale : 0,
  };
}

/**
 * PV maximum d'une unité — raccourci de `unitStats().hp`, appelé à la naissance.
 */
export function unitMaxHp(config, type, tier) {
  return unitStats(config, type, tier).hp;
}

/**
 * Bonus apportés par une unité de soutien à **chaque allié dans son aura**.
 *
 * @returns {{damage: number, fireRate: number}} fractions (0.3 = +30 %)
 */
export function supportBonus(config, type, tier) {
  const def = config.units[type];
  if (!def || def.role !== 'support') return { damage: 0, fireRate: 0 };

  const scale = def.tierScaling.effect ** Math.max(0, tier - 1);
  return { damage: def.buff.damage * scale, fireRate: def.buff.fireRate * scale };
}

/**
 * Stats d'un ennemi d'un type donné, à une vague donnée.
 *
 * `damageToBase` ne scale pas : la pression sur la base monte par les PV, la vitesse et le
 * nombre. Les dégâts **aux unités**, eux, suivent `damagePerWave` — sans quoi une unité de
 * haut tier deviendrait immortelle et le champ de bataille se figerait
 * (cf. `balance.schema.md`).
 *
 * @returns {{label: string, hp: number, speed: number, damageToBase: number,
 *            damage: number, attackRateMs: number, attackRange: number}}
 */
export function enemyStats(config, type, wave) {
  const def = config.enemies[type];
  if (!def) throw new Error(`type d'ennemi inconnu « ${type} »`);

  const steps = Math.max(0, wave - 1);
  const { hpPerWave, speedPerWave, damagePerWave } = config.waves.scaling;
  return {
    label: def.label,
    hp: Math.max(1, Math.round(def.hp * hpPerWave ** steps)),
    speed: def.speed * speedPerWave ** steps,
    damageToBase: def.damageToBase,
    damage: def.damage * damagePerWave ** steps,
    attackRateMs: def.attackRateMs,
    attackRange: def.attackRange,
  };
}

export default parseBattleConfig;

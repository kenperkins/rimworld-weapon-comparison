// Combat math, mirroring RimWorld's Verb/Projectile/ShotReport/ArmorUtility logic.

export const QUALITIES = ['Awful', 'Poor', 'Normal', 'Good', 'Excellent', 'Masterwork', 'Legendary'];

// Distances (cells) where each weapon accuracy stat applies; linear interpolation between.
export const ACCURACY_BANDS = { touch: 3, short: 12, medium: 25, long: 40 };

const DEFAULT_AP_PER_DAMAGE = 0.015;
const MIN_HIT_CHANCE = 0.0201;
const TICKS_PER_SECOND = 60;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function evalCurve(points, x) {
  if (!points?.length) return 1;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points.at(-1)[1];
}

// Matches StatWorker ordering: (base + comp offsets) × comp factors, then StatParts (quality).
function modded(stat, base, mods) {
  return (base + (mods?.statOffsets?.[stat] ?? 0)) * (mods?.statFactors?.[stat] ?? 1);
}

export const MAX_TRAITS = 3;

export function combineTraits(traits) {
  const mods = { statFactors: {}, statOffsets: {}, burstShotCountMultiplier: 1, burstShotSpeedMultiplier: 1, additionalStoppingPower: 0, extraDamages: [], notes: [] };
  for (const t of traits) {
    for (const [k, v] of Object.entries(t.statFactors ?? {})) mods.statFactors[k] = (mods.statFactors[k] ?? 1) * v;
    for (const [k, v] of Object.entries(t.statOffsets ?? {})) mods.statOffsets[k] = (mods.statOffsets[k] ?? 0) + v;
    mods.burstShotCountMultiplier *= t.burstShotCountMultiplier ?? 1;
    mods.burstShotSpeedMultiplier *= t.burstShotSpeedMultiplier ?? 1;
    mods.additionalStoppingPower += t.additionalStoppingPower ?? 0;
    if (t.damageDefOverride) mods.damageDefOverride = t.damageDefOverride;
    mods.extraDamages.push(...(t.extraDamages ?? []));
  }
  return mods;
}

// Trait effects the DPS model doesn't capture, as short human-readable notes.
export function unmodeledTraitEffects(trait) {
  const notes = [];
  if (trait.ability) notes.push('adds a reloadable ability');
  if (trait.damageDefOverride === 'Bullet_TraitTox') notes.push('adds toxic buildup on hit');
  if (trait.damageDefOverride === 'Bullet_TraitIncendiary') notes.push('may ignite targets');
  if (trait.damageDefOverride === 'Nerve') notes.push('nerve damage can stun');
  for (const e of trait.extraDamages ?? []) notes.push(`+${e.amount} ${e.def} damage per hit`);
  if (trait.ignoresAccuracyMaluses) notes.push('ignores weather/smoke accuracy penalties');
  return notes;
}

export function compatibleTraits(data, weapon, chosen) {
  if (!weapon.uniqueCategories) return [];
  const chosenDefs = new Set(chosen);
  const blocked = new Set(data.weaponTraits.filter((t) => chosenDefs.has(t.defName)).flatMap((t) => t.exclusionTags ?? []));
  return data.weaponTraits.filter((t) => !chosenDefs.has(t.defName)
    && weapon.uniqueCategories.includes(t.weaponCategory)
    && !(t.exclusionTags ?? []).some((tag) => blocked.has(tag)));
}

function qualityFactor(data, stat, quality, weapon) {
  if (!weapon.hasQuality) return 1;
  return data.quality[stat]?.[quality] ?? 1;
}

/**
 * Fraction of damage that gets through a single armor layer, in expectation.
 * Roll r ∈ [0,1): r < eff/2 → deflected; r < eff → halved; otherwise full.
 */
export function armorDamageFactor(armorRating, armorPenetration) {
  const eff = Math.max(0, armorRating - armorPenetration);
  const pDeflect = clamp(eff / 2, 0, 1);
  const pHalf = clamp(eff, 0, 1) - pDeflect;
  const pFull = 1 - pDeflect - pHalf;
  return pFull + 0.5 * pHalf;
}

export function weaponHitFactor(acc, dist) {
  const { touch, short, medium, long } = ACCURACY_BANDS;
  let v;
  if (dist <= touch) v = acc.touch;
  else if (dist <= short) v = lerp(acc.touch, acc.short, (dist - touch) / (short - touch));
  else if (dist <= medium) v = lerp(acc.short, acc.medium, (dist - short) / (medium - short));
  else if (dist <= long) v = lerp(acc.medium, acc.long, (dist - medium) / (long - medium));
  else v = acc.long;
  return clamp(v, 0.01, 1);
}

export function shooterAccuracy(data, shootingSkill) {
  return evalCurve(data.pawnCurves.ShootingAccuracyPawn, shootingSkill);
}

export function computeRanged(data, weapon, opts) {
  const r = weapon.ranged;
  if (!r) return null;
  const { quality = 'Normal', mods, armor = {} } = opts;

  const proj = r.projectile;
  const baseDamageDef = proj?.damageDef ?? r.beamDamageDef;
  const damageDefName = mods?.damageDefOverride ?? baseDamageDef;
  const dd = data.damageDefs[damageDefName] ?? data.damageDefs[baseDamageDef] ?? {};
  const armorCategory = dd.armorCategory ?? null;

  const baseDamage = proj?.damage ?? data.damageDefs[baseDamageDef]?.defaultDamage ?? 0;
  const dmgMult = modded('RangedWeapon_DamageMultiplier', weapon.rangedDamageMultiplierBase ?? 1, mods)
    * qualityFactor(data, 'RangedWeapon_DamageMultiplier', quality, weapon);
  const damage = baseDamage * dmgMult;

  let baseAP = proj?.armorPenetration ?? dd.defaultArmorPenetration ?? baseDamage * DEFAULT_AP_PER_DAMAGE;
  if (!armorCategory) baseAP = 0;
  const armorPenetration = baseAP * modded('RangedWeapon_ArmorPenetrationMultiplier', 1, mods)
    * qualityFactor(data, 'RangedWeapon_ArmorPenetrationMultiplier', quality, weapon);

  const accQ = qualityFactor(data, 'AccuracyTouch', quality, weapon);
  const accuracy = {};
  for (const band of Object.keys(ACCURACY_BANDS)) {
    const stat = `Accuracy${band[0].toUpperCase()}${band.slice(1)}`;
    accuracy[band] = clamp(modded(stat, r.accuracy[band], mods) * accQ, 0.01, 1);
  }

  const warmup = r.warmupTime * modded('RangedWeapon_WarmupMultiplier', 1, mods);
  const cooldown = modded('RangedWeapon_Cooldown', r.cooldown, mods);
  const burst = Math.max(1, Math.round(r.burstShotCount * (mods?.burstShotCountMultiplier ?? 1)));
  const burstGap = r.ticksBetweenBurstShots / TICKS_PER_SECOND / (mods?.burstShotSpeedMultiplier ?? 1);
  const range = r.range * modded('RangedWeapon_RangeMultiplier', 1, mods);
  const cycleTime = warmup + (burst - 1) * burstGap + cooldown;

  const nonLethal = !armorCategory || damage <= 0 || damage >= 9999;
  const explosive = !!proj?.explosionRadius;
  const rawDps = nonLethal ? 0 : (damage * burst) / cycleTime;
  const armorRating = armorCategory ? armor[armorCategory] ?? 0 : 0;
  const armorFactor = armorDamageFactor(armorRating, armorPenetration);

  const pawnAcc = shooterAccuracy(data, opts.shootingSkill ?? 10);
  const hitChance = (dist) => {
    if (dist > range || dist < (r.minRange ?? 0)) return 0;
    if (explosive) return 1;
    return clamp(weaponHitFactor(accuracy, dist) * Math.pow(pawnAcc, dist), MIN_HIT_CHANCE, 1);
  };
  const expectedDps = (dist) => rawDps * hitChance(dist) * armorFactor;

  return {
    damageDef: damageDefName,
    damageLabel: dd.label ?? damageDefName,
    armorCategory,
    damage,
    armorPenetration,
    stoppingPower: (proj?.stoppingPower ?? dd.defaultStoppingPower ?? 0.5) + (mods?.additionalStoppingPower ?? 0),
    explosionRadius: proj?.explosionRadius,
    explosive,
    nonLethal,
    beam: !!r.beamDamageDef,
    singleUse: !!weapon.singleUse,
    burst,
    burstGap,
    warmup,
    cooldown,
    cycleTime,
    range,
    minRange: r.minRange,
    forcedMissRadius: r.forcedMissRadius,
    accuracy,
    pawnAccuracy: pawnAcc,
    damagePerBurst: damage * burst,
    rawDps,
    armorFactor,
    hitChance,
    expectedDps,
  };
}

function meleeVerbs(data, weapon, opts) {
  const { quality = 'Normal', mods } = opts;
  const stuff = weapon.stuffCategories?.length ? data.stuffs.find((s) => s.defName === opts.stuff) : null;
  const qMult = modded('MeleeWeapon_DamageMultiplier', weapon.meleeDamageMultiplierBase ?? 1, mods)
    * qualityFactor(data, 'MeleeWeapon_DamageMultiplier', quality, weapon);
  const cdMult = modded('MeleeWeapon_CooldownMultiplier', stuff?.meleeCooldown ?? 1, mods);

  const verbs = [];
  for (const tool of weapon.tools ?? []) {
    for (const [i, cap] of tool.capacities.entries()) {
      const damageDef = tool.damageDefs?.[i] ?? cap;
      const armorCategory = data.damageDefs[damageDef]?.armorCategory ?? 'Blunt';
      const stuffMult = !stuff ? 1 : armorCategory === 'Sharp' ? stuff.sharp : armorCategory === 'Blunt' ? stuff.blunt : 1;
      const damage = tool.power * qMult * stuffMult;
      // Assumption: explicit tool AP scales with the same quality/material multiplier as damage.
      const armorPenetration = tool.armorPenetration >= 0 ? tool.armorPenetration * qMult * stuffMult : damage * DEFAULT_AP_PER_DAMAGE;
      const cooldown = tool.cooldownTime * cdMult;
      verbs.push({
        label: tool.label, capacity: cap, damageDef, armorCategory, damage, armorPenetration, cooldown,
        chanceFactor: tool.chanceFactor ?? 1,
      });
    }
  }
  return verbs;
}

// Verse.VerbUtility: verbs within 95% of the best "initial weight" share 75% of picks,
// verbs between 25% and 95% share the remaining 25%, and anything below 25% is never used.
function assignSelectionWeights(verbs) {
  for (const v of verbs) v.initialWeight = (v.damage * (1 + v.armorPenetration) * v.chanceFactor) / v.cooldown;
  const best = Math.max(...verbs.map((v) => v.initialWeight));
  for (const v of verbs) v.category = v.initialWeight >= best * 0.95 ? 'best' : v.initialWeight < best * 0.25 ? 'worst' : 'mid';
  const counts = { best: 0, mid: 0, worst: 0 };
  for (const v of verbs) counts[v.category]++;
  const share = { best: 0.75, mid: counts.mid ? 0.25 : 0, worst: 0 };
  if (!counts.mid) share.best = 1;
  for (const v of verbs) v.selectionChance = v.category === 'worst' ? 0 : share[v.category] / counts[v.category];
  return verbs;
}

export function computeMelee(data, weapon, opts) {
  const verbs = meleeVerbs(data, weapon, opts);
  if (!verbs.length) return null;
  assignSelectionWeights(verbs);

  const armor = opts.armor ?? {};
  let wDamage = 0, wCooldown = 0, wAP = 0, wArmoredDamage = 0;
  for (const v of verbs) {
    v.armorFactor = armorDamageFactor(armor[v.armorCategory] ?? 0, v.armorPenetration);
    wDamage += v.selectionChance * v.damage;
    wCooldown += v.selectionChance * v.cooldown;
    wAP += v.selectionChance * v.armorPenetration;
    wArmoredDamage += v.selectionChance * v.damage * v.armorFactor;
  }
  const hitChance = evalCurve(data.pawnCurves.MeleeHitChance, opts.meleeSkill ?? 10);
  const rawDps = wDamage / wCooldown;
  return {
    verbs,
    averageDamage: wDamage,
    averageCooldown: wCooldown,
    armorPenetration: wAP,
    rawDps,
    hitChance,
    armorFactor: wDamage ? wArmoredDamage / wDamage : 1,
    expectedDps: (wArmoredDamage / wCooldown) * hitChance,
  };
}

export function computeWeapon(data, weapon, opts = {}) {
  if (opts.traits?.length && !opts.mods) {
    const traits = opts.traits.map((d) => data.weaponTraits.find((t) => t.defName === d)).filter(Boolean);
    opts = { ...opts, mods: combineTraits(traits) };
  }
  return {
    weapon,
    mass: weapon.mass == null ? undefined : modded('Mass', weapon.mass, opts.mods),
    ranged: computeRanged(data, weapon, opts),
    melee: computeMelee(data, weapon, opts),
  };
}

export function defaultStuff(data, weapon) {
  if (!weapon.stuffCategories?.length) return null;
  const allowed = data.stuffs.filter((s) => s.categories?.some((c) => weapon.stuffCategories.includes(c)));
  return (allowed.find((s) => s.defName === 'Steel') ?? allowed[0])?.defName ?? null;
}

export function stuffsFor(data, weapon) {
  if (!weapon.stuffCategories?.length) return [];
  return data.stuffs.filter((s) => s.categories?.some((c) => weapon.stuffCategories.includes(c)));
}

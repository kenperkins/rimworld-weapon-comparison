#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseXml } from '../public/xml.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const OUT = path.join(DATA_DIR, 'gamedata.json');
const DESCRIPTIONS_OUT = path.join(DATA_DIR, 'descriptions.json');

const CANDIDATE_DATA_DIRS = [
  path.join(os.homedir(), 'Library/Application Support/Steam/steamapps/common/RimWorld/RimWorldMac.app/Data'),
  path.join(os.homedir(), '.steam/steam/steamapps/common/RimWorld/Data'),
  path.join(os.homedir(), '.local/share/Steam/steamapps/common/RimWorld/Data'),
  'C:/Program Files (x86)/Steam/steamapps/common/RimWorld/Data',
];

const MOD_ORDER = ['Core', 'Royalty', 'Ideology', 'Biotech', 'Anomaly', 'Odyssey'];

function findDataDir() {
  const explicit = process.argv[2] ?? process.env.RIMWORLD_DATA;
  if (explicit) return explicit;
  const found = CANDIDATE_DATA_DIRS.find((d) => fs.existsSync(path.join(d, 'Core', 'Defs')));
  if (!found) {
    console.error('Could not find RimWorld Data dir. Pass it as an argument or set RIMWORLD_DATA.');
    process.exit(1);
  }
  return found;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.xml') ? [p] : [];
  });
}

// ---------- XML inheritance (mirrors Verse.XmlInheritance) ----------

const clone = (n) => ({ name: n.name, attrs: { ...n.attrs }, text: n.text, children: n.children.map(clone) });

function mergeInto(child, current) {
  Object.assign(current.attrs, child.attrs);
  if (child.attrs.Inherit === 'False') {
    current.children = child.children.map(clone);
    current.text = child.text;
    return;
  }
  if (child.children.length === 0) {
    current.children = [];
    current.text = child.text;
    return;
  }
  if (child.children[0].name === 'li') {
    current.children.push(...child.children.map(clone));
    return;
  }
  for (const c of child.children) {
    const idx = current.children.findIndex((x) => x.name === c.name);
    if (c.attrs.IsNull === 'True') {
      if (idx !== -1) current.children.splice(idx, 1);
    } else if (idx === -1) {
      current.children.push(clone(c));
    } else {
      mergeInto(c, current.children[idx]);
    }
  }
}

function loadDefs(dataDir) {
  const mods = fs.readdirSync(dataDir)
    .filter((m) => fs.existsSync(path.join(dataDir, m, 'Defs')))
    .sort((a, b) => (MOD_ORDER.indexOf(a) + 1 || 99) - (MOD_ORDER.indexOf(b) + 1 || 99));

  const raw = [];
  for (const mod of mods) {
    for (const file of walk(path.join(dataDir, mod, 'Defs'))) {
      let doc;
      try {
        doc = parseXml(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        console.warn(`skip ${path.relative(dataDir, file)}: ${err.message}`);
        continue;
      }
      const defsNode = doc.children.find((c) => c.name === 'Defs');
      for (const node of defsNode?.children ?? []) raw.push({ node, mod });
    }
  }

  const named = new Map();
  for (const d of raw) if (d.node.attrs.Name) named.set(`${d.node.name}:${d.node.attrs.Name}`, d);

  const resolved = new Map();
  const missingParents = new Set();
  function resolve(d) {
    if (resolved.has(d)) return resolved.get(d);
    const parentKey = d.node.attrs.ParentName && `${d.node.name}:${d.node.attrs.ParentName}`;
    const parent = parentKey && named.get(parentKey);
    let result;
    if (parent) {
      result = clone(resolve(parent));
      delete result.attrs.Abstract;
      delete result.attrs.Name;
      mergeInto(d.node, result);
      if (!d.node.attrs.Abstract) delete result.attrs.Abstract;
    } else {
      if (parentKey) missingParents.add(parentKey);
      result = clone(d.node);
    }
    resolved.set(d, result);
    return result;
  }

  const byType = {};
  for (const d of raw) {
    const node = resolve(d);
    if (node.attrs.Abstract === 'True') continue;
    const defName = text(node, 'defName');
    if (!defName) continue;
    (byType[node.name] ??= new Map()).set(defName, { node, mod: d.mod });
  }
  if (missingParents.size) console.warn(`${missingParents.size} parent defs not found (likely from DLCs not installed); those children were used as-is.`);
  return { byType, mods };
}

// ---------- accessors ----------

function child(node, p) {
  let cur = node;
  for (const part of p.split('.')) {
    cur = cur?.children.find((c) => c.name === part);
    if (!cur) return undefined;
  }
  return cur;
}
function text(node, p) {
  const n = child(node, p);
  return n ? n.text.trim() : undefined;
}
function num(node, p) {
  const t = text(node, p);
  return t === undefined || t === '' ? undefined : Number(t);
}
function bool(node, p) {
  const t = text(node, p);
  return t === undefined ? undefined : t.toLowerCase() === 'true';
}
function list(node, p) {
  return (child(node, p)?.children ?? []).filter((c) => c.name === 'li').map((c) => c.text.trim());
}
function dict(node, p) {
  const out = {};
  for (const c of child(node, p)?.children ?? []) out[c.name] = Number(c.text.trim());
  return out;
}
function curve(node, p) {
  return list(node, `${p}.points`).map((s) => s.replace(/[()]/g, '').split(',').map(Number));
}
const isEmpty = (v) => v === undefined || (Array.isArray(v) ? !v.length : typeof v === 'object' && v !== null && !Object.keys(v).length);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !isEmpty(v)));

// ---------- extraction ----------

function qualityFactors(statNode) {
  const part = (child(statNode, 'parts')?.children ?? []).find((li) => li.attrs.Class === 'StatPart_Quality');
  if (!part) return undefined;
  const q = {};
  for (const level of ['Awful', 'Poor', 'Normal', 'Good', 'Excellent', 'Masterwork', 'Legendary']) {
    q[level] = num(part, `factor${level}`);
  }
  return q;
}

function extractDamageDefs(byType) {
  const out = {};
  for (const [defName, { node }] of byType.DamageDef ?? []) {
    out[defName] = compact({
      label: text(node, 'label'),
      armorCategory: text(node, 'armorCategory'),
      defaultDamage: num(node, 'defaultDamage'),
      defaultArmorPenetration: num(node, 'defaultArmorPenetration'),
      defaultStoppingPower: num(node, 'defaultStoppingPower'),
      isExplosive: bool(node, 'isExplosive'),
    });
  }
  return out;
}

function extractProjectile(node) {
  const p = child(node, 'projectile');
  if (!p) return undefined;
  return compact({
    defName: text(node, 'defName'),
    label: text(node, 'label'),
    damageDef: text(p, 'damageDef'),
    damage: num(p, 'damageAmountBase'),
    armorPenetration: num(p, 'armorPenetrationBase'),
    stoppingPower: num(p, 'stoppingPower'),
    speed: num(p, 'speed'),
    explosionRadius: num(p, 'explosionRadius'),
    explosionDelay: num(p, 'explosionDelay'),
    numExtraHitCells: num(p, 'numExtraHitCells'),
    extraDamages: (child(p, 'extraDamages')?.children ?? []).map((li) => compact({
      def: text(li, 'def'), amount: num(li, 'amount'), chance: num(li, 'chance'), armorPenetration: num(li, 'armorPenetration'),
    })),
  });
}

function extractTools(node, maneuvers) {
  return (child(node, 'tools')?.children ?? []).map((li) => compact({
    label: text(li, 'label'),
    capacities: list(li, 'capacities'),
    damageDefs: list(li, 'capacities').map((c) => maneuvers[c]).filter(Boolean),
    power: num(li, 'power'),
    cooldownTime: num(li, 'cooldownTime'),
    armorPenetration: num(li, 'armorPenetration'),
    chanceFactor: num(li, 'chanceFactor'),
    extraMeleeDamages: (child(li, 'extraMeleeDamages')?.children ?? []).map((e) => compact({
      def: text(e, 'def'), amount: num(e, 'amount'), chance: num(e, 'chance'), armorPenetration: num(e, 'armorPenetration'),
    })),
  }));
}

const RANGED_VERB = /Shoot|Launch|Spray|Spew|Beam|Arc/;
const WEAPON_CATEGORY = /^(Weapons|Grenades$)/;

function extractWeapons(byType, maneuvers) {
  const things = byType.ThingDef;
  const weapons = [];
  for (const [defName, { node, mod }] of things) {
    if (text(node, 'equipmentType') !== 'Primary' || text(node, 'category') !== 'Item') continue;
    const verbs = (child(node, 'verbs')?.children ?? []).filter((v) => RANGED_VERB.test(text(v, 'verbClass') ?? ''));
    const tools = extractTools(node, maneuvers);
    if (!verbs.length && !tools.length) continue;

    const thingCategories = list(node, 'thingCategories');
    const isImprovised = thingCategories.includes('ItemsMisc') && tools.length;
    if (!thingCategories.some((c) => WEAPON_CATEGORY.test(c)) && !isImprovised) continue;

    const verb = verbs.find((v) => bool(v, 'hasStandardCommand')) ?? verbs[0];
    const stats = dict(node, 'statBases');
    const projName = verb && text(verb, 'defaultProjectile');
    const projNode = projName && things.get(projName)?.node;
    const comps = child(node, 'comps')?.children ?? [];
    const weaponTags = list(node, 'weaponTags');
    const tradeTags = list(node, 'tradeTags');
    const costList = Object.keys(dict(node, 'costList')).length ? dict(node, 'costList') : undefined;
    const hasQuality = comps.some((c) => text(c, 'compClass') === 'CompQuality');

    let ranged;
    if (verb) {
      ranged = compact({
        verbClass: text(verb, 'verbClass'),
        warmupTime: num(verb, 'warmupTime') ?? 0,
        range: num(verb, 'range'),
        minRange: num(verb, 'minRange'),
        burstShotCount: num(verb, 'burstShotCount') ?? 1,
        ticksBetweenBurstShots: num(verb, 'ticksBetweenBurstShots') ?? 15,
        forcedMissRadius: num(verb, 'forcedMissRadius'),
        beamDamageDef: text(verb, 'beamDamageDef'),
        beamWidth: num(verb, 'beamWidth'),
        consumeFuelPerShot: num(verb, 'consumeFuelPerShot'),
        projectile: projNode ? extractProjectile(projNode) : undefined,
        cooldown: stats.RangedWeapon_Cooldown ?? 1,
        accuracy: {
          touch: stats.AccuracyTouch ?? 1,
          short: stats.AccuracyShort ?? 1,
          medium: stats.AccuracyMedium ?? 1,
          long: stats.AccuracyLong ?? 1,
        },
      });
    }

    const uniqueComp = comps.find((c) => c.attrs.Class === 'CompProperties_UniqueWeapon');
    const reload = comps.find((c) => /Reloadable|ApparelReloadable|EquippableAbilityReloadable/.test(c.attrs.Class ?? ''));

    weapons.push(compact({
      defName,
      label: text(node, 'label'),
      description: text(node, 'description'),
      source: mod,
      techLevel: text(node, 'techLevel'),
      kind: ranged ? 'ranged' : 'melee',
      categories: thingCategories,
      weaponTags,
      weaponClasses: list(node, 'weaponClasses'),
      unique: thingCategories.includes('WeaponsUnique') || undefined,
      uniqueCategories: uniqueComp ? list(uniqueComp, 'weaponCategories') : undefined,
      improvised: isImprovised || undefined,
      hasQuality: hasQuality || undefined,
      mechOnly: !(hasQuality || isImprovised || costList || tradeTags.length || thingCategories.includes('Grenades')) || undefined,
      singleUse: (ranged && /OneUse/.test(ranged.verbClass)) || undefined,
      stuffCategories: list(node, 'stuffCategories'),
      costStuffCount: num(node, 'costStuffCount'),
      costList,
      researchPrerequisite: text(node, 'recipeMaker.researchPrerequisite'),
      mass: stats.Mass,
      marketValue: stats.MarketValue,
      workToMake: stats.WorkToMake,
      maxHitPoints: stats.MaxHitPoints,
      meleeDamageMultiplierBase: stats.MeleeWeapon_DamageMultiplier,
      rangedDamageMultiplierBase: stats.RangedWeapon_DamageMultiplier,
      equippedStatOffsets: Object.keys(dict(node, 'equippedStatOffsets')).length ? dict(node, 'equippedStatOffsets') : undefined,
      reloadable: reload ? compact({ maxCharges: num(reload, 'maxCharges'), ammoDef: text(reload, 'ammoDef') }) : undefined,
      ranged,
      tools,
    }));
  }
  return weapons.sort((a, b) => a.label.localeCompare(b.label));
}

function extractStuffs(byType) {
  const stuffs = [];
  for (const [defName, { node, mod }] of byType.ThingDef) {
    const sp = child(node, 'stuffProps');
    if (!sp) continue;
    const stats = dict(node, 'statBases');
    const factors = dict(sp, 'statFactors');
    stuffs.push(compact({
      defName,
      label: text(node, 'label'),
      source: mod,
      categories: list(sp, 'categories'),
      sharp: stats.SharpDamageMultiplier ?? 1,
      blunt: stats.BluntDamageMultiplier ?? 1,
      meleeCooldown: factors.MeleeWeapon_CooldownMultiplier ?? stats.MeleeWeapon_CooldownMultiplier ?? 1,
      marketValue: stats.MarketValue,
      commonality: num(sp, 'commonality'),
    }));
  }
  return stuffs.sort((a, b) => a.label.localeCompare(b.label));
}

function extractArmorPresets(byType) {
  const presets = [];
  for (const [defName, { node, mod }] of byType.ThingDef) {
    const ap = child(node, 'apparel');
    if (!ap || !list(ap, 'bodyPartGroups').includes('Torso')) continue;
    if (child(node, 'stuffCategories')) continue;
    const s = dict(node, 'statBases');
    if (!(s.ArmorRating_Sharp >= 0.4)) continue;
    presets.push({ defName, label: text(node, 'label'), source: mod, sharp: s.ArmorRating_Sharp, blunt: s.ArmorRating_Blunt ?? 0, heat: s.ArmorRating_Heat ?? 0 });
  }
  return presets.sort((a, b) => a.sharp - b.sharp);
}

function extractTraits(byType) {
  return [...(byType.WeaponTraitDef ?? [])].map(([defName, { node, mod }]) => compact({
    defName,
    label: text(node, 'label'),
    description: text(node, 'description'),
    source: mod,
    weaponCategory: text(node, 'weaponCategory'),
    statFactors: dict(node, 'statFactors'),
    statOffsets: dict(node, 'statOffsets'),
    equippedStatOffsets: dict(node, 'equippedStatOffsets'),
    damageDefOverride: text(node, 'damageDefOverride'),
    extraDamages: (child(node, 'extraDamages')?.children ?? []).map((li) => compact({ def: text(li, 'def'), amount: num(li, 'amount'), chance: num(li, 'chance') })),
    burstShotCountMultiplier: num(node, 'burstShotCountMultiplier'),
    burstShotSpeedMultiplier: num(node, 'burstShotSpeedMultiplier'),
    additionalStoppingPower: num(node, 'additionalStoppingPower'),
    ignoresAccuracyMaluses: bool(node, 'ignoresAccuracyMaluses'),
    canGenerateAlone: bool(node, 'canGenerateAlone'),
    ability: text(node, 'abilityProps.abilityDef'),
    exclusionTags: list(node, 'exclusionTags'),
  }));
}

function main() {
  const dataDir = findDataDir();
  const { byType, mods } = loadDefs(dataDir);

  const maneuvers = {};
  for (const [, { node }] of byType.ManeuverDef ?? []) {
    const cap = text(node, 'requiredCapacity');
    maneuvers[cap] ??= text(node, 'verb.meleeDamageDef');
  }

  const armorCategories = {};
  for (const [defName, { node }] of byType.DamageArmorCategoryDef ?? []) {
    armorCategories[defName] = { multStat: text(node, 'multStat'), armorRatingStat: text(node, 'armorRatingStat') };
  }

  const statDefs = byType.StatDef;
  const quality = {};
  for (const s of ['MeleeWeapon_DamageMultiplier', 'RangedWeapon_DamageMultiplier', 'RangedWeapon_ArmorPenetrationMultiplier', 'AccuracyTouch']) {
    quality[s] = qualityFactors(statDefs.get(s).node);
  }

  const pawnCurves = {};
  for (const s of ['ShootingAccuracyPawn', 'MeleeHitChance', 'MeleeDodgeChance']) {
    const n = statDefs.get(s)?.node;
    if (n) pawnCurves[s] = curve(n, 'postProcessCurve');
  }

  let version;
  for (const f of ['Version.txt', '../Version.txt']) {
    const p = path.join(dataDir, '..', f);
    if (fs.existsSync(p)) version = fs.readFileSync(p, 'utf8').trim();
  }

  const out = {
    generatedAt: new Date().toISOString(),
    gameVersion: version,
    mods,
    quality,
    pawnCurves,
    armorCategories,
    damageDefs: extractDamageDefs(byType),
    weapons: extractWeapons(byType, maneuvers),
    stuffs: extractStuffs(byType),
    armorPresets: extractArmorPresets(byType),
    weaponTraits: extractTraits(byType),
  };

  // Ludeon's prose goes to a gitignored file so the committed data is stats only.
  const descriptions = { weapons: {}, weaponTraits: {} };
  for (const key of Object.keys(descriptions)) {
    for (const d of out[key]) {
      if (d.description) descriptions[key][d.defName] = d.description;
      delete d.description;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  fs.writeFileSync(DESCRIPTIONS_OUT, JSON.stringify(descriptions, null, 1));
  console.log(`RimWorld ${version ?? '?'} [${mods.join(', ')}]: ${out.weapons.length} weapons, ${out.stuffs.length} stuffs, ${out.weaponTraits.length} traits -> ${path.relative(process.cwd(), OUT)}`);
}

main();

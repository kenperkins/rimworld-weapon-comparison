import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeWeapon, armorDamageFactor, weaponHitFactor, evalCurve, compatibleTraits } from '../public/calc.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/gamedata.json', import.meta.url)));
const weapon = (defName) => data.weapons.find((w) => w.defName === defName);
const close = (actual, expected, eps = 0.01) => assert.ok(Math.abs(actual - expected) < eps, `${actual} !≈ ${expected}`);

test('assault rifle raw DPS: 3×11 dmg over 1.0 warmup + 2 burst gaps + 1.7 cooldown', () => {
  const r = computeWeapon(data, weapon('Gun_AssaultRifle')).ranged;
  close(r.cycleTime, 1.0 + 2 * (10 / 60) + 1.7);
  close(r.rawDps, 33 / r.cycleTime);
  close(r.armorPenetration, 11 * 0.015);
});

test('legendary ranged quality multiplies damage and accuracy (capped at 100%)', () => {
  const normal = computeWeapon(data, weapon('Gun_SniperRifle'), { quality: 'Normal' }).ranged;
  const legendary = computeWeapon(data, weapon('Gun_SniperRifle'), { quality: 'Legendary' }).ranged;
  close(legendary.damage, normal.damage * 1.5);
  assert.ok(legendary.accuracy.long <= 1);
  close(legendary.accuracy.short, Math.min(1, normal.accuracy.short * 1.5));
});

test('steel longsword melee: point/edge are best verbs (75%), handle is mid (25%)', () => {
  const m = computeWeapon(data, weapon('MeleeWeapon_LongSword'), { stuff: 'Steel' }).melee;
  const byLabel = Object.fromEntries(m.verbs.map((v) => [v.label, v]));
  close(byLabel.point.selectionChance, 0.375);
  close(byLabel.edge.selectionChance, 0.375);
  close(byLabel.handle.selectionChance, 0.25);
  close(m.rawDps, (0.75 * 23 + 0.25 * 9) / (0.75 * 2.6 + 0.25 * 2));
});

test('wood weakens sharp attacks; plasteel shortens cooldown', () => {
  const wood = computeWeapon(data, weapon('MeleeWeapon_LongSword'), { stuff: 'WoodLog' }).melee;
  const plasteel = computeWeapon(data, weapon('MeleeWeapon_LongSword'), { stuff: 'Plasteel' }).melee;
  close(wood.verbs.find((v) => v.label === 'edge').damage, 23 * 0.4);
  close(plasteel.verbs.find((v) => v.label === 'edge').cooldown, 2.6 * 0.8);
});

test('armor: AP ≥ armor means full damage; 100% eff armor → 25% expected', () => {
  close(armorDamageFactor(0.5, 0.6), 1);
  close(armorDamageFactor(1, 0), 0.25);
  close(armorDamageFactor(2, 0), 0);
});

test('accuracy interpolates between bands', () => {
  const acc = { touch: 0.8, short: 0.6, medium: 0.4, long: 0.2 };
  close(weaponHitFactor(acc, 2), 0.8);
  close(weaponHitFactor(acc, 7.5), 0.7);
  close(weaponHitFactor(acc, 50), 0.2);
});

test('shooting accuracy curve', () => {
  close(evalCurve(data.pawnCurves.ShootingAccuracyPawn, 10), 0.97);
  close(evalCurve(data.pawnCurves.ShootingAccuracyPawn, 11), 0.9725);
});

test('trait mods apply as stat factors', () => {
  const quick = data.weaponTraits.find((t) => t.defName === 'QuickReload');
  const base = computeWeapon(data, weapon('Gun_Revolver_Unique')).ranged;
  const modded = computeWeapon(data, weapon('Gun_Revolver_Unique'), { mods: quick }).ranged;
  close(modded.cooldown, base.cooldown * 0.8);
});

test('trait offsets apply before quality: legendary heavy rounds = (1 + 0.1) × 1.5 damage', () => {
  const r = computeWeapon(data, weapon('Gun_HeavySMG_Unique'), { quality: 'Legendary', traits: ['OversizedRounds'] }).ranged;
  close(r.damage, 12 * 1.1 * 1.5);
  close(r.stoppingPower, 0.5 + 2);
});

test('burst traits: extended magazine ×1.5 shots, rapid fire halves the gap', () => {
  const base = computeWeapon(data, weapon('Gun_LMG_Unique')).ranged;
  const mod = computeWeapon(data, weapon('Gun_LMG_Unique'), { traits: ['ExtendedMagazine', 'RapidFire'] }).ranged;
  assert.equal(mod.burst, Math.round(base.burst * 1.5));
  close(mod.burstGap, base.burstGap / 2);
});

test('compatible traits respect weapon categories and exclusion tags', () => {
  const smg = weapon('Gun_HeavySMG_Unique');
  const all = compatibleTraits(data, smg, []).map((t) => t.defName);
  assert.ok(all.includes('OversizedRounds'));
  assert.ok(!all.includes('PiercingArrows'));
  const afterAmmo = compatibleTraits(data, smg, ['HollowPointRounds']).map((t) => t.defName);
  assert.ok(!afterAmmo.includes('PiercingRounds'), 'AmmoType tag excludes a second ammo trait');
  assert.ok(afterAmmo.includes('RapidFire'));
});

import { scanUniqueWeapons } from './savescan.js';
import { QUALITIES, MAX_TRAITS, computeWeapon, defaultStuff, stuffsFor, compatibleTraits, unmodeledTraitEffects } from './calc.js';

const $ = (sel, root = document) => root.querySelector(sel);
const SIDES = ['a', 'b'];
const DEFAULTS = { a: 'Gun_AssaultRifle', b: 'Gun_ChargeRifle' };

const fmt = {
  n1: (v) => v.toFixed(1),
  n2: (v) => v.toFixed(2),
  pct: (v) => `${Math.round(v * 100)}%`,
  pct1: (v) => `${(v * 100).toFixed(1)}%`,
  s: (v) => `${v.toFixed(2)} s`,
  cells: (v) => `${v.toFixed(1)} cells`,
  kg: (v) => `${v.toFixed(2)} kg`,
  int: (v) => Math.round(v).toLocaleString(),
};

let data;
const state = {
  a: { weapon: null, quality: 'Normal', stuff: null, traits: [], name: null },
  b: { weapon: null, quality: 'Normal', stuff: null, traits: [], name: null },
  shootingSkill: 10,
  meleeSkill: 10,
  distance: 12,
  armor: { Sharp: 0, Blunt: 0, Heat: 0 },
  showMech: false,
  showUnique: false,
};

// ---------- URL state ----------

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const s of SIDES) {
    if (p.has(s)) state[s].weapon = p.get(s);
    if (p.has(`${s}q`)) state[s].quality = p.get(`${s}q`);
    if (p.has(`${s}m`)) state[s].stuff = p.get(`${s}m`);
    if (p.has(`${s}t`)) state[s].traits = p.get(`${s}t`).split(',').filter(Boolean);
    if (p.has(`${s}n`)) state[s].name = p.get(`${s}n`);
  }
  for (const k of ['shootingSkill', 'meleeSkill', 'distance']) if (p.has(k)) state[k] = Number(p.get(k));
  for (const k of ['Sharp', 'Blunt', 'Heat']) if (p.has(k)) state.armor[k] = Number(p.get(k)) / 100;
  state.showMech = p.get('mech') === '1';
  state.showUnique = p.get('unique') === '1';
}

function writeHash() {
  const p = new URLSearchParams();
  for (const s of SIDES) {
    p.set(s, state[s].weapon);
    if (state[s].quality !== 'Normal') p.set(`${s}q`, state[s].quality);
    if (state[s].stuff) p.set(`${s}m`, state[s].stuff);
    if (state[s].traits.length) p.set(`${s}t`, state[s].traits.join(','));
    if (state[s].name) p.set(`${s}n`, state[s].name);
  }
  p.set('shootingSkill', state.shootingSkill);
  p.set('meleeSkill', state.meleeSkill);
  p.set('distance', state.distance);
  for (const k of ['Sharp', 'Blunt', 'Heat']) if (state.armor[k]) p.set(k, Math.round(state.armor[k] * 100));
  if (state.showMech) p.set('mech', '1');
  if (state.showUnique) p.set('unique', '1');
  history.replaceState(null, '', `#${p}`);
}

// ---------- pickers ----------

const weaponByDef = (defName) => data.weapons.find((w) => w.defName === defName);
const traitByDef = (defName) => data.weaponTraits.find((t) => t.defName === defName);

function groupOf(w) {
  if (w.unique) return 'Unique weapon bases';
  if (w.mechOnly) return 'Mechanoid & turret';
  if (w.improvised) return 'Improvised';
  if (w.categories?.includes('Grenades') || w.singleUse) return 'Grenades & single-use';
  return w.kind === 'ranged' ? 'Ranged' : 'Melee';
}
const GROUP_ORDER = ['Ranged', 'Melee', 'Grenades & single-use', 'Improvised', 'Mechanoid & turret', 'Unique weapon bases'];

function visibleWeapons() {
  return data.weapons.filter((w) => (state.showMech || !w.mechOnly) && (state.showUnique || !w.unique));
}

function populateWeaponSelects() {
  const weapons = visibleWeapons();
  const labelCounts = {};
  for (const w of weapons) labelCounts[w.label] = (labelCounts[w.label] ?? 0) + 1;
  const groups = Object.groupBy(weapons, groupOf);

  for (const s of SIDES) {
    const sel = $(`.picker[data-side="${s}"] .weapon`);
    if (!weapons.some((w) => w.defName === state[s].weapon)) state[s].weapon = weapons[0].defName;
    sel.replaceChildren(...GROUP_ORDER.filter((g) => groups[g]).map((g) => {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const w of groups[g]) {
        const label = labelCounts[w.label] > 1 ? `${w.label} (${w.defName})` : w.label;
        og.append(new Option(capitalize(label), w.defName, false, w.defName === state[s].weapon));
      }
      return og;
    }));
  }
}

function populateSideOptions(s) {
  const root = $(`.picker[data-side="${s}"]`);
  const w = weaponByDef(state[s].weapon);

  const qWrap = $('.quality-wrap', root);
  qWrap.hidden = !w.hasQuality;
  const pills = $('.quality-pills', root);
  if (!pills.childElementCount) {
    pills.append(...QUALITIES.map((q) => el('label', { className: 'pill' },
      el('input', { type: 'radio', name: pills.dataset.name, value: q }),
      el('span', { textContent: q }))));
  }
  for (const input of pills.querySelectorAll('input')) input.checked = input.value === state[s].quality;

  const stuffs = stuffsFor(data, w);
  const sWrap = $('.stuff-wrap', root);
  sWrap.hidden = !stuffs.length;
  if (!stuffs.some((st) => st.defName === state[s].stuff)) state[s].stuff = defaultStuff(data, w);
  $('.stuff', root).replaceChildren(...stuffs.map((st) => new Option(capitalize(st.label), st.defName, false, st.defName === state[s].stuff)));

  const badges = [w.source, w.techLevel, w.kind === 'ranged' ? 'Ranged' : 'Melee'];
  if (w.mechOnly) badges.push('Not colonist-craftable');
  if (w.unique) badges.push('Unique base stats');
  if (w.singleUse) badges.push('Single use');
  if (w.researchPrerequisite) badges.push(`Research: ${w.researchPrerequisite}`);
  renderTraitEditor(s, root, w);
  const nameEl = $('.weapon-name', root);
  nameEl.hidden = !state[s].name;
  nameEl.textContent = state[s].name ? `“${state[s].name}”` : '';
  $('.badges', root).replaceChildren(...badges.filter(Boolean).map((b) => Object.assign(document.createElement('span'), { className: 'badge', textContent: b })));
  $('.desc', root).textContent = w.description ?? '';
}

function renderTraitEditor(s, root, w) {
  const wrap = $('.traits-wrap', root);
  wrap.hidden = !w.unique;
  if (!w.unique) return;

  const chosen = state[s].traits.map(traitByDef).filter(Boolean);
  $('.traits-count', root).textContent = `${chosen.length} / ${MAX_TRAITS}`;
  $('.trait-chips', root).replaceChildren(...(chosen.length ? chosen.map((t) => {
    const { modeled, unmodeled } = traitEffects(t);
    return el('li', { title: t.description },
      el('div', { className: 'trait-head' },
        el('strong', { textContent: capitalize(t.label) }),
        el('button', { type: 'button', textContent: '×', title: `Remove ${t.label}`, onclick: () => editSide(s, { traits: state[s].traits.filter((d) => d !== t.defName) }) })),
      modeled.length ? el('span', { className: 'trait-effect', textContent: modeled.join(', ') }) : '',
      ...unmodeled.map((n) => el('span', { className: 'trait-effect unmodeled', textContent: `${capitalize(n)} (not in DPS)` })));
  }) : [el('li', { className: 'empty', textContent: 'No traits' })]));

  const addSel = $('.trait-add', root);
  const options = compatibleTraits(data, w, state[s].traits);
  addSel.disabled = chosen.length >= MAX_TRAITS || !options.length;
  addSel.replaceChildren(
    new Option(chosen.length >= MAX_TRAITS ? 'Max traits reached' : '+ Add trait…', ''),
    ...options.map((t) => new Option(`${capitalize(t.label)} — ${traitSummary(t)}`, t.defName)),
  );
}

const STAT_SHORT = {
  RangedWeapon_DamageMultiplier: 'damage', RangedWeapon_ArmorPenetrationMultiplier: 'AP', RangedWeapon_RangeMultiplier: 'range',
  RangedWeapon_WarmupMultiplier: 'aim time', RangedWeapon_Cooldown: 'cooldown', Mass: 'mass',
  AccuracyTouch: 'acc. touch', AccuracyShort: 'acc. short', AccuracyMedium: 'acc. medium', AccuracyLong: 'acc. long',
};

function traitSummary(t) {
  const { modeled, unmodeled } = traitEffects(t);
  return [...modeled, ...unmodeled].join(', ') || 'no stat effects';
}

function traitEffects(t) {
  const parts = [];
  const acc = ['AccuracyTouch', 'AccuracyShort', 'AccuracyMedium', 'AccuracyLong'];
  const f = { ...t.statFactors };
  if (acc.every((k) => f[k] != null && f[k] === f.AccuracyTouch)) {
    parts.push(`${signedPct(f.AccuracyTouch - 1)} accuracy`);
    acc.forEach((k) => delete f[k]);
  }
  for (const [k, v] of Object.entries(f)) if (STAT_SHORT[k]) parts.push(`${signedPct(v - 1)} ${STAT_SHORT[k]}`);
  for (const [k, v] of Object.entries(t.statOffsets ?? {})) if (STAT_SHORT[k]) parts.push(`${signedPct(v)} ${STAT_SHORT[k]}`);
  if (t.burstShotCountMultiplier) parts.push(`×${t.burstShotCountMultiplier} burst`);
  if (t.burstShotSpeedMultiplier) parts.push(`×${t.burstShotSpeedMultiplier} burst speed`);
  if (t.additionalStoppingPower) parts.push(`+${t.additionalStoppingPower} stopping power`);
  if (t.statFactors?.MarketValue) parts.push(`×${t.statFactors.MarketValue} market value`);
  if (t.statOffsets?.Beauty) parts.push(`${t.statOffsets.Beauty > 0 ? '+' : '−'}${Math.abs(t.statOffsets.Beauty)} beauty`);
  return { modeled: parts, unmodeled: unmodeledTraitEffects(t) };
}
const signedPct = (v) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

// Any manual edit means the side no longer represents the exact weapon imported from a save.
function editSide(s, patch) {
  Object.assign(state[s], patch, { name: null });
  const w = weaponByDef(state[s].weapon);
  state[s].traits = w.unique ? state[s].traits.filter((d) => {
    const others = state[s].traits.filter((x) => x !== d);
    return compatibleTraits(data, w, others).some((t) => t.defName === d);
  }) : [];
  render();
}

function populateArmorPresets() {
  const sel = $('#armorPreset');
  const opts = [new Option('Custom', 'custom'), new Option('No armor', 'none')];
  for (const p of data.armorPresets) {
    opts.push(new Option(`${capitalize(p.label)} (S ${Math.round(p.sharp * 100)}% / B ${Math.round(p.blunt * 100)}%)`, p.defName));
  }
  sel.replaceChildren(...opts);
  syncArmorPreset();
}

function syncArmorPreset() {
  const { Sharp, Blunt, Heat } = state.armor;
  const match = !Sharp && !Blunt && !Heat ? 'none'
    : data.armorPresets.find((p) => near(p.sharp, Sharp) && near(p.blunt, Blunt) && near(p.heat, Heat))?.defName;
  $('#armorPreset').value = match ?? 'custom';
}
const near = (a, b) => Math.abs(a - b) < 0.005;

// ---------- comparison model ----------

const ROWS = [
  { section: 'Ranged', when: (r) => r.ranged },
  { label: 'Expected DPS @ distance', get: (r) => r.ranged?.expectedDps(state.distance), fmt: fmt.n2, better: 'high', hint: () => `${state.distance} cells` },
  { label: 'Raw DPS (all hit, no armor)', get: (r) => r.ranged?.rawDps, fmt: fmt.n2, better: 'high' },
  { label: 'Hit chance @ distance', get: (r) => r.ranged?.hitChance(state.distance), fmt: fmt.pct1, better: 'high' },
  { label: 'Damage per shot', get: (r) => r.ranged?.damage, fmt: fmt.n1, better: 'high', extra: (r) => r.ranged?.damageLabel },
  { label: 'Shots per burst', get: (r) => r.ranged?.burst, fmt: fmt.int, better: null },
  { label: 'Damage per burst', get: (r) => r.ranged?.damagePerBurst, fmt: fmt.n1, better: 'high' },
  { label: 'Armor penetration', get: (r) => r.ranged?.armorPenetration, fmt: fmt.pct, better: 'high' },
  { label: 'Damage through armor', get: (r) => r.ranged?.armorFactor, fmt: fmt.pct, better: 'high' },
  { label: 'Stopping power', get: (r) => r.ranged?.stoppingPower, fmt: fmt.n1, better: 'high' },
  { label: 'Range', get: (r) => r.ranged?.range, fmt: fmt.cells, better: 'high' },
  { label: 'Minimum range', get: (r) => r.ranged?.minRange, fmt: fmt.cells, better: 'low' },
  { label: 'Aim time (warmup)', get: (r) => r.ranged?.warmup, fmt: fmt.s, better: 'low' },
  { label: 'Cooldown', get: (r) => r.ranged?.cooldown, fmt: fmt.s, better: 'low' },
  { label: 'Full cycle time', get: (r) => r.ranged?.cycleTime, fmt: fmt.s, better: 'low' },
  { label: 'Accuracy (touch, ≤3)', get: (r) => r.ranged?.accuracy.touch, fmt: fmt.pct, better: 'high' },
  { label: 'Accuracy (short, 12)', get: (r) => r.ranged?.accuracy.short, fmt: fmt.pct, better: 'high' },
  { label: 'Accuracy (medium, 25)', get: (r) => r.ranged?.accuracy.medium, fmt: fmt.pct, better: 'high' },
  { label: 'Accuracy (long, 40+)', get: (r) => r.ranged?.accuracy.long, fmt: fmt.pct, better: 'high' },
  { label: 'Explosion radius', get: (r) => r.ranged?.explosionRadius, fmt: fmt.n1, better: 'high' },
  { label: 'Forced miss radius', get: (r) => r.ranged?.forcedMissRadius, fmt: fmt.n1, better: 'low' },

  { section: 'Melee', when: (r) => r.melee },
  { label: 'Expected melee DPS', get: (r) => r.melee?.expectedDps, fmt: fmt.n2, better: 'high', hint: () => `skill ${state.meleeSkill}` },
  { label: 'Melee DPS (all hit, no armor)', get: (r) => r.melee?.rawDps, fmt: fmt.n2, better: 'high' },
  { label: 'Average damage per hit', get: (r) => r.melee?.averageDamage, fmt: fmt.n1, better: 'high' },
  { label: 'Average cooldown', get: (r) => r.melee?.averageCooldown, fmt: fmt.s, better: 'low' },
  { label: 'Average armor penetration', get: (r) => r.melee?.armorPenetration, fmt: fmt.pct, better: 'high' },
  { label: 'Damage through armor', get: (r) => r.melee?.armorFactor, fmt: fmt.pct, better: 'high' },
  { label: 'Melee hit chance', get: (r) => r.melee?.hitChance, fmt: fmt.pct, better: null },

  { section: 'General', when: () => true },
  { label: 'Traits', text: (r, s) => state[s].traits.map((d) => capitalize(traitByDef(d)?.label ?? d)).join(', ') || '—', when: () => SIDES.some((s) => state[s].traits.length) },
  { label: 'Mass', get: (r) => r.mass, fmt: fmt.kg, better: 'low' },
  { label: 'Work to make', get: (r) => r.weapon.workToMake, fmt: fmt.int, better: 'low' },
  { label: 'Cost', text: (r) => costText(r.weapon) },
];

function costText(w) {
  const parts = [];
  if (w.costStuffCount) parts.push(`${w.costStuffCount} material`);
  for (const [k, v] of Object.entries(w.costList ?? {})) parts.push(`${v} ${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`);
  return parts.join(', ') || '—';
}

function sideLabels() {
  const [a, b] = SIDES.map((s) => ({ ...state[s], w: weaponByDef(state[s].weapon) }));
  const title = (x) => x.name ?? capitalize(x.w.label);
  if (title(a) !== title(b)) return { a: title(a), b: title(b) };

  const stuffLabel = (x) => data.stuffs.find((st) => st.defName === x.stuff)?.label;
  const traitText = (x) => x.traits.map((d) => traitByDef(d)?.label).filter(Boolean).join(' + ') || 'no traits';
  const sameTraits = a.traits.join() === b.traits.join();
  const parts = (x) => [
    a.w.hasQuality && a.quality !== b.quality ? x.quality : null,
    a.stuff !== b.stuff ? stuffLabel(x) : null,
    !sameTraits ? traitText(x) : null,
  ].filter(Boolean).join(', ');
  if (!parts(a)) return { a: 'A', b: 'B' };
  return { a: capitalize(parts(a).toLowerCase()), b: capitalize(parts(b).toLowerCase()) };
}

function compute(s) {
  const w = weaponByDef(state[s].weapon);
  return computeWeapon(data, w, {
    quality: state[s].quality,
    stuff: state[s].stuff,
    traits: state[s].traits,
    shootingSkill: state.shootingSkill,
    meleeSkill: state.meleeSkill,
    armor: state.armor,
  });
}

// ---------- render ----------

function renderTable(res) {
  const tbody = $('#compare tbody');
  const rows = [];
  let sectionVisible = true;
  for (const row of ROWS) {
    if (row.section) {
      sectionVisible = SIDES.some((s) => row.when(res[s]));
      if (sectionVisible) rows.push(el('tr', { className: 'section' }, el('th', { colSpan: 3, scope: 'colgroup', textContent: row.section })));
      continue;
    }
    if (!sectionVisible) continue;

    const th = el('th', { scope: 'row', textContent: row.label });
    if (row.hint) th.append(el('span', { className: 'hint', textContent: row.hint() }));

    if (row.when && !row.when()) continue;
    if (row.text) {
      rows.push(el('tr', {}, th, ...SIDES.map((s) => el('td', { textContent: row.text(res[s], s) }))));
      continue;
    }
    const vals = SIDES.map((s) => row.get(res[s]));
    if (vals.every((v) => v == null)) continue;
    const winner = pickWinner(vals, row.better);
    rows.push(el('tr', {}, th, ...SIDES.map((s, i) => {
      const v = vals[i];
      const td = el('td', { className: v == null ? 'na' : winner === i ? `win-${s}` : '' });
      td.textContent = v == null ? '—' : row.fmt(v);
      const extra = row.extra?.(res[s]);
      if (v != null && extra) td.append(el('span', { className: 'hint', textContent: extra }));
      return td;
    })));
  }
  tbody.replaceChildren(...rows);
}

function pickWinner([a, b], better) {
  if (!better || a == null || b == null || Math.abs(a - b) < 1e-9) return -1;
  return (better === 'high') === (a > b) ? 0 : 1;
}

function renderHeadline(res, names) {
  const tiles = [];
  const anyRanged = SIDES.some((s) => res[s].ranged && !res[s].ranged.nonLethal);
  if (anyRanged) {
    tiles.push(tile(`Expected DPS at ${state.distance} cells`, SIDES.map((s) => res[s].ranged?.expectedDps(state.distance)), fmt.n2, names));
    tiles.push(tile('Raw ranged DPS', SIDES.map((s) => res[s].ranged?.rawDps), fmt.n2, names));
  }
  tiles.push(tile('Expected melee DPS', SIDES.map((s) => res[s].melee?.expectedDps), fmt.n2, names));
  $('#headline').replaceChildren(...tiles);
}

function tile(label, [a, b], f, names) {
  let verdict = '';
  if (a != null && b != null && Math.abs(a - b) > 1e-9) {
    const [hi, lo, side] = a > b ? [a, b, names.a] : [b, a, names.b];
    verdict = lo > 0 ? `${side} is ${Math.round((hi / lo - 1) * 100)}% higher` : `Only ${side} deals damage`;
  } else if (a != null && b != null) {
    verdict = 'Even';
  }
  const value = (s, v) => el('div', { className: 'v-wrap' },
    el('span', { className: `v ${s}`, textContent: v == null ? '—' : f(v) }),
    el('span', { className: 'v-name', textContent: names[s], title: names[s] }));
  return el('div', { className: 'stat-tile' },
    el('span', { className: 'label', textContent: label }),
    el('div', { className: 'values' }, value('a', a), value('b', b)),
    el('span', { className: 'verdict', textContent: verdict }));
}

function renderTableHeader(names) {
  $('#compare th.col-a').textContent = names.a;
  $('#compare th.col-b').textContent = names.b;
}

function renderMeleeBreakdown(res, names) {
  const blocks = SIDES.map((s) => {
    const m = res[s].melee;
    const head = el('h3', {}, el('span', { className: 'swatch', style: `background: var(--series-${s})` }), names[s]);
    if (!m) return el('div', {}, head, el('p', { className: 'desc', textContent: 'No melee attacks.' }));
    const rows = m.verbs.map((v) => el('tr', { className: v.selectionChance ? '' : 'unused' },
      el('td', { textContent: `${v.label} (${v.damageDef.toLowerCase()})` }),
      el('td', { textContent: fmt.n1(v.damage) }),
      el('td', { textContent: fmt.pct(v.armorPenetration) }),
      el('td', { textContent: fmt.s(v.cooldown) }),
      el('td', { textContent: v.selectionChance ? fmt.pct(v.selectionChance) : 'never' })));
    return el('div', {}, head, el('table', {},
      el('thead', {}, el('tr', {}, ...['Attack', 'Dmg', 'AP', 'Cooldown', 'Used'].map((t) => el('th', { textContent: t })))),
      el('tbody', {}, ...rows)));
  });
  $('#meleeBreakdown').replaceChildren(...blocks);
}

// ---------- chart ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...children) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...children);
  return n;
};

let chartModel = null;

function renderChart(res, names) {
  const card = $('#chartCard');
  const series = SIDES
    .filter((s) => res[s].ranged && !res[s].ranged.nonLethal)
    .map((s) => ({ side: s, r: res[s].ranged, label: names[s] }));
  card.hidden = !series.length;
  $('#tooltip').hidden = true;
  chartModel = null;
  if (!series.length) return;

  $('#legend').replaceChildren(...series.map((sr) => el('span', {},
    el('i', { style: `background: var(--series-${sr.side})` }), sr.label)));

  const svg = $('#chart');
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 300;
  const m = { top: 12, right: 16, bottom: 34, left: 44 };
  const maxX = Math.max(10, ...series.map((sr) => Math.ceil(sr.r.range)));
  const step = 0.25;
  for (const sr of series) {
    sr.points = [];
    for (let d = 1; d <= sr.r.range + 1e-9; d += step) sr.points.push([d, sr.r.expectedDps(d)]);
  }
  const maxY = niceCeil(Math.max(0.5, ...series.flatMap((sr) => sr.points.map((p) => p[1]))) * 1.08);
  const x = (d) => m.left + ((d - 0) / maxX) * (width - m.left - m.right);
  const y = (v) => height - m.bottom - (v / maxY) * (height - m.top - m.bottom);

  const grid = svgEl('g', { class: 'grid' });
  const axis = svgEl('g', { class: 'axis' });
  for (const t of ticks(maxY, 5)) {
    grid.append(svgEl('line', { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }));
    axis.append(svgEl('text', { x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end' }, fmtTick(t)));
  }
  for (const t of ticks(maxX, Math.min(9, Math.floor(width / 70)))) {
    axis.append(svgEl('text', { x: x(t), y: height - m.bottom + 16, 'text-anchor': 'middle' }, String(t)));
  }
  axis.append(svgEl('text', { class: 'axis-title', x: width - m.right, y: height - 4, 'text-anchor': 'end' }, 'distance (cells)'));

  const distMarker = svgEl('line', { class: 'marker-distance', x1: x(state.distance), x2: x(state.distance), y1: m.top, y2: height - m.bottom });
  const lines = series.map((sr) => svgEl('path', {
    class: 'line',
    stroke: `var(--series-${sr.side})`,
    d: sr.points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''),
  }));
  const crosshair = svgEl('line', { class: 'crosshair', y1: m.top, y2: height - m.bottom, visibility: 'hidden' });
  const dots = series.map((sr) => svgEl('circle', { class: 'dot', r: 5, fill: `var(--series-${sr.side})`, visibility: 'hidden' }));

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren(grid, axis, distMarker, ...lines, crosshair, ...dots);
  chartModel = { series, x, y, m, width, height, maxX, crosshair, dots };
}

function onChartMove(ev) {
  if (!chartModel) return;
  const { series, x, m, width, maxX, crosshair, dots } = chartModel;
  const svg = $('#chart');
  const rect = svg.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const d = Math.round(Math.min(maxX, Math.max(1, ((px - m.left) / (width - m.left - m.right)) * maxX)) * 2) / 2;
  crosshair.setAttribute('x1', x(d));
  crosshair.setAttribute('x2', x(d));
  crosshair.setAttribute('visibility', 'visible');

  const tip = $('#tooltip');
  const rows = [el('div', { className: 'title', textContent: `${d} cells` })];
  series.forEach((sr, i) => {
    const v = sr.r.expectedDps(d);
    const inRange = d <= sr.r.range && d >= (sr.r.minRange ?? 0);
    dots[i].setAttribute('visibility', inRange ? 'visible' : 'hidden');
    dots[i].setAttribute('cx', x(d));
    dots[i].setAttribute('cy', chartModel.y(v));
    rows.push(el('div', { className: 'row' },
      el('span', {}, el('i', { style: `background: var(--series-${sr.side})` }), sr.label),
      el('strong', { textContent: inRange ? `${fmt.n2(v)} dps · ${fmt.pct(sr.r.hitChance(d))} hit` : 'out of range' })));
  });
  tip.replaceChildren(...rows);
  tip.hidden = false;
  const tipW = tip.offsetWidth;
  const left = px + 14 + tipW > rect.width ? px - 14 - tipW : px + 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${m.top}px`;
}

function onChartLeave() {
  if (!chartModel) return;
  chartModel.crosshair.setAttribute('visibility', 'hidden');
  chartModel.dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
  $('#tooltip').hidden = true;
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((c) => c >= v);
}
function ticks(max, count) {
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const stepSize = [1, 2, 2.5, 5, 10].map((k) => k * p).find((c) => c >= raw);
  const out = [];
  for (let t = 0; t <= max + 1e-9; t += stepSize) out.push(+t.toFixed(6));
  return out;
}
const fmtTick = (t) => (Number.isInteger(t) ? String(t) : t.toFixed(1));

// ---------- glue ----------

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') n.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...children);
  return n;
}
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function render() {
  for (const s of SIDES) populateSideOptions(s);
  const res = { a: compute('a'), b: compute('b') };
  const names = sideLabels();
  renderHeadline(res, names);
  renderChart(res, names);
  renderTableHeader(names);
  renderTable(res);
  renderMeleeBreakdown(res, names);
  $('#shootingSkillOut').textContent = state.shootingSkill;
  $('#meleeSkillOut').textContent = state.meleeSkill;
  $('#distanceOut').textContent = `${state.distance} cells`;
  writeHash();
}

function bind() {
  for (const s of SIDES) {
    const root = $(`.picker[data-side="${s}"]`);
    $('.weapon', root).addEventListener('change', (e) => editSide(s, { weapon: e.target.value }));
    $('.quality-pills', root).addEventListener('change', (e) => editSide(s, { quality: e.target.value }));
    $('.stuff', root).addEventListener('change', (e) => editSide(s, { stuff: e.target.value }));
    $('.trait-add', root).addEventListener('change', (e) => {
      if (e.target.value) editSide(s, { traits: [...state[s].traits, e.target.value] });
    });
  }
  for (const k of ['shootingSkill', 'meleeSkill', 'distance']) {
    $(`#${k}`).addEventListener('input', (e) => { state[k] = Number(e.target.value); render(); });
  }
  for (const k of ['Sharp', 'Blunt', 'Heat']) {
    $(`#armor${k}`).addEventListener('input', (e) => {
      state.armor[k] = Math.max(0, Number(e.target.value) || 0) / 100;
      syncArmorPreset();
      render();
    });
  }
  $('#armorPreset').addEventListener('change', (e) => {
    const p = data.armorPresets.find((x) => x.defName === e.target.value);
    if (e.target.value === 'none') state.armor = { Sharp: 0, Blunt: 0, Heat: 0 };
    else if (p) state.armor = { Sharp: p.sharp, Blunt: p.blunt, Heat: p.heat };
    else return;
    syncArmorInputs();
    render();
  });
  $('#showMech').addEventListener('change', (e) => { state.showMech = e.target.checked; populateWeaponSelects(); render(); });
  $('#showUnique').addEventListener('change', (e) => { state.showUnique = e.target.checked; populateWeaponSelects(); render(); });

  const svg = $('#chart');
  svg.addEventListener('pointermove', onChartMove);
  svg.addEventListener('pointerleave', onChartLeave);
  new ResizeObserver(() => render()).observe($('#chartWrap'));
  $('#saveFile').addEventListener('change', (e) => loadServerSave(e.target.value));
  $('#copySaveDir').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#saveDirPath').textContent);
      e.target.textContent = 'Copied';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    } catch {}
  });
  $('#savePick').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadLocalSave(file);
    e.target.value = '';
  });
}

function syncArmorInputs() {
  for (const k of ['Sharp', 'Blunt', 'Heat']) $(`#armor${k}`).value = Math.round(state.armor[k] * 100);
}

// ---------- save import ----------

const LOCATION_TEXT = { equipped: 'equipped by', 'in inventory': 'carried by' };

const SAVE_DIRS = {
  mac: '~/Library/Application Support/RimWorld/Saves',
  windows: '%USERPROFILE%\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Saves',
  linux: '~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Saves',
};

async function initSaveImport() {
  try {
    const resp = await fetch('api/saves');
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error);
    if (!body.saves.length) throw new Error(`no saves in ${body.dir}`);
    $('#saveFolder').hidden = false;
    $('#saveFile').replaceChildren(...body.saves.map((sv) => new Option(`${sv.file.replace(/\.rws$/, '')} — ${relativeTime(sv.mtime)}`, sv.file)));
    await loadServerSave(body.saves[0].file);
  } catch {
    // No save folder on this host (e.g. running in the cluster): browser file picking only.
    // A remembered showDirectoryPicker() handle isn't an option: Chrome refuses every default
    // save location (~/Library, AppData, ~/.config) as "system files".
    $('#saveSummary').textContent = 'choose a save file';
    $('#saveStatus').textContent = 'The save is read in your browser and never uploaded.';
    const platform = (navigator.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
    const os = platform.includes('mac') ? 'mac' : platform.includes('win') ? 'windows' : 'linux';
    $('#saveDirPath').textContent = SAVE_DIRS[os];
    $('#saveHintMac').hidden = os !== 'mac';
    $('#saveHint').hidden = false;
  }
}

async function loadServerSave(file) {
  $('#saveStatus').textContent = 'Scanning save…';
  $('#saveList').replaceChildren();
  const resp = await fetch(`api/saves/uniques?file=${encodeURIComponent(file)}`);
  const body = await resp.json();
  if (!resp.ok) {
    $('#saveStatus').textContent = body.error;
    return;
  }
  renderSaveList(body.weapons, file);
}

async function loadLocalSave(file) {
  $('#saveStatus').textContent = `Scanning ${file.name}…`;
  $('#saveList').replaceChildren();
  const uniqueDefs = new Set(data.weapons.filter((w) => w.unique).map((w) => w.defName));
  try {
    renderSaveList(scanUniqueWeapons(await file.text(), uniqueDefs), file.name);
  } catch (err) {
    $('#saveStatus').textContent = `Couldn't read ${file.name}: ${err.message}`;
  }
}

function renderSaveList(weapons, file) {
  const n = weapons.length;
  $('#saveSummary').textContent = `${n} found in ${file.replace(/\.rws$/, '')}`;
  $('#saveStatus').textContent = n ? '' : 'No unique weapons in this save.';
  $('#saveList').replaceChildren(...weapons.map((uw) => {
    const w = weaponByDef(uw.def);
    const traits = uw.traits.map((d) => {
      const t = traitByDef(d);
      return t ? `${capitalize(t.label)} (${traitSummary(t)})` : d;
    }).join('; ') || 'no traits';
    const where = LOCATION_TEXT[uw.location] && uw.holder ? `${LOCATION_TEXT[uw.location]} ${uw.holder}` : uw.location;
    return el('li', { className: 'save-item' },
      el('div', { className: 'who' },
        el('strong', { textContent: uw.name ?? capitalize(w?.label ?? uw.def) }),
        el('span', { textContent: `${uw.quality} ${w?.label ?? uw.def} · ${traits}` }),
        el('span', { textContent: capitalize(where) })),
      el('div', { className: 'actions' }, ...SIDES.map((s) => el('button', {
        type: 'button', className: 'to-side', dataset: { side: s }, textContent: `Compare as ${s.toUpperCase()}`,
        onclick: () => importToSide(s, uw),
      }))));
  }));
}

function importToSide(s, uw) {
  if (!weaponByDef(uw.def)) return;
  state[s] = { weapon: uw.def, quality: uw.quality, stuff: null, traits: uw.traits.filter(traitByDef), name: uw.name ?? null };
  if (!state.showUnique) {
    state.showUnique = true;
    $('#showUnique').checked = true;
  }
  populateWeaponSelects();
  render();
  $(`.picker[data-side="${s}"]`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

async function main() {
  const resp = await fetch('data/gamedata.json');
  if (!resp.ok) {
    document.body.textContent = await resp.text();
    return;
  }
  data = await resp.json();
  try {
    const desc = await (await fetch('data/descriptions.json')).json();
    for (const key of ['weapons', 'weaponTraits']) for (const d of data[key]) d.description = desc[key]?.[d.defName];
  } catch {}
  $('#meta').textContent = `RimWorld ${data.gameVersion ?? ''} · ${data.mods.join(' + ')} · ${data.weapons.length} weapons`;

  state.a.weapon = DEFAULTS.a;
  state.b.weapon = DEFAULTS.b;
  readHash();
  for (const s of SIDES) {
    const w = weaponByDef(state[s].weapon);
    if (w?.mechOnly) state.showMech = true;
    if (w?.unique) state.showUnique = true;
  }

  $('#shootingSkill').value = state.shootingSkill;
  $('#meleeSkill').value = state.meleeSkill;
  $('#distance').value = state.distance;
  $('#showMech').checked = state.showMech;
  $('#showUnique').checked = state.showUnique;
  syncArmorInputs();
  populateArmorPresets();
  populateWeaponSelects();
  bind();
  render();
  initSaveImport();
}

main();

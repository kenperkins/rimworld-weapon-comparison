// Finds Odyssey unique weapons in RimWorld save XML. Runs in both Node and the browser.
import { parseXml } from './xml.js';

// Given the index of a `<def>` that is the first child of a saved Thing, return the
// [start, end) range of that Thing's element by walking to its matching close tag.
function enclosingElement(src, defIdx) {
  const start = src.lastIndexOf('<', defIdx - 1);
  const name = /^<([\w.]+)/.exec(src.slice(start, start + 64))?.[1];
  if (!name) return null;
  const re = new RegExp(`<(/?)${name}(?=[\\s>/])[^>]*?(/?)>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(src));) {
    if (m[2]) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [start, re.lastIndex];
  }
  return null;
}

function locationOf(src, start) {
  const before = src.slice(Math.max(0, start - 400), start);
  const container = [...before.matchAll(/<(equipment|inventory|innerContainer|things|stock|thingsToSell|carryTracker)\b/g)].at(-1)?.[1];
  const location = { equipment: 'equipped', inventory: 'in inventory', carryTracker: 'being carried', things: 'on map', stock: 'trader stock', thingsToSell: 'trader stock' }[container] ?? 'stored';
  let holder;
  if (location === 'equipped' || location === 'in inventory') {
    const nameIdx = src.lastIndexOf('<name Class="NameTriple">', start);
    if (nameIdx !== -1) {
      const block = src.slice(nameIdx, src.indexOf('</name>', nameIdx));
      holder = /<nick>([^<]*)<\/nick>/.exec(block)?.[1] || /<first>([^<]*)<\/first>/.exec(block)?.[1];
    }
  }
  return { location, holder };
}

const childText = (node, name) => node.children.find((c) => c.name === name)?.text.trim();

export function scanUniqueWeapons(src, uniqueDefs) {
  const defRe = new RegExp(`<def>(${[...uniqueDefs].join('|')})</def>`, 'g');
  const found = new Map();
  for (const m of src.matchAll(defRe)) {
    const range = enclosingElement(src, m.index);
    if (!range) continue;
    const node = parseXml(src.slice(...range)).children[0];
    const id = childText(node, 'id');
    const quality = childText(node, 'quality');
    if (!id || !quality || found.has(id)) continue;
    const traits = (node.children.find((c) => c.name === 'traits')?.children ?? []).map((li) => li.text.trim());
    found.set(id, {
      id,
      def: m[1],
      name: childText(node, 'name') ?? childText(node, 'title'),
      quality,
      traits,
      hitPoints: Number(childText(node, 'health')) || undefined,
      ...locationOf(src, range[0]),
    });
  }
  return [...found.values()];
}

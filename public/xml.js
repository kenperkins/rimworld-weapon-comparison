// Minimal XML parser sufficient for RimWorld Def files: elements, attributes,
// text, comments, CDATA, processing instructions and the five standard entities.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src) {
  src = src.replace(/^﻿/, '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) stack.at(-1).text += decode(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      stack.at(-1).text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      i = src.indexOf('>', lt) + 1;
    } else if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      const name = src.slice(lt + 2, gt).trim();
      const node = stack.pop();
      if (node.name !== name) throw new Error(`Mismatched </${name}>, expected </${node.name}> at ${lt}`);
      i = gt + 1;
    } else {
      const tagRe = /<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
      tagRe.lastIndex = lt;
      const m = tagRe.exec(src);
      if (!m) throw new Error(`Malformed tag at ${lt}: ${src.slice(lt, lt + 40)}`);
      const attrs = {};
      for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[a[1]] = decode(a[2] ?? a[3]);
      }
      const node = { name: m[1], attrs, children: [], text: '' };
      stack.at(-1).children.push(node);
      if (!m[3]) stack.push(node);
      i = tagRe.lastIndex;
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed <${stack.at(-1).name}>`);
  return root;
}

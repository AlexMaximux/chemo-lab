export function parseCharge(f: string): number {
  const withoutPhase = f.trim().replace(/\((?:g|l|s|aq)\)$/i, '');
  const caretMatch = withoutPhase.match(/\^(\d*)([+-])$/);
  if (caretMatch) {
    const mag = caretMatch[1] ? parseInt(caretMatch[1], 10) : 1;
    return caretMatch[2] === '+' ? mag : -mag;
  }
  const trailingMatch = withoutPhase.match(/([+-])$/);
  if (trailingMatch) {
    return trailingMatch[1] === '+' ? 1 : -1;
  }
  return 0;
}

export function parseFormula(f: string): Record<string, number> {
  const cleaned = f
    .trim()
    .replace(/\((?:g|l|s|aq)\)$/i, '')
    .replace(/\^\d*[+-]$/, '')
    .replace(/[+-]$/, '');

  if (!cleaned) {
    throw new Error(`Invalid empty formula: '${f}'`);
  }

  function parseSegment(seg: string): Record<string, number> {
    const counts: Record<string, number> = {};
    let i = 0;

    while (i < seg.length) {
      if (seg[i] === '(' || seg[i] === '[') {
        const openChar = seg[i];
        const closeChar = openChar === '(' ? ')' : ']';
        let depth = 0;
        const start = i + 1;
        while (i < seg.length) {
          if (seg[i] === openChar) depth++;
          else if (seg[i] === closeChar) {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        if (depth !== 0) {
          throw new Error(`Unmatched '${openChar}' in formula '${f}'`);
        }
        const inner = parseSegment(seg.slice(start, i));
        i++; // skip closing bracket
        let numStr = '';
        while (i < seg.length && /\d/.test(seg[i])) {
          numStr += seg[i++];
        }
        const mult = numStr ? parseInt(numStr, 10) : 1;
        for (const [el, c] of Object.entries(inner)) {
          counts[el] = (counts[el] ?? 0) + c * mult;
        }
      } else if (/[A-Z]/.test(seg[i])) {
        let el = seg[i++];
        while (i < seg.length && /[a-z]/.test(seg[i])) {
          el += seg[i++];
        }
        let numStr = '';
        while (i < seg.length && /\d/.test(seg[i])) {
          numStr += seg[i++];
        }
        const mult = numStr ? parseInt(numStr, 10) : 1;
        counts[el] = (counts[el] ?? 0) + mult;
      } else {
        throw new Error(`Unexpected character '${seg[i]}' in formula '${f}'`);
      }
    }

    return counts;
  }

  return parseSegment(cleaned);
}

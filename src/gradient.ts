import type { Color, Paint } from './schema';
function tokens(value: string, separator: ',' | ' '): string[] {
  const result: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++; else if (value[i] === ')') depth--;
    if (depth === 0 && (separator === ',' ? value[i] === ',' : /\s/.test(value[i]))) {
      if (value.slice(start, i).trim()) result.push(value.slice(start, i).trim()); start = i + 1;
    }
  }
  if (value.slice(start).trim()) result.push(value.slice(start).trim()); return result;
}
export function linearGradient(value: string, width: number, height: number, readColor: (css: string) => Color | null): Paint | null {
  const match = value.match(/^linear-gradient\((.*)\)$/s); if (!match) return null;
  const parts = tokens(match[1], ','); let angle = Math.PI, direction = parts[0];
  const unit = direction.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/);
  if (unit) { parts.shift(); angle = Number(unit[1]) * ({ deg: Math.PI / 180, turn: Math.PI * 2, rad: 1, grad: Math.PI / 200 }[unit[2]]!); }
  else if (/^to /.test(direction)) {
    parts.shift(); const horizontal = /right/.test(direction) ? 1 : /left/.test(direction) ? -1 : 0;
    const vertical = /bottom/.test(direction) ? 1 : /top/.test(direction) ? -1 : 0;
    if (!horizontal && !vertical) return null;
    angle = Math.atan2(horizontal * (vertical ? height : 1), -vertical * (horizontal ? width : 1));
  }
  const dx = Math.sin(angle), dy = -Math.cos(angle), length = Math.abs(width * dx) + Math.abs(height * dy) || 1;
  const position = (token: string): number | null => {
    const value = token.trim();
    if (value === '0') return 0;
    const m = value.match(/^(-?(?:\d*\.)?\d+)(%|px)$/);
    if (m) return Number(m[1]) / (m[2] === '%' ? 100 : length);
    if (/^calc\(/.test(value)) {
      const inner = value.slice(5, -1).replace(/\s+/g, '');
      const terms = inner.match(/[+-]?(?:\d*\.)?\d+(?:%|px)/g);
      if (terms?.join('') === inner) return terms.reduce((sum, t) => sum + Number(t.replace(/%|px/g, '')) / (t.endsWith('%') ? 100 : length), 0);
    }
    return null;
  };
  const stops: { color: Color; position: number | null }[] = [];
  for (const part of parts) {
    const pieces = tokens(part, ' '), offsets: number[] = [];
    while (pieces.length > 1 && offsets.length < 2) {
      const offset = position(pieces[pieces.length - 1]); if (offset === null) break;
      pieces.pop(); offsets.unshift(offset);
    }
    const color = readColor(pieces.join(' ')); if (!color) return null;
    for (const offset of offsets.length ? offsets : [null]) stops.push({ color, position: offset });
  }
  if (stops.length < 2 || stops.length > 50) return null;
  stops[0].position ??= 0; stops[stops.length - 1].position ??= 1;
  let previous = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].position === null) continue;
    stops[i].position = Math.max(stops[previous].position!, stops[i].position!);
    for (let j = previous + 1; j < i; j++) stops[j].position = stops[previous].position! + (stops[i].position! - stops[previous].position!) * (j - previous) / (i - previous);
    previous = i;
  }
  const resolved = stops as { color: Color; position: number }[];
  const sample = (p: number): Color => {
    if (p < resolved[0].position) return resolved[0].color;
    for (let i = 1; i < resolved.length; i++) if (p < resolved[i].position) {
      const left = resolved[i - 1], right = resolved[i], t = (p - left.position) / (right.position - left.position);
      const a = left.color.a * (1 - t) + right.color.a * t;
      const channel = (key: 'r' | 'g' | 'b') => a ? (left.color[key] * left.color.a * (1 - t) + right.color[key] * right.color.a * t) / a : 0;
      return { r: channel('r'), g: channel('g'), b: channel('b'), a };
    }
    return resolved[resolved.length - 1].color;
  };
  const clipped = resolved.filter(stop => stop.position >= 0 && stop.position <= 1);
  if (!clipped.length || clipped[0].position > 0) clipped.unshift({ position: 0, color: sample(0) });
  if (clipped[clipped.length - 1].position < 1) clipped.push({ position: 1, color: sample(1) });
  if (clipped.length > 50) return null;
  const a = width * dx / length, b = height * dy / length;
  return { type: 'linear', stops: clipped, transform: [[a, b, .5 - (a + b) / 2], [-b, a, .5 - (a - b) / 2]] };
}

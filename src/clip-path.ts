import type { Color } from './schema';

// CSS path() uses layout pixels. Keep those coordinates in the viewBox so an outer
// CSS scale changes the displayed size without changing arc geometry or hole winding.
export function solidPathClipSVG(value: string, size: { width: number; height: number; layoutWidth: number; layoutHeight: number }, color: Color): string | null {
  const match = value.match(/^path\(\s*(?:(nonzero|evenodd)\s*,\s*)?(["'])([\s\S]*?)\2\s*\)(?:\s+border-box)?$/i);
  if (!match || match[3].length > 1000000 || !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]*$/.test(match[3])) return null;
  if (![size.width, size.height, size.layoutWidth, size.layoutHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  const fill = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.layoutWidth} ${size.layoutHeight}"><path d="${match[3]}" fill="${fill}" fill-opacity="${color.a}" fill-rule="${(match[1] || 'nonzero').toLowerCase()}"/></svg>`;
}

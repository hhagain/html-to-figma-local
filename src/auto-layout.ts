import type { SceneNode as SourceNode } from './schema';
const TOLERANCE = 1.5;
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE;
export function canApplyAutoLayout(spec: SourceNode): boolean {
  const l = spec.layout, children = spec.children || [];
  // Direct text uses Figma font metrics; its wrapping cannot be pinned safely.
  if (!l?.eligible || !children.length || children.some(child => child.kind === 'text')) return false;
  const horizontal = l.direction === 'HORIZONTAL';
  const [top, right, bottom, left] = l.padding;
  const start = horizontal ? left : top, end = horizontal ? right : bottom;
  const size = horizontal ? spec.width : spec.height;
  const sum = children.reduce((n, c) => n + (horizontal ? c.width : c.height), 0);
  const free = size - start - end - sum;
  if (free < -.5) return false;
  const gap = l.main === 'SPACE_BETWEEN' && children.length > 1 ? free / (children.length - 1) : l.gap;
  const remaining = free - gap * Math.max(0, children.length - 1);
  let cursor = start + (l.main === 'CENTER' ? remaining / 2 : l.main === 'MAX' ? remaining : 0);
  for (const child of children) {
    if (!near(horizontal ? child.x : child.y, cursor)) return false;
    const crossSize = horizontal ? spec.height : spec.width, crossStart = horizontal ? top : left, crossEnd = horizontal ? bottom : right;
    const childCross = horizontal ? child.height : child.width;
    const expected = l.cross === 'CENTER' ? crossStart + (crossSize - crossStart - crossEnd - childCross) / 2 : l.cross === 'MAX' ? crossSize - crossEnd - childCross : crossStart;
    if (!near(horizontal ? child.y : child.x, expected)) return false;
    cursor += (horizontal ? child.width : child.height) + gap;
  }
  return true;
}
function geometryMatches(frame: FrameNode, spec: SourceNode): boolean {
  return near(frame.width, spec.width) && near(frame.height, spec.height) && frame.children.length === spec.children?.length && frame.children.every((node, i) => {
    const expected = spec.children![i];
    return near(node.x, expected.x) && near(node.y, expected.y) && near(node.width, expected.width) && near(node.height, expected.height);
  });
}
export function applyAutoLayoutPreservingGeometry(frame: FrameNode, spec: SourceNode): 'applied' | 'skipped' | 'reverted' {
  if (!canApplyAutoLayout(spec) || !geometryMatches(frame, spec) || frame.children.some(child => child.type !== 'FRAME')) return 'skipped';
  const layout = spec.layout!;
  const before = {
    width: frame.width, height: frame.height, clip: frame.clipsContent,
    children: (frame.children as readonly FrameNode[]).map(node => ({ node, x: node.x, y: node.y, width: node.width, height: node.height, primary: node.primaryAxisSizingMode, counter: node.counterAxisSizingMode }))
  };
  const restore = () => {
    // Removing auto layout alone does not restore dimensions or child positions.
    frame.layoutMode = 'NONE'; frame.resizeWithoutConstraints(before.width, before.height); frame.clipsContent = before.clip;
    before.children.forEach((saved, i) => {
      if (frame.children[i] !== saved.node) frame.insertChild(i, saved.node);
      if (saved.node.layoutMode && saved.node.layoutMode !== 'NONE') { saved.node.primaryAxisSizingMode = saved.primary; saved.node.counterAxisSizingMode = saved.counter; }
      saved.node.resizeWithoutConstraints(saved.width, saved.height); saved.node.x = saved.x; saved.node.y = saved.y;
    });
  };
  try {
    frame.layoutMode = layout.direction;
    frame.primaryAxisSizingMode = 'FIXED'; frame.counterAxisSizingMode = 'FIXED';
    frame.layoutWrap = 'NO_WRAP'; frame.strokesIncludedInLayout = false;
    [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft] = layout.padding;
    frame.itemSpacing = layout.gap; frame.primaryAxisAlignItems = layout.main; frame.counterAxisAlignItems = layout.cross;
    for (const saved of before.children) {
      saved.node.layoutGrow = 0; saved.node.layoutAlign = 'INHERIT';
      saved.node.layoutSizingHorizontal = 'FIXED'; saved.node.layoutSizingVertical = 'FIXED';
      saved.node.resizeWithoutConstraints(saved.width, saved.height);
    }
    // layoutMode has already auto-sized the frame. Restore the captured pixels
    // AFTER pinning sizing rules; FIXED alone would lock the new, collapsed size.
    frame.resizeWithoutConstraints(before.width, before.height); frame.clipsContent = before.clip;
    if (geometryMatches(frame, spec)) return 'applied';
  } catch { /* preserve this container visually if the native layout rejects it */ }
  restore(); return 'reverted';
}

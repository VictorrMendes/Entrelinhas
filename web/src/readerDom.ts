/**
 * A block on screen is its text split into elements (bold, italic, interlinear sentences) plus translation lines marked
 * data-tr. These map between the DOM and offsets in the block's text, skipping the translations.
 */

function textNodes(root: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[data-tr]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The offset in the block's text of a DOM position inside [root], or null when it is in a translation line. */
export function offsetIn(root: Element, node: Node, offset: number): number | null {
  let total = 0;
  for (const t of textNodes(root)) {
    if (t === node) return total + offset;
    total += t.length;
  }
  return null;
}

/** A DOM range over [start, end) of the block's text. */
export function rangeIn(root: Element, start: number, end: number): Range | null {
  const range = new Range();
  let total = 0;
  let started = false;
  for (const t of textNodes(root)) {
    if (!started && start <= total + t.length) {
      range.setStart(t, start - total);
      started = true;
    }
    if (started && end <= total + t.length) {
      range.setEnd(t, end - total);
      return range;
    }
    total += t.length;
  }
  return null;
}

/** Where a tap landed in the text: Safari only has caretRangeFromPoint, the others the standard caretPositionFromPoint. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const pos = document.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** Shows [ranges] with the ::highlight([name]) style (Safari 17.2+, Chrome); older browsers simply don't mark them. */
export function mark(name: string, ranges: (Range | null)[]) {
  if (!('highlights' in CSS)) return;
  const list = ranges.filter((r): r is Range => r !== null);
  if (list.length) CSS.highlights.set(name, new Highlight(...list));
  else CSS.highlights.delete(name);
}

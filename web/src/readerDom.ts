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

/**
 * Safari doesn't paint ::highlight in text that can't be selected (WebKit bug 278455), and the reader's text can't be:
 * the long press is ours. There (every browser on the iPhone is Safari inside), and where the API is missing, the marks
 * are boxes behind the text instead, drawn in the layer the reader gives (markLayer).
 */
// ponytail: tells WebKit by its user agent; back to ::highlight everywhere once that bug is fixed
const asBoxes = () => !('highlights' in CSS) || (/AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent));
const boxed = new Map<string, Range[]>();
let layer: HTMLElement | null = null;

/** Where the boxes go: an empty element at the top left of the text, behind it. */
export function markLayer(el: HTMLElement | null) {
  layer = el;
}

/** Shows [ranges] with the ::highlight([name]) style, or as boxes where the browser can't paint that. */
export function mark(name: string, ranges: (Range | null)[]) {
  const list = ranges.filter((r): r is Range => r !== null);
  if (asBoxes()) {
    if (list.length) boxed.set(name, list);
    else boxed.delete(name);
    if (layer) drawBoxes(name, layer.getBoundingClientRect());
  } else if (list.length) CSS.highlights.set(name, new Highlight(...list));
  else CSS.highlights.delete(name);
}

/** The boxes again where the text is now: a page, a picture or the font above them moved it. */
export function redrawMarks() {
  if (!layer) return;
  const origin = layer.getBoundingClientRect();
  for (const name of boxed.keys()) drawBoxes(name, origin);
}

function drawBoxes(name: string, origin: DOMRect) {
  if (!layer) return;
  let group = layer.querySelector<HTMLElement>(`:scope > [data-mark="${name}"]`);
  if (!group) {
    group = document.createElement('div');
    group.dataset.mark = name;
    layer.append(group);
  }
  const boxes = (boxed.get(name) ?? []).flatMap(textRects).map((r) => {
    const box = document.createElement('span');
    box.style.cssText = `left:${r.left - origin.left}px;top:${r.top - origin.top}px;width:${r.width}px;height:${r.height}px`;
    return box;
  });
  group.replaceChildren(...boxes);
}

/** The line boxes of the text in [range], translation lines aside (a whole element in it would add its own box too). */
function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [...range.getClientRects()];
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n) || n.parentElement?.closest('[data-tr]')) continue;
    const piece = new Range();
    piece.setStart(n, n === range.startContainer ? range.startOffset : 0);
    piece.setEnd(n, n === range.endContainer ? range.endOffset : (n as Text).length);
    out.push(...piece.getClientRects());
  }
  return out;
}

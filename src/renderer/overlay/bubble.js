// One speech bubble, following one mascot.
//
// Deliberately a sibling of the pet element rather than a child: the pet is
// flipped with scaleX(-1) when it turns around, and a nested bubble would
// render its text mirrored.

const REVEAL_MS_PER_CHAR = 22;
const FADE_MS = 220;
const MIN_HOLD_MS = 1900;
const HOLD_MS_PER_CHAR = 55;

export function createBubble(layer) {
  const node = document.createElement('div');
  node.className = 'bubble';
  const text = document.createElement('span');
  node.appendChild(text);
  const tail = document.createElement('i');
  node.appendChild(tail);
  layer.appendChild(node);

  let full = '';
  let shownAt = 0;
  let hideAt = 0;
  let visible = false;
  let onDone = null;

  function show(message, { now = performance.now(), then = null } = {}) {
    full = String(message ?? '');
    shownAt = now;
    const reveal = full.length * REVEAL_MS_PER_CHAR;
    hideAt = now + reveal + Math.max(MIN_HOLD_MS, full.length * HOLD_MS_PER_CHAR);
    visible = true;
    onDone = then;
    node.classList.add('is-visible');
  }

  function hide() {
    if (!visible) return;
    visible = false;
    node.classList.remove('is-visible');
    const cb = onDone;
    onDone = null;
    if (cb) cb();
  }

  /**
   * @param anchor {{x:number, y:number}} the point the tail should aim at,
   *   in layer coordinates — normally the top of the mascot's head.
   */
  function update(now, anchor, bounds) {
    if (!visible && node.style.opacity === '0') return;
    if (!visible) return;

    if (now >= hideAt + FADE_MS) { hide(); return; }

    // Typewriter reveal.
    const chars = Math.ceil((now - shownAt) / REVEAL_MS_PER_CHAR);
    const next = full.slice(0, Math.max(0, chars));
    if (next !== text.textContent) text.textContent = next;

    // Fade out over the tail end of the hold.
    node.style.opacity = now > hideAt ? String(1 - (now - hideAt) / FADE_MS) : '1';

    // Centre over the anchor, then clamp so it never leaves the screen. The
    // tail slides within the bubble to keep pointing at the mascot.
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let left = anchor.x - w / 2;
    const top = anchor.y - h - 10;
    const margin = 6;
    left = Math.max(margin, Math.min(left, bounds.width - w - margin));

    node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    const tailX = Math.max(10, Math.min(anchor.x - left, w - 10));
    tail.style.left = `${Math.round(tailX)}px`;
  }

  return {
    node,
    show,
    hide,
    update,
    get visible() { return visible; },
    /** True once the message has finished revealing and holding. */
    get finished() { return !visible; },
  };
}

// A DOM just big enough to run the rig outside a browser.
//
// mark.js touches createElementNS, setAttribute, appendChild, insertBefore,
// textContent and `.style`. Nothing else, which is what makes it possible to
// render the real character in Node — for the preview gallery, and for the
// doctor to assert that a prop actually produces geometry rather than merely
// setting a number nobody draws.

const XML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = s => String(s).replace(/[&<>"]/g, c => XML_ESCAPE[c]);

export function makeElement(name) {
  return {
    nodeName: name,
    attrs: new Map(),
    children: [],
    style: {},
    textContent: '',
    setAttribute(k, v) { this.attrs.set(k, v); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child, ref) {
      const i = this.children.indexOf(ref);
      this.children.splice(i < 0 ? this.children.length : i, 0, child);
      return child;
    },
  };
}

/** Puts a `document` in scope so `mark.js` can be imported. */
export function installDom() {
  globalThis.document = { createElementNS: (_ns, name) => makeElement(name) };
}

/** True when this node would actually put ink on the screen. */
export function isDrawn(node) {
  if (node.getAttribute('display') === 'none') return false;
  // `has` first: Number(null) is 0, which would call every element that never
  // sets an opacity — that is, the entire mascot — invisible.
  if (node.attrs.has('opacity') && Number(node.attrs.get('opacity')) === 0) return false;
  return true;
}

/** Counts the leaf shapes currently being drawn. */
export function countDrawn(node) {
  if (!isDrawn(node)) return 0;
  if (!node.children.length) return node.nodeName === 'defs' ? 0 : 1;
  let n = 0;
  for (const child of node.children) n += countDrawn(child);
  return n;
}

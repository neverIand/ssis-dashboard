// A small DOM double for renderer ownership/identity tests, not browser or layout evidence.
class Node extends EventTarget {
  constructor(document, tag, text = '') {
    super();
    Object.assign(this, { ownerDocument: document, tag, text, children: [], parentElement: null,
      dataset: {}, attributes: new Map(), scrollLeft: 0, scrollTop: 0, hidden: false, disabled: false });
  }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null;
  }
  get isConnected() { return this.tag === 'root' || Boolean(this.parentElement?.isConnected); }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  insertBefore(node, anchor) {
    if (node === anchor) return;
    node.remove();
    node.parentElement = this;
    const index = anchor === null ? this.children.length : this.children.indexOf(anchor);
    if (index < 0) throw new Error('Missing insertion anchor');
    this.children.splice(index, 0, node);
    if (this.isConnected) this.ownerDocument.onMutation?.();
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  replaceChildren(...nodes) {
    for (const node of [...this.children]) node.remove();
    this.text = '';
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
    this.ownerDocument.onMutation?.();
  }
  focus() { this.ownerDocument.activeElement = this; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
}

export function overviewDOM() {
  const window = { scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } };
  const document = Object.assign(new EventTarget(), { defaultView: window, activeElement: null, visibilityState: 'visible',
    createElement: tag => new Node(document, tag),
    createTextNode: text => new Node(document, '#text', text) });
  const root = new Node(document, 'root');
  const elements = new Map();
  for (const key of ['executions-status', 'summary-status', 'list-retry', 'summary-retry', 'cohort-window',
    'app-status', 'executions-previous', 'executions-next', 'executions-latest', 'page-notice', 'overview-refresh', 'summary',
    'poll-toggle', 'poll-status']) {
    const node = new Node(document, key.includes('retry') || ['overview-refresh', 'poll-toggle'].includes(key) ? 'button' : 'p');
    elements.set(`[data-${key}]`, node);
    root.append(node);
  }
  for (const key of ['total', 'running', 'succeeded', 'failed']) {
    const node = new Node(document, 'dd');
    elements.set(`[data-count="${key}"]`, node);
    root.append(node);
  }
  const scroll = new Node(document, 'div'), table = new Node(document, 'table'), body = new Node(document, 'tbody');
  root.append(scroll);
  scroll.append(table);
  table.append(body);
  table.querySelector = selector => selector === 'tbody' ? body : null;
  elements.set('[data-execution-table]', table);
  root.querySelector = selector => elements.get(selector) ?? null;
  return { root, document, window, scroll, body, get: key => elements.get(`[data-${key}]`) };
}

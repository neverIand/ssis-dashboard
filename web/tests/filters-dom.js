// Focused event/form double. Real browser checks own focus, native dates and layout.
class Control extends EventTarget {
  constructor(document, tag = 'div') {
    super();
    Object.assign(this, { ownerDocument: document, tagName: tag.toUpperCase(), textContent: '', children: [],
      queries: new Map(), storedValue: '', dataset: {}, style: {}, attributes: new Map(), hidden: false, validity: {} });
  }
  get value() { return this.storedValue; }
  set value(value) { this.storedValue = this.tagName === 'INPUT' ? String(value).replace(/[\r\n]/g, '') : String(value); }
  replaceChildren(...children) { this.children = children; }
  querySelector(selector) {
    if (this.queries.has(selector)) return this.queries.get(selector);
    if (selector === 'input' || selector === 'option') return this.children[0];
    const match = /^(input|option)\[value="(.*)"\]$/.exec(selector);
    return match ? this.children.find(child => child.value === match[2]) : null;
  }
  querySelectorAll(selector) {
    return this.queries.get(selector) ?? (selector === 'input:checked' ? this.children.filter(node => node.checked) : this.children);
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  getBoundingClientRect() { return { left: 0, top: 0, bottom: 36, width: 800 }; }
  click() { this.dispatchEvent(new Event('click')); }
}

export function filtersDOM(metadata, search = '') {
  const window = Object.assign(new EventTarget(), { location: new URL(`https://example.test/dashboard/app/${search}`) });
  const navigate = (_, __, url) => { window.location = new URL(url, window.location); };
  window.history = { replaceState: navigate, pushState: navigate };
  const document = Object.assign(new EventTarget(), { defaultView: window });
  document.createElement = tag => new Control(document, tag);
  const root = new Control(document), form = new Control(document, 'form');
  root.queries.set('#overview-filters', form); root.ownerDocument = document;
  const add = (selector, tag = 'div', parent = form) => {
    const node = new Control(document, tag); parent.queries.set(selector, node); return node;
  };
  add('fieldset');
  for (const key of ['filter-notice', 'reset-filters', 'apply-filters', 'recover-filters', 'time-notice', 'use-range', 'custom-window', 'time-fields', 'time-help']) add(`[data-${key}]`);
  add('.exact-times'); add('#include-time', 'input');
  const mode = add('#creation-window', 'select');
  for (const value of ['default', 'today', '24h', '7d', '30d', 'custom']) {
    const option = new Control(document, 'option'); option.value = value; mode.children.push(option);
  }
  for (const key of ['from', 'to']) {
    for (const suffix of ['', '-date', '-time']) add(`#${key}${suffix}`, 'input');
    add(`[data-occurrence-label="${key}"]`);
    const select = add(`#${key}-occurrence`, 'select');
    for (const value of ['', '0', '1']) {
      const option = new Control(document, 'option'); option.value = value; select.children.push(option);
    }
  }
  const triggers = [], closes = [];
  for (const key of ['folder', 'project', 'status', 'created']) {
    const trigger = add(`[data-open-filter="${key}"]`, 'button'); trigger.dataset.openFilter = key; triggers.push(trigger);
    const panel = add(`[data-filter-panel="${key}"]`); panel.hidden = true;
    const close = new Control(document, 'button'); closes.push(close); panel.children.push(close);
    add(`[data-filter-label="${key}"]`);
  }
  form.queries.set('[data-open-filter]', triggers); form.queries.set('[data-close-filter]', closes);
  const status = add('#status');
  for (const value of ['', ...metadata.execution_statuses.map(item => String(item.code))]) {
    const checkbox = new Control(document, 'input'); checkbox.value = value; checkbox.checked = value === ''; status.children.push(checkbox);
  }
  for (const key of ['folder', 'project']) {
    add(`#${key}-search`, 'input');
    for (const prefix of ['catalog-choices', 'catalog-status', 'catalog-more', 'catalog-retry', 'exact-scope', 'all-scope']) add(`[data-${prefix}="${key}"]`);
  }
  for (const key of ['sort', 'direction', 'limit']) add(`[data-order="${key}"]`, 'select', root);
  add('[data-order-notice]', 'p', root);
  return { root, form, document, window, get: selector => form.querySelector(selector),
    submit: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
    click: selector => form.querySelector(selector).click(),
    open: key => form.querySelector(`[data-open-filter="${key}"]`).click(),
    close: () => closes[0].click(),
    edit(selector, value, event = 'input') {
      const node = form.querySelector(selector); node.value = value; node.dispatchEvent(new Event(event));
    },
    restore(search) {
      window.history.replaceState(null, '', `/dashboard/app/${search}`); window.dispatchEvent(new Event('popstate'));
    } };
}

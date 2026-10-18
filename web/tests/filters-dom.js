// A focused form double: single-line input values strip CR/LF, option values do not.
// Real browser checks remain necessary for native form and keyboard behavior.
class Control extends EventTarget {
  constructor(tag = 'div') {
    super();
    Object.assign(this, { tag, textContent: '', children: [], queries: new Map(), storedValue: '' });
  }
  get value() { return this.storedValue; }
  set value(value) { this.storedValue = this.tag === 'input' ? String(value).replace(/[\r\n]/g, '') : String(value); }
  replaceChildren(...children) {
    this.children = children;
    if (this.tag === 'select') this.value = children[0]?.value ?? '';
  }
  querySelector(selector) { return this.queries.get(selector) ?? null; }
  querySelectorAll(selector) { return selector === 'input:checked' ? this.children.filter(node => node.checked) : this.children; }
}

export function filtersDOM(metadata, search = '') {
  const window = Object.assign(new EventTarget(), { location: new URL(`https://example.test/dashboard/app/${search}`) });
  const navigate = (_, __, url) => { window.location = new URL(url, window.location); };
  window.history = { replaceState: navigate, pushState: navigate };
  const document = { defaultView: window, createElement: tag => new Control(tag) };
  const root = new Control(), form = new Control('form');
  root.ownerDocument = document;
  root.queries.set('#overview-filters', form);
  const add = (parent, selector, tag) => {
    const node = new Control(tag);
    parent.queries.set(selector, node);
    return node;
  };
  for (const key of ['folder', 'project', 'from', 'to']) add(form, `#${key}`, 'input');
  for (const key of ['creation-window', 'folder-options', 'project-options']) add(form, `#${key}`, 'select');
  for (const key of ['custom-window', 'filter-notice', 'applied-selection', 'reset-filters', 'apply-filters']) add(form, `[data-${key}]`);
  add(form, 'fieldset');
  const status = add(form, '#status');
  for (const value of ['', ...metadata.execution_statuses.map(item => String(item.code))]) {
    const checkbox = new Control('input');
    checkbox.value = value;
    checkbox.checked = value === '';
    status.children.push(checkbox);
  }
  status.queries.set('input[value=""]', status.children[0]);
  for (const kind of ['folders', 'projects']) {
    const container = add(form, `[data-navigation="${kind}"]`);
    for (const selector of ['[role="status"]', '[data-previous]', '[data-next]', '[data-navigation-retry]']) add(container, selector);
  }
  for (const key of ['sort', 'direction', 'limit']) add(root, `[data-order="${key}"]`, 'select');
  add(root, '[data-order-notice]');
  return { root, form, window, get: selector => form.querySelector(selector),
    submit: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
    edit(selector, value, event = 'input') {
      const node = form.querySelector(selector);
      node.value = value;
      node.dispatchEvent(new Event(event));
    },
    restore(search) {
      window.history.replaceState(null, '', `/dashboard/app/${search}`);
      window.dispatchEvent(new Event('popstate'));
    } };
}

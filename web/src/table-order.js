// Detail-table controls share view operations; the detail owner still owns requests.
export function mountTableOrder(root, { resource, metadata, onOrder, sorts = [] }) {
  const document = root.ownerDocument, get = key => root.querySelector(`[data-${resource}-${key}]`);
  const limit = get('limit'), notice = get('notice');
  const sort = sorts.length > 1 ? get('sort') : null;
  const direction = sorts.length ? get('direction') : null;
  const label = sorts.length ? get('order-label') : null;
  const headers = Object.fromEntries(sorts.filter(item => item.header)
    .map(item => [`header-${item.key}`, get(`header-${item.key}`)]));
  const listeners = [];
  let current = null, blocked = true, sizesKey = null;
  function listen(node, event, handler) {
    node.addEventListener(event, handler); listeners.push([node, event, handler]);
  }
  function option(value, name = value) {
    const node = document.createElement('option'); node.value = String(value); node.textContent = String(name); return node;
  }
  if (sort) sort.replaceChildren(...sorts.map(item => option(item.key, item.label)));
  function sync(query) {
    const sizes = [...new Set([25, 50, 100, 200, metadata.limits.default_limit, query.limit])]
      .filter(value => value >= 1 && value <= metadata.limits.max_limit).sort((a, b) => a - b);
    const key = sizes.join(',');
    if (key !== sizesKey) { limit.replaceChildren(...sizes.map(value => option(value))); sizesKey = key; }
    limit.value = String(query.limit);
    if (sort) sort.value = query.sort;
    if (direction) direction.value = query.direction;
    if (label) label.textContent = `Sorted by ${sorts.find(item => item.key === query.sort).label} · ${query.direction === 'asc' ? 'Ascending' : 'Descending'}`;
    for (const item of sorts.filter(item => item.header)) {
      headers[`header-${item.key}`].parentElement.setAttribute('aria-sort', query.sort !== item.key ? 'none'
        : query.direction === 'asc' ? 'ascending' : 'descending');
    }
  }
  function change(changes) {
    if (blocked || !current) { if (current) sync(current); return; }
    const size = changes.limit ?? current.limit;
    if (!Number.isSafeInteger(size) || size < 1 || size > metadata.limits.max_limit) {
      notice.textContent = `Rows per page must be between 1 and ${metadata.limits.max_limit}.`; return;
    }
    if (sorts.length && (!sorts.some(item => item.key === (changes.sort ?? current.sort))
        || !['asc', 'desc'].includes(changes.direction ?? current.direction))) return;
    onOrder(changes);
  }
  listen(limit, 'change', () => change({ limit: Number(limit.value) }));
  if (sort) listen(sort, 'change', () => change({ sort: sort.value }));
  if (direction) listen(direction, 'change', () => change({ direction: direction.value }));
  for (const item of sorts.filter(item => item.header)) listen(headers[`header-${item.key}`], 'click', () => {
    if (!current) return;
    change({ sort: item.key, direction: current.sort === item.key
      ? current.direction === 'asc' ? 'desc' : 'asc' : item.initialDirection ?? 'asc' });
  });
  return {
    headers,
    render(query, busy, hidden) {
      current = query; blocked = busy || hidden; sync(query);
      for (const node of [limit, sort, direction, ...Object.values(headers)].filter(Boolean)) {
        node.disabled = hidden; node.setAttribute('aria-disabled', String(blocked));
      }
    },
    dispose() {
      for (const [node, event, handler] of listeners) node.removeEventListener(event, handler);
      for (const node of [limit, sort, direction, ...Object.values(headers)].filter(Boolean)) node.disabled = true;
      current = null; blocked = true;
    },
  };
}

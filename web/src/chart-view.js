// Shared presentation only: axes and local SVG selection never fetch or schedule work.
export const chartAttribute = (node, key, value) => {
  if (node.getAttribute(key) !== String(value)) node.setAttribute(key, String(value));
};

export function renderChartAxes(xAxis, yAxis, labels, maximum, format, { counts = false } = {}) {
  const document = xAxis.ownerDocument;
  const indices = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])].filter(i => i >= 0 && i < labels.length);
  xAxis.replaceChildren(...indices.map(index => {
    const node = document.createElement('span');
    node.textContent = labels[index].text; node.title = labels[index].title;
    return node;
  }));
  const middle = counts ? Math.floor(maximum / 2) : maximum / 2;
  const ticks = [...new Set([maximum, middle, 0])];
  yAxis.replaceChildren(...ticks.map(value => {
    const node = document.createElement('span');
    node.textContent = format(value); node.title = node.textContent;
    node.style.top = `${(10 + (maximum === 0 ? 150 : (1 - value / maximum) * 150)) / 170 * 100}%`;
    return node;
  }));
  chartAttribute(yAxis, 'data-zero', maximum === 0);
}

// The exact value remains in the selected text; keep extreme scale labels short.
export const durationTick = (value, display) => value > 0 && (value < 0.001 || value >= 3600000)
  ? `${value.toExponential(1)} s` : display.duration(value);

export function mountChartInteraction(svg, { field, keys, node, select }) {
  function targetKey(target) {
    for (let current = target; current && current !== svg; current = current.parentElement) {
      if (current.dataset?.[field] !== undefined) return current.dataset[field];
    }
    return null;
  }
  const pointed = event => {
    const id = targetKey(event.target);
    if (id !== null) select(id);
  };
  const keydown = event => {
    const order = keys(), id = targetKey(event.target), index = order.indexOf(id);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (event.key === 'ArrowRight') next = Math.min(order.length - 1, index + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') next = index;
    else return;
    event.preventDefault(); select(order[next]); node(order[next])?.focus({ preventScroll: true });
  };
  const listeners = [['click', pointed], ['mouseover', pointed], ['focusin', pointed], ['keydown', keydown]];
  for (const [event, handler] of listeners) svg.addEventListener(event, handler);
  return () => { for (const [event, handler] of listeners) svg.removeEventListener(event, handler); };
}

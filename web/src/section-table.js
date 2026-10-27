import { createDisplay } from './display.js';
import { mountTableOrder } from './table-order.js';
import { reserveLoadingSpace } from './loading-space.js';

// Own the DOM lifetime; adapters supply cells, filters and wording, never requests.
export function mountSectionTable(root, { metadata, actions, restoreView = null }, {
  resource, columns, identity, sorts = [], enabled = true, capability = false,
  controlNames = ['toggle', 'retry', 'previous', 'next', 'latest', 'limit', 'scroll'],
  scrollControl = 'scroll', pagingBusy = false, focusMode = 'hidden',
  disclosures = [], focusFallback = [],
}) {
  const document = root.ownerDocument;
  const get = key => root.querySelector(`[data-${resource}-${key}]`);
  const controls = Object.fromEntries(controlNames.map(key => [key, get(key === scrollControl ? 'scroll' : key)]));
  const { toggle, retry, previous, next, latest } = controls;
  const panel = get('panel'), status = get('status'), notice = get('notice'), scroll = get('scroll');
  const table = get('table'), body = table.querySelector('tbody'), rows = new Map(), listeners = [];
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const reserveSpace = reserveLoadingSpace(scroll);
  const order = mountTableOrder(root, { resource, metadata, onOrder: actions.order, sorts });
  Object.assign(controls, order.headers);
  const initialFocus = document.activeElement, initialScroll = { left: scroll.scrollLeft, top: scroll.scrollTop };
  let returning = enabled ? restoreView : null, rendered = null, renderedStart = null, state = null, busy = true;
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const listen = (node, event, handler) => {
    node.addEventListener(event, handler);
    listeners.push([node, event, handler]);
  };
  for (const key of ['toggle', 'retry', 'previous', 'next', 'latest']) listen(controls[key], 'click', actions[key]);
  function empty(message) {
    rows.clear();
    const row = element('tr'), cell = element('td', message, 'empty-state');
    cell.colSpan = columns;
    row.append(cell);
    body.replaceChildren(row);
  }
  function paint(page, executionStart, view) {
    if (!page.data.length) { empty(view.emptyMessage(page, state.pageNumber)); return; }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set();
    let anchor = body.firstChild;
    for (const item of page.data) {
      const id = item[identity];
      wanted.add(id);
      const row = view.paintRow(item, rows.get(id), executionStart);
      if (row.node !== anchor) body.insertBefore(row.node, anchor);
      anchor = row.node.nextSibling;
    }
    for (const [id, row] of rows) if (!wanted.has(id)) { row.node.remove(); rows.delete(id); }
  }
  function restore(page, view) {
    if (!returning || !page || busy) return;
    for (const { saved, field, visible } of disclosures) {
      if (!saved) continue;
      for (const id of returning[saved] ?? []) {
        const node = rows.get(id)?.[field];
        if (node && (!visible || !node.hidden)) node.open = true;
      }
    }
    view.restore?.(returning);
    if (document.activeElement === initialFocus) {
      const target = disclosures.map(({ focus, summary, field, visible }) => {
        const row = rows.get(returning[focus]);
        return row && (!visible || !row[field].hidden) ? row[summary] : null;
      }).find(Boolean) || controls[returning.focus]
        || (focusFallback.some(key => returning[key]) ? scroll : null);
      target?.focus({ preventScroll: true });
    }
    if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) {
      scroll.scrollLeft = returning.left;
      scroll.scrollTop = returning.top;
    }
    returning = null;
  }
  return {
    document, get, controls, panel, notice, status, scroll, rows, display, element, text, listen,
    get state() { return state; },
    get busy() { return busy; },
    get returning() { return returning; },
    mount(view) {
      return {
        render(nextState, isBusy, authorized, executionStart = null) {
          state = nextState;
          busy = isBusy;
          const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
          const position = { left: scroll.scrollLeft, top: scroll.scrollTop }, permitted = enabled && authorized;
          if (!state.open) returning = null;
          if (capability) get('unavailable').hidden = enabled;
          view.availability?.();
          panel.hidden = !state.open || !permitted;
          if (panel.hidden) view.hide?.();
          const disabled = [retry, previous, next, latest, ...(view.disabled ?? [])];
          for (const node of disabled) {
            node.disabled = panel.hidden;
            if (pagingBusy) node.setAttribute('aria-disabled', String(busy));
          }
          if (!pagingBusy) {
            for (const node of [retry, latest, ...(view.busyControls ?? [])]) node.setAttribute('aria-disabled', String(busy));
          }
          previous.setAttribute('aria-disabled', String(busy || !state.hasPrevious));
          next.setAttribute('aria-disabled', String(busy || !state.hasNext));
          const showRetry = () => { retry.hidden = state.phase !== 'error' && !state.error && !(busy && !retry.hidden); };
          if (pagingBusy) showRetry();
          table.setAttribute('aria-busy', String(busy));
          if (!pagingBusy) showRetry();
          order.render(state.query, busy, panel.hidden);
          view.filters?.(state, returning);
          notice.textContent = state.notice;
          const page = panel.hidden ? null : state.page;
          reserveSpace(!panel.hidden && state.phase === 'loading' && page === null, rendered !== null);
          view.beforePaint?.(page, state, busy);
          if (page !== rendered || page === null || executionStart !== renderedStart) {
            if (page) paint(page, executionStart, view);
            else empty(state.phase === 'loading' ? view.loading : view.notLoaded);
            rendered = page;
            renderedStart = executionStart;
          }
          status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
          const info = page ? view.pageInfo(page, state) : '';
          const error = state.error;
          status.textContent = panel.hidden ? '' : error
            ? `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`
              + `${state.stale ? ` ${view.previousPage} ` : ' '}${info}`
            : state.stale ? `Refreshing… ${view.previousPage} ${info}` : state.phase === 'loading' ? view.loading : info;
          status.title = [status.textContent, status.title].filter(Boolean).join(' · ');
          view.afterStatus?.();
          if (panel.hidden && panelFocused && permitted) toggle.focus({ preventScroll: true });
          else if (focused === retry && retry.hidden) (toggle.hidden ? scroll : toggle).focus({ preventScroll: true });
          else if (rowFocused && permitted) {
            if (focusMode === 'removed') {
              if (!focused.isConnected) scroll.focus({ preventScroll: true });
            } else if (focusMode === 'moved') {
              if (document.activeElement !== focused) (focused.isConnected ? focused : scroll).focus({ preventScroll: true });
            } else {
              let hidden = !focused.isConnected;
              for (let node = focused; node && node !== body; node = node.parentElement) hidden ||= node.hidden;
              if (hidden || document.activeElement !== focused) (hidden ? scroll : focused).focus({ preventScroll: true });
            }
          }
          scroll.scrollLeft = position.left;
          scroll.scrollTop = position.top;
          restore(page, view);
        },
        checkpoint() {
          const saved = { left: scroll.scrollLeft, top: scroll.scrollTop };
          for (const { saved: key, field, focus, summary } of disclosures) {
            if (key) saved[key] = [...rows].filter(([, row]) => row[field]?.open).map(([id]) => id);
            saved[focus] = [...rows].find(([, row]) => row[summary] === document.activeElement)?.[0] ?? null;
          }
          return { ...saved, ...view.checkpoint?.(),
            focus: Object.keys(controls).find(key => controls[key] === document.activeElement) ?? null };
        },
        dispose() {
          reserveSpace(false);
          order.dispose();
          view.beforeDispose?.();
          for (const [node, event, handler] of listeners) node.removeEventListener(event, handler);
          rows.clear();
          body.replaceChildren();
          view.clear?.();
          if (view.clearStatus) view.clearStatus();
          else status.textContent = notice.textContent = status.title = '';
          for (const node of Object.values(controls)) node.disabled = true;
          panel.hidden = retry.hidden = true;
          state = returning = rendered = null;
          view.dispose?.();
        },
      };
    },
  };
}

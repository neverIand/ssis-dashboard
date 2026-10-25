import { createDisplay, formatCode } from './display.js';
import { executionHref } from './detail-navigation.js';
import { mountHistoryChart } from './render-history-chart.js';
import { mountTableOrder } from './table-order.js';

export function mountHistory(root, { metadata, actions, navigation, executionId, restoreView = null }) {
  const document = root.ownerDocument, get = key => root.querySelector(`[data-history-${key}]`);
  const controls = Object.fromEntries(['toggle','retry','previous','next','latest','direction','limit','apply','scroll'].map(key => [key,get(key)]));
  const { toggle,retry,previous,next,latest,apply,scroll } = controls;
  const panel = get('panel'), status = get('status'), notice = get('notice'), scope = get('scope'), form = get('filters');
  const table = get('table'), body = table.querySelector('tbody'), rows = new Map(), listeners = [], choices = new Map();
  const display = createDisplay({ timeZone: metadata.display_timezone });
  const chart=mountHistoryChart(root,{metadata,restoreView:restoreView?.chart});
  const order = mountTableOrder(root, { resource: 'history', metadata, onOrder: actions.order,
    sorts: [{ key: 'execution_id', label: 'Execution ID', header: true, initialDirection: 'desc' }] });
  Object.assign(controls, order.headers);
  const initialFocus = document.activeElement, initialScroll = { left: scroll.scrollLeft, top: scroll.scrollTop };
  let returning = restoreView, rendered = null, appliedStatus = null, busy = true;
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const text = (node,value) => { if (node.textContent !== value) node.textContent = value; };
  for (const item of metadata.execution_statuses) {
    const label = element('label', undefined, 'check-label'), input = element('input');
    input.type = 'checkbox'; input.value = String(item.code);
    label.append(input, element('span',formatCode(item))); get('choices').append(label); choices.set(input.value,input);
  }
  function empty(message) {
    rows.clear(); const row = element('tr'), cell = element('td',message,'empty-state');
    cell.colSpan = 4; row.append(cell); body.replaceChildren(row);
  }
  function time(node,value) {
    const key = value ?? '';
    if (node.getAttribute('data-time') === key) return;
    node.setAttribute('data-time', key);
    if (value === null) node.textContent = '—';
    else { const stamp = element('time',display.timestamp(value)); stamp.setAttribute('datetime',value); stamp.title = value; node.replaceChildren(stamp); }
  }
  function paint(page,pageNumber) {
    if (!page.data.length) { empty(pageNumber > 1 ? 'No executions remain on this page. Use Previous or First page.' : 'No executions match this package and status scope.'); return; }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set(); let anchor = body.firstChild;
    for (const item of page.data) {
      const id = item.execution_id; wanted.add(id); let row = rows.get(id);
      if (!row) {
        const node = element('tr'); node.dataset.historyId = id;
        const cells = Array.from({length:4},()=>element('td'));
        const link = element('a',id), badge = element('span',undefined,'status-badge');
        link.href = executionHref(id,navigation.selection,navigation);
        if (id === executionId) link.setAttribute('aria-current','page');
        cells[0].append(link,element('br'),badge); cells[1].className = 'time-cell observation-times';
        const times = {};
        for (const [key,label] of [['created_at','Created'],['started_at','Started'],['ended_at','Ended']]) {
          const line = element('div'); times[key] = element('span'); line.append(element('span',label,'cell-detail'),times[key]); cells[1].append(line);
        }
        const duration = element('p'), elapsed = element('p',undefined,'cell-detail'); cells[2].append(duration,elapsed);
        const estimate = element('p'), end = element('span'), samples = element('p',undefined,'cell-detail'); cells[3].append(estimate,end,samples);
        node.append(...cells); row = {node,link,badge,times,duration,elapsed,estimate,end,samples}; rows.set(id,row);
      }
      text(row.badge,formatCode(item.status)); row.badge.dataset.status = String(item.status.code);
      for (const key of ['created_at','started_at','ended_at']) time(row.times[key],item[key]);
      text(row.duration,display.duration(item.duration_seconds));
      row.elapsed.hidden = item.ended_at !== null || item.elapsed_seconds === null;
      text(row.elapsed,row.elapsed.hidden ? '' : `Elapsed (observed): ${display.duration(item.elapsed_seconds)}`);
      text(row.estimate,item.estimate === null ? 'Unavailable' : `Estimated duration: ${display.duration(item.estimate.duration_seconds)}`);
      row.end.hidden = row.samples.hidden = item.estimate === null;
      time(row.end,item.estimate?.ended_at ?? null);
      text(row.samples,item.estimate === null ? '' : `Mean of ${display.count(item.estimate.sample_count)} prior successful ${item.estimate.sample_count === 1 ? 'run' : 'runs'}`);
      if (row.node !== anchor) body.insertBefore(row.node,anchor);
      anchor = row.node.nextSibling;
    }
    for (const [id,row] of rows) if (!wanted.has(id)) { row.node.remove(); rows.delete(id); }
  }
  const listen = (node,event,handler) => { node.addEventListener(event,handler); listeners.push([node,event,handler]); };
  listen(toggle,'click',actions.toggle); listen(retry,'click',actions.retry); listen(previous,'click',actions.previous);
  listen(next,'click',actions.next); listen(latest,'click',actions.latest);
  listen(form,'submit',event=>{
    event.preventDefault(); if (busy) return;
    const status = [...choices].filter(([,input])=>input.checked).map(([code])=>code).join(',');
    if (!status) { notice.textContent = 'Choose at least one history status.'; return; }
    actions.order({status});
  });
  return {
    render(state,isBusy,authorized,identity) {
      busy = isBusy;
      const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
      const position = {left:scroll.scrollLeft,top:scroll.scrollTop};
      if (!state.open) returning = null;
      panel.hidden = !state.open || !authorized;
      for (const node of [retry,previous,next,latest,apply,...choices.values()]) node.disabled = panel.hidden;
      for (const node of [retry,latest,apply]) node.setAttribute('aria-disabled',String(busy));
      previous.setAttribute('aria-disabled',String(busy || !state.hasPrevious)); next.setAttribute('aria-disabled',String(busy || !state.hasNext));
      table.setAttribute('aria-busy',String(busy)); retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      order.render(state.query,busy,panel.hidden);
      if (appliedStatus !== state.query.status) {
        const chosen = appliedStatus === null && returning?.draft ? returning.draft : state.query.status.split(',');
        for (const [code,input] of choices) input.checked = chosen.includes(code);
        appliedStatus = state.query.status;
      }
      scope.title = identity ? `Folder: ${identity.folder_name} · Project: ${identity.project_name} · Package: ${identity.package_name}` : '';
      scope.textContent = identity ? `All creation dates · ${state.query.status.split(',').map(code=>formatCode(metadata.execution_statuses.find(item=>String(item.code)===code) ?? {code:Number(code),name:'unknown'})).join(', ')}` : '';
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      chart.render({page,pageNumber:state.pageNumber,busy:isBusy,visible:!panel.hidden,stale:state.stale});
      if (page !== rendered || page === null) {
        if (page) paint(page,state.pageNumber); else empty(state.phase === 'loading' ? 'Loading package history…' : 'No history loaded.');
        rendered = page;
      }
      status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
      const info = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} executions on this page` : '';
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ' Previous history page shown. ' : ' '}${info}`
        : state.stale ? `Refreshing… Previous history page shown. ${info}` : state.phase === 'loading' ? 'Loading package history…' : info;
      if (panel.hidden && panelFocused && authorized) toggle.focus({preventScroll:true});
      else if (focused === retry && retry.hidden) toggle.focus({preventScroll:true});
      else if (rowFocused && authorized && !focused.isConnected) scroll.focus({preventScroll:true});
      scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
      if (returning && page && !busy) {
        if (document.activeElement === initialFocus) (rows.get(returning.executionFocus)?.link || controls[returning.focus] || (returning.executionFocus ? scroll : null))?.focus({preventScroll:true});
        if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) { scroll.scrollLeft = returning.left; scroll.scrollTop = returning.top; }
        returning = null;
      }
    },
    checkpoint() { return {left:scroll.scrollLeft,top:scroll.scrollTop,chart:chart.checkpoint(),draft:[...choices].filter(([,input])=>input.checked).map(([code])=>code),
      executionFocus:[...rows].find(([,row])=>row.link===document.activeElement)?.[0] ?? null,
      focus:Object.keys(controls).find(key=>controls[key]===document.activeElement) ?? null}; },
    dispose() {
      order.dispose();
      chart.dispose();
      for (const [node,event,handler] of listeners) node.removeEventListener(event,handler);
      rows.clear(); body.replaceChildren(); get('choices').replaceChildren(); scope.textContent = status.textContent = notice.textContent = scope.title = status.title = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true; returning = rendered = null;
    },
  };
}

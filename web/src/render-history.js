import { createDisplay, formatCode } from './display.js';
import { executionHref } from './detail-navigation.js';
import { mountHistoryChart } from './render-history-chart.js';
import { mountTableOrder } from './table-order.js';
import { allHistoryStatuses } from './history.js';
import { reserveLoadingSpace } from './loading-space.js';

export function mountHistory(root, { metadata, actions, navigation, executionId, restoreView = null }) {
  const document = root.ownerDocument, get = key => root.querySelector(`[data-history-${key}]`);
  const controls = Object.fromEntries(['toggle','retry','previous','next','latest','limit','apply','custom','close','scroll'].map(key => [key,get(key)]));
  const { toggle,retry,previous,next,latest,apply,custom,close,scroll } = controls;
  const panel = get('panel'), status = get('status'), notice = get('notice'), form = get('filters');
  const presets = new Map(), statusOptions = get('status-options');
  const table = get('table'), body = table.querySelector('tbody'), rows = new Map(), listeners = [], choices = new Map();
  const reserveSpace = reserveLoadingSpace(scroll);
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
  statusOptions.hidden = restoreView?.statusOptionsOpen !== true;
  for (const [key,label,status] of [['all','All',allHistoryStatuses(metadata)],['succeeded','Succeeded','7'],['failed','Failed','4'],['running','Running','2']]) {
    if (status.split(',').some(code => !metadata.execution_statuses.some(item => String(item.code) === code))) continue;
    const button = element('button',label); button.type = 'button'; button.dataset.historyPreset = key;
    get('presets').append(button); presets.set(key,{button,status}); controls[`preset-${key}`] = button;
  }
  for (const item of metadata.execution_statuses) {
    const label = element('label', undefined, 'check-label'), input = element('input');
    input.type = 'checkbox'; input.value = String(item.code);
    label.append(input, element('span',formatCode(item))); get('choices').append(label); choices.set(input.value,input);
    controls[`status-${input.value}`] = input;
  }
  function empty(message) {
    rows.clear(); const row = element('tr'), cell = element('td',message,'empty-state');
    cell.colSpan = 6; row.append(cell); body.replaceChildren(row);
  }
  function time(node,value,created = null) {
    const key = `${value ?? ''}/${created ?? ''}`;
    if (node.getAttribute('data-time') === key) return;
    node.setAttribute('data-time', key);
    if (value === null) node.textContent = '—';
    else {
      const full = display.timestamp(value), sameDay = created !== null && full.slice(0,10) === display.timestamp(created).slice(0,10);
      const stamp = element('time',sameDay ? full.slice(11) : full);
      stamp.setAttribute('datetime',value); stamp.title = `${full} · ${value}`; node.replaceChildren(stamp);
    }
  }
  function paint(page,pageNumber) {
    if (!page.data.length) { empty(pageNumber > 1 ? 'No executions remain on this page. Use Previous or First page.' : 'No executions match this package and status scope.'); return; }
    if (!rows.size) body.replaceChildren();
    const wanted = new Set(); let anchor = body.firstChild;
    for (const item of page.data) {
      const id = item.execution_id; wanted.add(id); let row = rows.get(id);
      if (!row) {
        const node = element('tr'); node.dataset.historyId = id;
        const cells = Array.from({length:6},()=>element('td'));
        const link = element('a',id), badge = element('span',undefined,'status-badge');
        link.href = executionHref(id,navigation.selection,navigation);
        node.dataset.current = String(id === executionId);
        if (id === executionId) link.setAttribute('aria-current','page');
        cells[0].append(link,document.createTextNode(' '),badge);
        if (id === executionId) cells[0].append(element('span','current','current-execution'));
        const times = {};
        for (const key of ['created_at','started_at','ended_at']) {
          times[key] = cells[{created_at:1,started_at:2,ended_at:3}[key]];
        }
        const duration = element('span'), elapsed = element('span'); cells[4].append(duration,elapsed);
        const estimate = element('span'), end = element('span'), samples = element('span'); cells[5].append(estimate,end,samples);
        node.append(...cells); row = {node,link,badge,times,duration,elapsed,estimate,end,samples}; rows.set(id,row);
      }
      text(row.badge,formatCode(item.status)); row.badge.dataset.status = String(item.status.code);
      for (const key of ['created_at','started_at','ended_at']) time(row.times[key],item[key],key === 'created_at' ? null : item.created_at);
      text(row.duration,display.duration(item.duration_seconds));
      row.elapsed.hidden = item.ended_at !== null || item.elapsed_seconds === null;
      text(row.elapsed,row.elapsed.hidden ? '' : ` · elapsed ${display.duration(item.elapsed_seconds)}`);
      row.duration.parentElement.title = row.elapsed.hidden ? '' : `Active elapsed (observed): ${display.duration(item.elapsed_seconds)}`;
      text(row.estimate,item.estimate === null ? 'Unavailable' : `${display.duration(item.estimate.duration_seconds)} · ends `);
      row.end.hidden = row.samples.hidden = item.estimate === null;
      time(row.end,item.estimate?.ended_at ?? null,item.created_at);
      text(row.samples,item.estimate === null ? '' : ` (${display.count(item.estimate.sample_count)})`);
      row.estimate.parentElement.title = item.estimate === null ? 'Estimate unavailable' : `Estimated duration: ${display.duration(item.estimate.duration_seconds)} · Estimated end: ${display.timestamp(item.estimate.ended_at)} · Mean of ${display.count(item.estimate.sample_count)} prior successful runs`;
      if (row.node !== anchor) body.insertBefore(row.node,anchor);
      anchor = row.node.nextSibling;
    }
    for (const [id,row] of rows) if (!wanted.has(id)) { row.node.remove(); rows.delete(id); }
  }
  const listen = (node,event,handler) => { node.addEventListener(event,handler); listeners.push([node,event,handler]); };
  const restoreChoices = () => { for (const [code,input] of choices) input.checked = appliedStatus?.split(',').includes(code) ?? false; };
  function closeStatuses({commit = true, focus = false} = {}) {
    if (statusOptions.hidden) return;
    statusOptions.hidden = true; custom.setAttribute('aria-expanded','false');
    const status = [...choices].filter(([,input])=>input.checked).map(([code])=>code).join(',');
    if (!commit || busy) restoreChoices();
    else if (!status) { restoreChoices(); notice.textContent = 'Choose at least one history status.'; }
    else if (status !== appliedStatus) actions.order({status});
    if (focus) custom.focus({preventScroll:true});
  }
  function positionStatuses() {
    if (statusOptions.hidden) return;
    const box = panel.getBoundingClientRect(), anchor = custom.getBoundingClientRect();
    statusOptions.style.top = `${anchor.bottom - box.top + 6}px`;
    statusOptions.style.left = `${Math.max(0,Math.min(anchor.left-box.left,Math.max(0,box.width-400)))}px`;
  }
  listen(custom,'click',()=>{
    if (busy || panel.hidden) return;
    if (!statusOptions.hidden) { closeStatuses({focus:true}); return; }
    statusOptions.hidden = false; custom.setAttribute('aria-expanded','true'); positionStatuses();
    choices.values().next().value?.focus({preventScroll:true});
  });
  listen(close,'click',()=>closeStatuses({focus:true}));
  listen(statusOptions,'keydown',event=>{
    if (event.key === 'Escape') { event.preventDefault(); closeStatuses({commit:false,focus:true}); }
  });
  listen(document,'pointerdown',event=>{
    if (statusOptions.hidden || statusOptions.contains(event.target) || custom.contains(event.target)) return;
    if ([...presets.values()].some(({button})=>button.contains(event.target))) event.preventDefault();
    else closeStatuses();
  });
  for (const eventName of ['click','focusin']) listen(document,eventName,event=>{
    if (!statusOptions.hidden && !statusOptions.contains(event.target) && !custom.contains(event.target)) closeStatuses();
  });
  listen(document.defaultView,'resize',positionStatuses);
  listen(toggle,'click',actions.toggle); listen(retry,'click',actions.retry); listen(previous,'click',actions.previous);
  listen(next,'click',actions.next); listen(latest,'click',actions.latest);
  for (const {button,status} of presets.values()) listen(button,'click',()=>{
    if (busy || panel.hidden) return;
    closeStatuses({commit:false});
    button.focus({preventScroll:true});
    for (const [code,input] of choices) input.checked = status.split(',').includes(code);
    notice.textContent = '';
    if (status !== appliedStatus) actions.order({status});
  });
  listen(form,'submit',event=>{
    event.preventDefault(); closeStatuses({focus:true});
  });
  return {
    render(state,isBusy,authorized) {
      busy = isBusy;
      const focused = document.activeElement, rowFocused = body.contains(focused), panelFocused = panel.contains(focused);
      const position = {left:scroll.scrollLeft,top:scroll.scrollTop};
      if (!state.open) returning = null;
      panel.hidden = !state.open || !authorized;
      if (panel.hidden) closeStatuses({commit:false});
      for (const node of [retry,previous,next,latest,apply,custom,close,...choices.values(),...[...presets.values()].map(item=>item.button)]) node.disabled = panel.hidden;
      for (const node of [retry,latest,apply,custom,...[...presets.values()].map(item=>item.button)]) node.setAttribute('aria-disabled',String(busy));
      previous.setAttribute('aria-disabled',String(busy || !state.hasPrevious)); next.setAttribute('aria-disabled',String(busy || !state.hasNext));
      table.setAttribute('aria-busy',String(busy)); retry.hidden = state.phase !== 'error' && !(busy && !retry.hidden);
      order.render(state.query,busy,panel.hidden);
      if (appliedStatus !== state.query.status) {
        const chosen = appliedStatus === null && returning?.draft ? returning.draft : state.query.status.split(',');
        for (const [code,input] of choices) input.checked = chosen.includes(code);
        appliedStatus = state.query.status;
      }
      for (const {button,status} of presets.values()) button.setAttribute('aria-pressed',String(status === state.query.status));
      custom.setAttribute('aria-expanded',String(!statusOptions.hidden));
      custom.setAttribute('aria-pressed',String(![...presets.values()].some(item=>item.status===state.query.status)));
      custom.title = state.query.status.split(',').map(code=>formatCode(metadata.execution_statuses.find(item=>String(item.code)===code) ?? {code:Number(code),name:'unknown'})).join(', ');
      notice.textContent = state.notice;
      const page = panel.hidden ? null : state.page;
      reserveSpace(!panel.hidden && state.phase === 'loading' && page === null, rendered !== null);
      chart.render({page,pageNumber:state.pageNumber,busy:isBusy,visible:!panel.hidden,stale:state.stale});
      if (page !== rendered || page === null) {
        if (page) paint(page,state.pageNumber); else empty(state.phase === 'loading' ? 'Loading package history…' : 'No history loaded.');
        rendered = page;
      }
      status.title = page ? `Observed ${display.timestamp(page.meta.generated_at)} · ${page.meta.generated_at}` : '';
      const info = page ? `Page ${display.count(state.pageNumber)} · ${display.count(page.data.length)} executions on this page` : '';
      status.textContent = panel.hidden ? '' : state.error ? `${state.error.message}${state.error.requestId ? ` Request ID: ${state.error.requestId}` : ''}${state.stale ? ' Previous history page shown. ' : ' '}${info}`
        : state.stale ? `Refreshing… Previous history page shown. ${info}` : state.phase === 'loading' ? 'Loading package history…' : info;
      status.title = [status.textContent,status.title].filter(Boolean).join(' · ');
      positionStatuses();
      if (panel.hidden && panelFocused && authorized) toggle.focus({preventScroll:true});
      else if (focused === retry && retry.hidden) toggle.focus({preventScroll:true});
      else if (rowFocused && authorized && !focused.isConnected) scroll.focus({preventScroll:true});
      scroll.scrollLeft = position.left; scroll.scrollTop = position.top;
      if (returning && page && !busy) {
        statusOptions.hidden = returning.statusOptionsOpen !== true;
        custom.setAttribute('aria-expanded',String(!statusOptions.hidden));
        positionStatuses();
        if (document.activeElement === initialFocus) (rows.get(returning.executionFocus)?.link || controls[returning.focus] || (returning.executionFocus ? scroll : null))?.focus({preventScroll:true});
        if (scroll.scrollLeft === initialScroll.left && scroll.scrollTop === initialScroll.top) { scroll.scrollLeft = returning.left; scroll.scrollTop = returning.top; }
        returning = null;
      }
    },
    checkpoint() { return {left:scroll.scrollLeft,top:scroll.scrollTop,chart:chart.checkpoint(),statusOptionsOpen:!statusOptions.hidden,draft:[...choices].filter(([,input])=>input.checked).map(([code])=>code),
      executionFocus:[...rows].find(([,row])=>row.link===document.activeElement)?.[0] ?? null,
      focus:Object.keys(controls).find(key=>controls[key]===document.activeElement) ?? null}; },
    dispose() {
      reserveSpace(false);
      order.dispose();
      chart.dispose();
      for (const [node,event,handler] of listeners) node.removeEventListener(event,handler);
      rows.clear(); body.replaceChildren(); get('choices').replaceChildren(); get('presets').replaceChildren(); statusOptions.hidden = true; custom.setAttribute('aria-expanded','false'); status.textContent = notice.textContent = status.title = '';
      for (const node of Object.values(controls)) node.disabled = true;
      panel.hidden = retry.hidden = true; returning = rendered = null;
    },
  };
}

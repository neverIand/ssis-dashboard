import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { historyIdentity, historyQuery, readHistoryPage } from '../src/history.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, wireTime, envelope, jsonResponse } from './fixtures.js';
import { detailDOM, detailResponse, runningDetailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventPage } from './event-fixture.js';
import { parameterPage } from './parameter-fixture.js';
import { overridePage } from './override-fixture.js';
import { historyMetadata, historyRow, historyPage, estimate, suggestionNodes } from './history-fixture.js';
import { mountHistoryScreen } from '../src/history-screen.js';
import { Node } from './overview-dom.js';

const flush = () => new Promise(resolve=>setImmediate(resolve)), metadata = historyMetadata();
const query = {status:'2,7',sort:'execution_id',direction:'desc',limit:50}, identity = detailResponse().data;
const allQuery = {...query,status:'1,2,3,4,5,6,7,8,9'};
const display = createDisplay({timeZone:metadata.display_timezone});
const response = (resource,{params}={}) => resource==='history' ? historyPage() : resource.endsWith('/executables') ? executablePage()
  : resource.endsWith('/children') ? childPage() : resource.endsWith('/events') ? eventPage()
  : resource.endsWith('/values') ? (params.section==='parameters' ? parameterPage() : overridePage()) : detailResponse(resource.split('/')[1]);
function setup(t,get=async (...args)=>response(...args),options={}) {
  const calls=[],states=[];
  const owner=createDetailLoader({executionId:'17',metadata,autoRefresh:false,...options,
    api:{get(resource,options){calls.push({resource,...options});return get(resource,options);}},publish:state=>states.push(state)});
  t.after(owner.dispose);return {owner,calls,states,get state(){return states.at(-1);}};
}
function screen(t,get=async (...args)=>response(...args),options={}) {
  const dom=detailDOM(),calls=[];
  const mounted=mountDetail(dom.root,{executionId:'17',metadata,appBase:'/ops/app/',...options,
    api:{get(resource,options){calls.push({resource,...options});return get(resource,options);}}});
  t.after(mounted.dispose);return {...dom,mounted,calls};
}
const click=(dom,key)=>dom.get(key).dispatchEvent(new Event('click'));

test('history query canonicalizes known statuses and permits only bounded ID order without overview dates',()=>{
  assert.deepEqual(historyQuery({...query,status:'7,2'},metadata),query);
  for(const changes of [{status:''},{status:'2,2'},{status:'0'},{status:'unknown'},{limit:201},{limit:1.1},{sort:'created_at'},{direction:'bad'},{from:wireTime},{to:null}])
    assert.throws(()=>historyQuery({...query,...changes},metadata));
  assert.deepEqual(historyIdentity({...identity,folder_name:' all\r\n+%_ '}),{folder:' all\r\n+%_ ',project:'Project',package:'Main.dtsx'});
});

test('history DTO preserves ordered high IDs, exact identity/timestamps and estimates independent of actual timing',()=>{
  const rows=[historyRow('9223372036854775807',{estimate:estimate()}),historyRow('9007199254740993',{
    status:{code:2,name:'running'},ended_at:null,duration_seconds:null,estimate:estimate()})];
  const page=historyPage(rows);assert.equal(readHistoryPage(page,'17',query,metadata,display,identity),page);
  assert.equal(page.data[1].ended_at,null);assert.equal(page.data[0].estimate.ended_at,rows[0].started_at);
  assert.equal(page.data[0].estimate.duration_seconds,0.00000002);
  const asc=historyPage([...rows].reverse(),{direction:'asc'});
  assert.equal(readHistoryPage(asc,'17',{...query,direction:'asc'},metadata,display,identity),asc);
  assert.equal(readHistoryPage(historyPage([],{upper_id:null}),'17',query,metadata,display,identity).data.length,0);
});

// Review N-01/N-02: the source is live and names match under the catalog collation, so neither is a malformed response.
test('history accepts a row whose status left the requested set or whose names differ from the base execution',()=>{
  const moved=historyPage();moved.data[0].status={code:4,name:'failed'};
  assert.equal(readHistoryPage(moved,'17',query,metadata,display),moved);
  const renamed=historyPage();renamed.data[0].folder_name=renamed.data[0].folder_name.toUpperCase();
  renamed.data[0].package_name=renamed.data[0].package_name.toLowerCase()+' ';
  assert.equal(readHistoryPage(renamed,'17',query,metadata,display),renamed);
  const unknown=historyPage();unknown.data[0].status={code:40,name:'unknown'};
  assert.equal(readHistoryPage(unknown,'17',query,metadata,display),unknown);
  for(const code of [-2147483648,2147483647]){const edge=historyPage();edge.data[0].status={code,name:'unknown'};
    assert.equal(readHistoryPage(edge,'17',query,metadata,display),edge);}
  for(const code of [-2147483649,2147483648,1.5]){const outside=historyPage();outside.data[0].status={code,name:'unknown'};
    assert.throws(()=>readHistoryPage(outside,'17',query,metadata,display),e=>e.kind==='invalid_response');}
});

test('history rejects empty names, wrong order/status names, inherited bounds and malformed estimate semantics',()=>{
  const mutations=[p=>{p.meta.from=wireTime;},p=>{p.meta.sort='created_at';},p=>{p.data[0].folder_name='';},
    p=>{p.data[0].package_name='Main\0.dtsx';},p=>{p.data[0].execution_id='0';},p=>{p.meta.upper_id='0';},
    p=>{p.data.push(p.data[0]);},p=>{p.data[0].status={code:7,name:'failed'};},p=>{p.data[0].status={code:40,name:'failed'};},
    p=>{p.data[0].started_at=null;},p=>{p.data[0].estimate=undefined;},p=>{p.data[0].estimate=estimate({sample_count:0});},
    p=>{p.data[0].estimate=estimate({sample_count:6});},p=>{p.data[0].estimate=estimate({duration_seconds:0});},
    p=>{p.data[0].estimate=estimate({duration_seconds:Infinity});},p=>{p.data[0].estimate=estimate({method:'median'});},
    p=>{p.data[0].estimate=estimate({ended_at:'2026-10-17T15:00:00.1234567Z'});}];
  for(const mutate of mutations){const page=historyPage();mutate(page);assert.throws(()=>readHistoryPage(page,'17',query,metadata,display,identity),e=>e.kind==='invalid_response');}
});

test('lazy history requests exact detail identity without overview scope and shares a seven-read serial refresh',async t=>{
  const all=historyMetadata();Object.assign(all.capabilities,{events:true,values:true,override_values:true});let active=0,peak=0;
  const run=setup(t,async(resource,options)=>{peak=Math.max(peak,++active);await flush();active--;
    return resource==='history' ? historyPage([historyRow(options.params.cursor?'1':'2')],{has_more:!options.params.cursor,next_cursor:options.params.cursor?null:'history-next',limit:options.params.limit,direction:options.params.direction}) : response(resource,options);
  },{metadata:all});
  await run.owner.load();assert.equal(run.calls.length,1);await run.owner.section('history').select();await run.owner.section('history').next();
  assert.equal(run.state.history.pageNumber,2);assert.deepEqual(run.calls.at(-1).params,{...allQuery,...historyIdentity(identity),cursor:'history-next'});
  await run.owner.section('executables').select();await run.owner.section('children').select();await run.owner.section('events').select();await run.owner.section('parameters').select();await run.owner.section('overrides').select();
  const start=run.calls.length;await run.owner.refresh();assert.equal(run.calls.length-start,7);assert.equal(peak,1);
  assert.deepEqual(run.calls.slice(start).map(c=>c.params?.section??c.resource.split('/').at(-1)),['17','executables','children','events','parameters','overrides','history']);
  await run.owner.section('history').order({status:'7',direction:'asc',limit:8});assert.equal(run.state.history.pageNumber,1);
  assert.deepEqual(run.calls.at(-1).params,{...query,status:'7',direction:'asc',limit:8,...historyIdentity(identity)});
});

test('a changed exact package identity discards old history paths and rows even if its new page fails',async t=>{
  let changed=false;
  const run=setup(t,async(resource,options)=>{
    if(resource==='history'){if(changed)throw new ApiError('http',{status:503});return historyPage([historyRow('2')],{has_more:true,next_cursor:'old-identity'});}
    const page=response(resource,options);if(changed)page.data.package_name='Renamed.dtsx';return page;
  });
  await run.owner.load();await run.owner.section('history').select();changed=true;await run.owner.refresh();
  assert.equal(run.calls.at(-1).params.package,'Renamed.dtsx');assert.equal(run.calls.at(-1).params.cursor,undefined);
  assert.equal(run.state.history.page,null);assert.equal(run.state.history.stale,false);assert.equal(run.state.response.data.package_name,'Renamed.dtsx');
});

test('history errors remain scoped including global 404, while invalid cursor fallback clears old results',async t=>{
  for(const status of [503,403,404]){let fail=false;const run=setup(t,async(resource,options)=>{if(fail&&resource==='history')throw new ApiError('http',{status});return response(resource,options);});
    await run.owner.load();await run.owner.section('history').select();fail=true;await run.owner.refresh();
    assert.ok(run.state.response);assert.equal(run.state.history.page!==null,status===503);
  }
  const run=setup(t,async(resource,options)=>{if(resource!=='history')return response(resource,options);if(options.params.cursor)throw new ApiError('http',{status:400,code:'cursor_expired'});throw new ApiError('http',{status:503});},
    {restoreHistory:{open:true,query,path:{entries:[null,'expired'],index:1,cohort:{as_of:wireTime,upper_id:'2'}}}});
  await run.owner.load();assert.equal(run.state.history.pageNumber,1);assert.equal(run.state.history.page,null);assert.equal(run.calls.length,3);
});

test('closing pending history preserves queued value reads and late history cannot invalidate the execution',async t=>{
  const wait=deferred(),all=historyMetadata();all.capabilities.values=true;
  const run=setup(t,(resource,options)=>resource==='history'?wait.promise:Promise.resolve(response(resource,options)),{metadata:all});
  await run.owner.load();const opening=run.owner.section('history').select();await run.owner.section('parameters').select();await run.owner.section('history').select();await flush();
  assert.ok(run.state.parameters.page);wait.reject(new ApiError('http',{status:404}));await opening;
  assert.equal(run.state.history.open,false);assert.ok(run.state.response);
});

test('history generation, deadlines and disposal reject late responses after A to B to A',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});const pending=[];
  const run=setup(t,(resource,options)=>{if(resource!=='history')return Promise.resolve(response(resource,options));const wait=deferred();pending.push({...wait,signal:options.signal});return wait.promise;},{timeoutMs:20});
  await run.owner.load();const a=run.owner.section('history').select();await flush();const b=run.owner.select('18');await flush();const again=run.owner.select('17');await flush();
  pending[0].reject(new ApiError('http',{status:403}));pending[1].resolve(historyPage([historyRow('2')]));pending[2].resolve(historyPage([historyRow('3')]));await Promise.all([a,b,again]);
  assert.equal(run.state.history.page.data[0].execution_id,'3');const refreshing=run.owner.refresh();await flush();t.mock.timers.tick(20);assert.ok(pending[3].signal.aborted);
  pending[3].reject(new Error('abort'));await refreshing;assert.equal(run.state.history.error.kind,'timeout');
  const retry=run.owner.section('history').retry();await flush();const state=run.state;run.owner.dispose();pending[4].resolve(historyPage());await retry;assert.equal(run.state,state);
});

test('history UI keeps actual and estimated timing separate, preserves lexical identity and links only valid selection',async t=>{
  const rows=[historyRow('3',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null,estimate:estimate()}),historyRow('2'),historyRow('1',{estimate:estimate({sample_count:1,duration_seconds:10,ended_at:'2026-10-17T16:00:10.1234567Z'})})];
  const dom=screen(t,async(resource,options)=>resource==='history'?historyPage(rows):response(resource,options));await flush();click(dom,'history-toggle');await flush();
  const first=dom.historyBody.children[0];assert.equal(first.children.length,7);assert.match(first.children[4].textContent,/— · elapsed/);
  assert.equal(first.children[3].textContent,'—');assert.match(first.children[5].textContent,/ends .* · avg of 5$/);
  assert.equal(first.children[5].children[1].children[0].getAttribute('datetime'),wireTime);assert.equal(first.children[0].children[0].href,'/ops/app/executions/3');
  assert.equal(dom.historyBody.children[1].children[5].children[0].textContent,'Unavailable');assert.equal(dom.get('history-custom').getAttribute('aria-pressed'),'false');
  assert.match(dom.get('history-status').textContent,/3 executions on this page/);
});

test('history estimate titles contain the additional estimated end and disappear when it is visible or unavailable', async t => {
  const end = '2026-10-17T16:00:07.0000000Z', nextDay = '2026-10-18T16:00:07.0000000Z';
  const live = { status: { code: 2, name: 'running' }, ended_at: null, duration_seconds: null, elapsed_seconds: 65 };
  const rows = [
    historyRow('4', { duration_seconds: 65, estimate: estimate({ duration_seconds: 65 / 9.25, ended_at: end }) }),
    historyRow('3', { ...live, estimate: estimate({ duration_seconds: 80, ended_at: end }) }),
    historyRow('2', { ...live, estimate: estimate({ duration_seconds: 86407, ended_at: nextDay }) }),
    historyRow('1'),
  ];
  const dom = screen(t, async resource => resource === 'history' ? historyPage(rows) : response(resource));
  await flush(); click(dom, 'history-toggle'); await flush();
  const [ended, running, crossDay, unavailable] = dom.historyBody.children.map(row => row.children[5]);
  assert.equal(ended.textContent, '7 s · avg of 5 · +825%');
  assert.equal(ended.getAttribute('title'), 'Estimated end 2026-10-17 17:00:07');
  assert.equal(ended.children.at(-1).getAttribute('title'), null);
  assert.equal(ended.children.at(-1).title, undefined);
  assert.equal(running.getAttribute('title'), 'Estimated end 2026-10-17 17:00:07');
  assert.equal(dom.historyBody.children[1].children[4].title, 'Elapsed at last update');
  assert.match(crossDay.textContent, /ends 2026-10-18 17:00:07/);
  assert.equal(crossDay.getAttribute('title'), null);
  assert.equal(unavailable.children[0].textContent, 'Unavailable');
  assert.equal(unavailable.getAttribute('title'), null);
});

test('history status drafts survive order changes and refresh; Apply validates nonempty scope without inheriting dates',async t=>{
  const dom=screen(t,async(resource,options)=>resource==='history'?historyPage([],{direction:options.params.direction,limit:options.params.limit}):response(resource,options));await flush();click(dom,'history-toggle');await flush();
  click(dom,'history-custom');const inputs=dom.get('history-choices').children.map(label=>label.children[0]);for(const input of inputs)input.checked=['2','4','7'].includes(input.value);
  dom.get('history-header-execution_id').dispatchEvent(new Event('click'));await flush();assert.ok(inputs[3].checked);assert.equal(dom.calls.at(-1).params.status,allQuery.status);
  dom.get('history-filters').dispatchEvent(new Event('submit'));await flush();assert.equal(dom.calls.at(-1).params.status,'2,4,7');
  assert.equal(dom.document.activeElement, dom.get('history-custom'));
  click(dom,'history-custom');for(const input of inputs)input.checked=false;const count=dom.calls.length;dom.get('history-filters').dispatchEvent(new Event('submit'));assert.equal(dom.calls.length,count);assert.match(dom.get('history-notice').textContent,/Choose at least one/);
});

test('live estimate loss clears previous estimate text while keyed link focus, draft and scroll survive refresh',async t=>{
  let changed=false;const dom=screen(t,async(resource,options)=>resource==='history'?historyPage([historyRow('1',{estimate:changed?null:estimate()})]):response(resource,options));
  await flush();click(dom,'history-toggle');await flush();const row=dom.historyBody.children[0],link=row.children[0].children[0];dom.get('history-scroll').scrollLeft=120;
  changed=true;click(dom,'detail-refresh');link.focus();await flush();assert.equal(dom.historyBody.children[0],row);assert.equal(dom.document.activeElement,link);
  assert.equal(row.children[5].getAttribute('title'), null);
  assert.equal(dom.get('history-scroll').scrollLeft,120);assert.doesNotMatch(row.children[5].textContent,/Mean of|Estimated duration/);assert.equal(row.children[5].children[1].textContent,'');assert.equal(row.children[5].children[1].hidden,true);
  const checkpoint=dom.mounted.checkpoint();assert.doesNotMatch(JSON.stringify(checkpoint),/Main\.dtsx|Folder|estimate|duration_seconds/);dom.mounted.dispose();
  const restored=screen(t,undefined,{restoreView:checkpoint});await flush();assert.equal(restored.calls.at(-1).resource,'history');assert.equal(restored.document.activeElement,restored.historyBody.children[0].children[0].children[0]);
});

test('history navigation preserves only the validated overview selection, and busy inputs cannot mislabel applied order',async t=>{
  const wait=deferred(),dom=detailDOM();dom.window.location.search='?overview=%3Ffolder%3DFold%252B%2B%252F%26limit%3D5';let slow=false;
  const calls=[],mounted=mountDetail(dom.root,{metadata,executionId:'17',appBase:'/ops/app/',api:{get(resource,options){calls.push({resource,...options});return resource==='history'&&slow?wait.promise:Promise.resolve(response(resource,options));}}});
  t.after(mounted.dispose);await flush();click(dom,'history-toggle');await flush();
  assert.equal(dom.historyBody.children[0].children[0].children[0].href,'/ops/app/executions/1?overview=%3Ffolder%3DFold%252B%2B%252F%26limit%3D5');
  slow=true;click(dom,'detail-refresh');await flush();const count=calls.length;click(dom,'detail-refresh');
  dom.get('history-header-execution_id').dispatchEvent(new Event('click'));
  dom.get('history-limit').value='8';dom.get('history-limit').dispatchEvent(new Event('change'));assert.equal(dom.get('history-header-execution_id').parentElement.getAttribute('aria-sort'),'descending');assert.equal(dom.get('history-limit').value,'50');assert.equal(calls.length,count);
  dom.get('legacy-detail-link').focus();wait.resolve(historyPage());await flush();assert.equal(dom.document.activeElement,dom.get('legacy-detail-link'));
  mounted.dispose();const closed=calls.length;click(dom,'history-toggle');assert.equal(calls.length,closed);assert.equal(dom.historyBody.textContent,'');
});

test('an end before its start is accepted with a NULL duration',()=>{
  const page=historyPage([historyRow('9',{ended_at:'2026-01-01T00:00:00.0000000Z',duration_seconds:null,elapsed_seconds:0})]);
  assert.equal(readHistoryPage(page,'17',query,metadata,display,identity),page);
  assert.ok(page.data[0].ended_at<page.data[0].started_at);
});

const rowsMetadata = historyMetadata();
const settle = () => new Promise(resolve => setImmediate(resolve));
const scoped = '?match=exact&folder=Folder&project=Project&package=Main.dtsx';
function rowsScreen(t, search, rows = () => [historyRow('5')], storage = null) {
  const dom = detailDOM(), extra = new Map(), calls = [];
  suggestionNodes(Node, dom.document, extra);
  const node = (key, tag = 'div') => { const value = new Node(dom.document, tag); extra.set(`[data-${key}]`, value); return value; };
  const form = node('history-scope-form', 'form'), inputs = {};
  for (const key of ['match', 'folder', 'project', 'package']) inputs[key] = new Node(dom.document, key === 'match' ? 'select' : 'input');
  form.elements = { namedItem: key => inputs[key] };
  for (const key of ['history-scope', 'history-scope-notice', 'history-poll-status', 'history-results', 'history-mode-note']) node(key);
  for (const key of ['history-refresh', 'history-poll-toggle', 'history-load']) node(key, 'button');
  extra.get('[data-history-results]').setAttribute('data-idle', '');
  const query = dom.root.querySelector;
  dom.root.querySelector = selector => extra.get(selector) ?? query(selector);
  Object.assign(dom.window.location, { pathname: '/ops/app/history', search, assign: href => dom.opened.push(href) });
  dom.window.history.pushState = (state, title, href) => dom.window.history.replaceState(state, title, href);
  if (storage) dom.window.localStorage = storage;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/meta')) return jsonResponse(envelope(rowsMetadata));
    if (url.pathname.endsWith('/server')) return jsonResponse(envelope({ server_name: 'Server' }));
    const params = Object.fromEntries(url.searchParams);
    return jsonResponse(historyPage(rows(params), { direction: params.direction, limit: Number(params.limit) }));
  });
  dom.opened = [];
  const mounted = mountHistoryScreen(dom.root);
  t.after(mounted.dispose);
  const get = key => extra.get(`[data-${key}]`) ?? dom.get(key);
  return { ...dom, inputs, form, calls, get, history: () => calls.filter(call => call.includes('/history')) };
}

test('H3: ended rows show the deviation from the estimate; running rows keep the expected end', async t => {
  const dom = rowsScreen(t, scoped, () => [
    historyRow('7', { duration_seconds: 30, estimate: estimate({ duration_seconds: 10 }) }),
    historyRow('6', { duration_seconds: 8, estimate: estimate({ duration_seconds: 10 }) }),
    historyRow('5', { status: { code: 2, name: 'running' }, ended_at: null, duration_seconds: null, elapsed_seconds: 3,
      estimate: estimate({ duration_seconds: 10 }) })]);
  await settle();
  const [slow, fast, running] = dom.historyBody.children.map(row => row.children[5]);
  assert.match(slow.textContent, /^10 s · avg of 5 · \+200%$/);
  assert.equal(slow.children[3].dataset.level, 'warning');
  assert.match(fast.textContent, /^10 s · avg of 5 · −20%$/);
  assert.equal(fast.children[3].dataset.level, 'quiet', 'faster runs are not coloured as better');
  assert.match(running.textContent, /^10 s · ends .* · avg of 5$/);
  assert.equal(running.children[3].hidden, true);
});

const clickNode=node=>node.dispatchEvent(new Event('click'));
const all='1,2,3,4,5,6,7,8,9';
function historyScreen(t,rows,{get,restoreView}={}){
  const dom=detailDOM(),calls=[],metadata=historyMetadata();
  const view=mountDetail(dom.root,{metadata,executionId:'17',appBase:'/app/',restoreView,api:{async get(resource,options){
    calls.push({resource,...options});
    if(resource==='history')return get?get(options):historyPage(rows.filter(row=>options.params.status.split(',').includes(String(row.status.code))),{limit:options.params.limit,direction:options.params.direction});
    if(resource.endsWith('/executables'))return executablePage();
    const response=detailResponse('17');response.data.status={code:4,name:'failed'};return response;
  }}});t.after(view.dispose);return {...dom,calls,view};
}
async function openHistory(dom,chart=false){await flush();clickNode(dom.get('history-toggle'));await flush();if(chart)clickNode(dom.get('history-chart-toggle'));}
const preset=(dom,key)=>dom.get('history-presets').children.find(node=>node.dataset.historyPreset===key);

test('D3 explicitly requests every known status and visibly marks a failed current execution',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'}}),historyRow('16'),historyRow('15',{status:{code:4,name:'failed'}})];
  const dom=historyScreen(t,rows);await openHistory(dom);
  assert.equal(dom.calls.at(-1).params.status,all);assert.equal(dom.historyBody.children.length,3);
  const current=dom.historyBody.children[0];assert.equal(current.dataset.current,'true');
  assert.equal(current.children[0].firstChild.getAttribute('aria-current'),'page');
  assert.equal(current.children[0].textContent, '17 · current');
  assert.equal(current.children[6].textContent, 'Failed');
  assert.equal(current.children[6].firstChild.dataset.status, '4');
  assert.equal(current.children[0].children.at(-1).textContent, ' · current', 'the separator is in the accessible text once');
  assert.equal(dom.historyBody.children[1].dataset.current,'false');
  assert.equal(dom.historyBody.children[1].children[0].textContent, '16');
  assert.equal(!dom.get('history-status-options').matches(':popover-open'),true);assert.equal(preset(dom,'all').getAttribute('aria-pressed'),'true');
  current.children[0].firstChild.focus();clickNode(dom.get('detail-refresh'));await flush();
  assert.equal(dom.historyBody.children[0],current);assert.equal(dom.document.activeElement,current.children[0].firstChild);
});

test('history presets apply once, reset checkbox drafts, and leave estimates to the returned server page',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'},estimate:estimate({duration_seconds:12})}),historyRow('16'),
    historyRow('15',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null})];
  const dom=historyScreen(t,rows);await openHistory(dom);const choices=dom.get('history-choices').children.map(label=>label.firstChild);
  for(const [key,status] of [['succeeded','7'],['failed','4,6'],['running','2'],['all',all]]){
    for(const input of choices)input.checked=false;
    const count=dom.calls.length;clickNode(preset(dom,key));await flush();
    assert.equal(dom.calls.length,count+1);assert.equal(dom.calls.at(-1).params.status,status);
    assert.equal(preset(dom,key).getAttribute('aria-pressed'),'true');
    assert.deepEqual(choices.filter(input=>input.checked).map(input=>input.value),status.split(','));
    if(key==='failed')assert.match(dom.historyBody.children[0].children[5].textContent,/^12 s · avg of 5 · [+−]?\d+%$/);
    clickNode(preset(dom,key));await flush();assert.equal(dom.calls.length,count+1,'Reapplying the same preset adds no read');
  }
});

test('busy history presets cannot send reads or change applied status and retain keyboard focus',async t=>{
  const wait=deferred();let slow=false;
  const dom=historyScreen(t,[],{get:()=>slow?wait.promise:historyPage()});await openHistory(dom);
  const button=preset(dom,'failed');button.focus();slow=true;clickNode(dom.get('detail-refresh'));await flush();
  const count=dom.calls.length;clickNode(button);clickNode(button);
  assert.equal(dom.calls.length,count);assert.equal(button.getAttribute('aria-disabled'),'true');
  assert.equal(preset(dom,'all').getAttribute('aria-pressed'),'true');
  wait.resolve(historyPage());await flush();assert.equal(dom.document.activeElement,button);
});

test('secondary history choices and a preset focus restore after fresh reads without persisting rows',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'}})];
  const dom=historyScreen(t,rows);await openHistory(dom);clickNode(preset(dom,'failed'));await flush();
  clickNode(dom.get('history-custom'));dom.get('history-choices').children[0].firstChild.focus();
  const saved=dom.view.checkpoint();assert.doesNotMatch(JSON.stringify(saved),/Main\.dtsx|duration_seconds|sample_count/);dom.view.dispose();
  const restored=historyScreen(t,rows,{restoreView:saved});await flush();
  assert.equal(restored.calls.length,2);assert.equal(restored.calls.at(-1).params.status,'4,6');
  assert.equal(!restored.get('history-status-options').matches(':popover-open'),false);assert.equal(restored.document.activeElement,restored.get('history-choices').children[0].firstChild);
});

function dispatch(node, type, target, key) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  if (key) Object.defineProperty(event, 'key', { value: key });
  node.dispatchEvent(event); return event;
}
function historyTabScreen(t, { tab = 'history', read = () => historyPage(), response = () => detailResponse('17') } = {}) {
  const dom = detailDOM(), calls = [], metadata = historyMetadata();
  metadata.capabilities.events = true;
  metadata.event_kinds = ['all', 'errors', 'warnings'];
  dom.window.location.hash = `#${tab}`;
  const view = mountDetail(dom.root, { metadata, executionId: '17', appBase: '/app/', api: {
    async get(resource, options) {
      calls.push({ resource, ...options });
      return resource === 'history' || resource.endsWith('/events') ? read(resource, options) : response();
    },
  } });
  t.after(view.dispose);
  return { ...dom, calls, view };
}
const chooseStatuses = (dom, codes) => {
  for (const label of dom.get('history-choices').children) label.firstChild.checked = codes.includes(label.firstChild.value);
};

test('Custom status popover applies exactly once on close; Escape cancels and restores the applied checks', async t => {
  const dom = historyTabScreen(t); await flush(); const count = dom.calls.length;
  clickNode(dom.get('history-custom')); chooseStatuses(dom, ['4', '7']);
  assert.equal(String(dom.get('history-status-options').matches(':popover-open')), 'true');
  assert.equal(dom.calls.length, count);
  dom.get('history-status-options').hidePopover(); await flush();
  assert.equal(dom.calls.length, count + 1);
  assert.equal(dom.calls.at(-1).params.status, '4,7');
  assert.equal(dom.get('history-custom').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.document.activeElement, dom.get('history-custom'));
  clickNode(dom.get('history-custom')); chooseStatuses(dom, ['2']);
  const event = dispatch(dom.get('history-status-options'), 'keydown', dom.document.activeElement, 'Escape');
  assert.equal(event.defaultPrevented, true); assert.equal(dom.calls.length, count + 1);
  assert.equal(!dom.get('history-status-options').matches(':popover-open'), true);
  assert.equal(dom.document.activeElement, dom.get('history-custom'));
  assert.deepEqual(dom.get('history-choices').children.filter(label => label.firstChild.checked).map(label => label.firstChild.value), ['4', '7']);
});

test('Custom commits on focus leaving, ignores unchanged closes, and rejects an empty selection locally', async t => {
  const dom = historyTabScreen(t); await flush(); let count = dom.calls.length;
  clickNode(dom.get('history-custom'));
  dispatch(dom.document, 'focusin', dom.get('history-limit')); await flush();
  assert.equal(dom.calls.length, count);
  clickNode(dom.get('history-custom')); chooseStatuses(dom, ['4']);
  dispatch(dom.document, 'focusin', dom.get('history-limit')); await flush();
  assert.equal(dom.calls.length, ++count); assert.equal(dom.calls.at(-1).params.status, '4');
  clickNode(dom.get('history-custom')); chooseStatuses(dom, []);
  dom.get('history-filters').dispatchEvent(new Event('submit')); await flush();
  assert.equal(dom.calls.length, count); assert.match(dom.get('history-notice').textContent, /at least one/);
  assert.equal(!dom.get('history-status-options').matches(':popover-open'), true);
});

test('a preset consumes an open Custom draft without an intermediate request', async t => {
  const dom = historyTabScreen(t); await flush(); const count = dom.calls.length;
  clickNode(dom.get('history-custom')); chooseStatuses(dom, ['4', '7']);
  const running = dom.get('history-presets').children.find(button => button.dataset.historyPreset === 'running');
  assert.equal(dispatch(dom.document, 'pointerdown', running).defaultPrevented, false);
  dom.get('history-status-options').hidePopover();
  assert.equal(dom.calls.length, count, 'Native dismissal before preset activation cannot send an intermediate read');
  clickNode(running); dispatch(dom.document, 'click', running); await flush();
  assert.equal(dom.calls.length, count + 1); assert.equal(dom.calls.at(-1).params.status, '2');
  assert.equal(dom.document.activeElement, running); assert.equal(!dom.get('history-status-options').matches(':popover-open'), true);
});

test('busy refresh preserves icon names/focus, and closing Custom cannot dispatch while busy', async t => {
  const wait = deferred(); let slow = false;
  const dom = historyTabScreen(t, { response: () => runningDetailResponse('17'), read: () => slow ? wait.promise : historyPage() }); await flush();
  clickNode(dom.get('history-custom')); chooseStatuses(dom, ['4']);
  const refresh = dom.get('detail-refresh'); refresh.focus(); slow = true; clickNode(refresh); await flush();
  const count = dom.calls.length;
  assert.equal(refresh.getAttribute('aria-disabled'), 'true'); assert.equal(dom.document.activeElement, refresh);
  assert.equal(dom.get('detail-poll-toggle').getAttribute('aria-label'), 'Pause auto refresh');
  dom.get('history-status-options').hidePopover(); clickNode(dom.get('history-custom'));
  assert.equal(dom.calls.length, count); assert.equal(!dom.get('history-status-options').matches(':popover-open'), true);
  wait.resolve(historyPage()); await flush();
  assert.equal(refresh.getAttribute('aria-disabled'), 'false');
  clickNode(dom.get('detail-poll-toggle'));
  assert.equal(dom.get('detail-poll-toggle').getAttribute('aria-label'), 'Resume auto refresh');
  assert.equal(dom.get('detail-poll-toggle').title, 'Resume auto refresh');
});

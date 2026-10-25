import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api.js';
import { createDetailLoader } from '../src/detail.js';
import { createDisplay } from '../src/display.js';
import { historyIdentity, historyQuery, readHistoryPage } from '../src/history.js';
import { mountDetail } from '../src/render-detail.js';
import { deferred, wireTime } from './fixtures.js';
import { detailDOM, detailResponse } from './detail-fixture.js';
import { executablePage } from './executable-fixture.js';
import { childPage } from './child-fixture.js';
import { eventPage } from './event-fixture.js';
import { parameterPage } from './parameter-fixture.js';
import { overridePage } from './override-fixture.js';
import { historyMetadata, historyRow, historyPage, estimate } from './history-fixture.js';

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

test('history rejects wrong identity/order/status, inherited bounds and malformed estimate semantics',()=>{
  const mutations=[p=>{p.meta.from=wireTime;},p=>{p.meta.sort='created_at';},p=>{p.data[0].folder_name='Other';},
    p=>{p.data[0].package_name='MainXdtsx';},p=>{p.data[0].execution_id='0';},p=>{p.meta.upper_id='0';},
    p=>{p.data.push(p.data[0]);},p=>{p.data[0].status={code:7,name:'failed'};},p=>{p.data[0].status={code:4,name:'failed'};},
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
  await run.owner.load();assert.equal(run.calls.length,1);await run.owner.toggleHistory();await run.owner.nextHistory();
  assert.equal(run.state.history.pageNumber,2);assert.deepEqual(run.calls.at(-1).params,{...allQuery,...historyIdentity(identity),cursor:'history-next'});
  await run.owner.toggleExecutables();await run.owner.toggleChildren();await run.owner.toggleEvents();await run.owner.toggleParameters();await run.owner.toggleOverrides();
  const start=run.calls.length;await run.owner.refresh();assert.equal(run.calls.length-start,7);assert.equal(peak,1);
  assert.deepEqual(run.calls.slice(start).map(c=>c.params?.section??c.resource.split('/').at(-1)),['17','executables','children','events','parameters','overrides','history']);
  await run.owner.orderHistory({status:'7',direction:'asc',limit:8});assert.equal(run.state.history.pageNumber,1);
  assert.deepEqual(run.calls.at(-1).params,{...query,status:'7',direction:'asc',limit:8,...historyIdentity(identity)});
});

test('a changed exact package identity discards old history paths and rows even if its new page fails',async t=>{
  let changed=false;
  const run=setup(t,async(resource,options)=>{
    if(resource==='history'){if(changed)throw new ApiError('http',{status:503});return historyPage([historyRow('2')],{has_more:true,next_cursor:'old-identity'});}
    const page=response(resource,options);if(changed)page.data.package_name='Renamed.dtsx';return page;
  });
  await run.owner.load();await run.owner.toggleHistory();changed=true;await run.owner.refresh();
  assert.equal(run.calls.at(-1).params.package,'Renamed.dtsx');assert.equal(run.calls.at(-1).params.cursor,undefined);
  assert.equal(run.state.history.page,null);assert.equal(run.state.history.stale,false);assert.equal(run.state.response.data.package_name,'Renamed.dtsx');
});

test('history errors remain scoped including global 404, while invalid cursor fallback clears old results',async t=>{
  for(const status of [503,403,404]){let fail=false;const run=setup(t,async(resource,options)=>{if(fail&&resource==='history')throw new ApiError('http',{status});return response(resource,options);});
    await run.owner.load();await run.owner.toggleHistory();fail=true;await run.owner.refresh();
    assert.ok(run.state.response);assert.equal(run.state.history.page!==null,status===503);
  }
  const run=setup(t,async(resource,options)=>{if(resource!=='history')return response(resource,options);if(options.params.cursor)throw new ApiError('http',{status:400,code:'cursor_expired'});throw new ApiError('http',{status:503});},
    {restoreHistory:{open:true,query,path:{entries:[null,'expired'],index:1,cohort:{as_of:wireTime,upper_id:'2'}}}});
  await run.owner.load();assert.equal(run.state.history.pageNumber,1);assert.equal(run.state.history.page,null);assert.equal(run.calls.length,3);
});

test('closing pending history preserves queued value reads and late history cannot invalidate the execution',async t=>{
  const wait=deferred(),all=historyMetadata();all.capabilities.values=true;
  const run=setup(t,(resource,options)=>resource==='history'?wait.promise:Promise.resolve(response(resource,options)),{metadata:all});
  await run.owner.load();const opening=run.owner.toggleHistory();await run.owner.toggleParameters();await run.owner.toggleHistory();await flush();
  assert.ok(run.state.parameters.page);wait.reject(new ApiError('http',{status:404}));await opening;
  assert.equal(run.state.history.open,false);assert.ok(run.state.response);
});

test('history generation, deadlines and disposal reject late responses after A to B to A',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});const pending=[];
  const run=setup(t,(resource,options)=>{if(resource!=='history')return Promise.resolve(response(resource,options));const wait=deferred();pending.push({...wait,signal:options.signal});return wait.promise;},{timeoutMs:20});
  await run.owner.load();const a=run.owner.toggleHistory();await flush();const b=run.owner.select('18');await flush();const again=run.owner.select('17');await flush();
  pending[0].reject(new ApiError('http',{status:403}));pending[1].resolve(historyPage([historyRow('2')]));pending[2].resolve(historyPage([historyRow('3')]));await Promise.all([a,b,again]);
  assert.equal(run.state.history.page.data[0].execution_id,'3');const refreshing=run.owner.refresh();await flush();t.mock.timers.tick(20);assert.ok(pending[3].signal.aborted);
  pending[3].reject(new Error('abort'));await refreshing;assert.equal(run.state.history.error.kind,'timeout');
  const retry=run.owner.retryHistory();await flush();const state=run.state;run.owner.dispose();pending[4].resolve(historyPage());await retry;assert.equal(run.state,state);
});

test('history UI keeps actual and estimated timing separate, preserves lexical identity and links only valid selection',async t=>{
  const rows=[historyRow('3',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null,estimate:estimate()}),historyRow('2'),historyRow('1',{estimate:estimate({sample_count:1,duration_seconds:10,ended_at:'2026-10-17T16:00:10.1234567Z'})})];
  const dom=screen(t,async(resource,options)=>resource==='history'?historyPage(rows):response(resource,options));await flush();click(dom,'history-toggle');await flush();
  const first=dom.historyBody.children[0];assert.equal(first.children.length,6);assert.match(first.children[4].textContent,/— · elapsed/);
  assert.equal(first.children[3].textContent,'—');assert.match(first.children[5].textContent,/ends .*\(5\)/);
  assert.equal(first.children[5].children[1].children[0].getAttribute('datetime'),wireTime);assert.equal(first.children[0].children[0].href,'/ops/app/executions/3');
  assert.equal(dom.historyBody.children[1].children[5].children[0].textContent,'Unavailable');assert.equal(dom.get('history-custom').getAttribute('aria-pressed'),'false');
  assert.match(dom.get('history-status').textContent,/3 executions on this page/);
});

test('history status drafts survive order changes and refresh; Apply validates nonempty scope without inheriting dates',async t=>{
  const dom=screen(t,async(resource,options)=>resource==='history'?historyPage([],{direction:options.params.direction,limit:options.params.limit}):response(resource,options));await flush();click(dom,'history-toggle');await flush();
  click(dom,'history-custom');const inputs=dom.get('history-choices').children.map(label=>label.children[0]);for(const input of inputs)input.checked=['2','4','7'].includes(input.value);
  dom.get('history-header-execution_id').dispatchEvent(new Event('click'));await flush();assert.ok(inputs[3].checked);assert.equal(dom.calls.at(-1).params.status,allQuery.status);
  dom.get('history-filters').dispatchEvent(new Event('submit'));await flush();assert.equal(dom.calls.at(-1).params.status,'2,4,7');
  click(dom,'history-custom');for(const input of inputs)input.checked=false;const count=dom.calls.length;dom.get('history-filters').dispatchEvent(new Event('submit'));assert.equal(dom.calls.length,count);assert.match(dom.get('history-notice').textContent,/Choose at least one/);
});

test('live estimate loss clears previous estimate text while keyed link focus, draft and scroll survive refresh',async t=>{
  let changed=false;const dom=screen(t,async(resource,options)=>resource==='history'?historyPage([historyRow('1',{estimate:changed?null:estimate()})]):response(resource,options));
  await flush();click(dom,'history-toggle');await flush();const row=dom.historyBody.children[0],link=row.children[0].children[0];dom.get('history-scroll').scrollLeft=120;
  changed=true;click(dom,'detail-refresh');link.focus();await flush();assert.equal(dom.historyBody.children[0],row);assert.equal(dom.document.activeElement,link);
  assert.equal(dom.get('history-scroll').scrollLeft,120);assert.doesNotMatch(row.children[5].textContent,/Mean of|Estimated duration/);assert.equal(row.children[5].children[1].textContent,'—');
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

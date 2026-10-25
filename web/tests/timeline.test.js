import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiError} from '../src/api.js';
import {readMetadata} from '../src/bootstrap.js';
import {createDisplay} from '../src/display.js';
import {createOverview} from '../src/overview.js';
import {mountOverview} from '../src/render-overview.js';
import {defaultSelection,validateSelection} from '../src/selection.js';
import {readTimeline,timelineParams} from '../src/timeline.js';
import {deferred} from './fixtures.js';
import {overviewDOM} from './overview-dom.js';
import {overviewPage,timelineBucket,timelineFrom,timelineMetadata,timelinePage,timelineSummary,timelineTo} from './timeline-fixture.js';
const metadata=timelineMetadata(),selection=changes=>validateSelection({...defaultSelection(metadata),...changes},metadata);
const display=createDisplay({timeZone:metadata.display_timezone}),flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=(resource,{params})=>resource==='executions'?overviewPage():resource==='metrics/summary'?timelineSummary():timelinePage(undefined,{bucket:params.bucket,selected_statuses:params.status?.split(',').map(Number)??[]});
function setup(t,get=async(...args)=>response(...args),options={}){const calls=[],states=[];const owner=createOverview({metadata,autoRefresh:false,...options,api:{get(resource,options){calls.push({resource,...options});return get(resource,options);}},publish:state=>states.push(state)});t.after(owner.dispose);return{owner,calls,states,get state(){return states.at(-1);}};}
const click=(dom,key)=>dom.get(key).dispatchEvent(new Event('click'));
function screen(t,get=async(...args)=>response(...args),options={}){const dom=overviewDOM(),calls=[];const view=mountOverview(dom.root,{metadata,appBase:'/ops/app/',...options,api:{get(resource,options){calls.push({resource,...options});return get(resource,options);}}});t.after(view.dispose);return{...dom,view,calls};}

test('timeline uses exact effective bounds and selected statuses without list sort/limit/cursor',()=>{
  const value=selection({folder:'all + /\r\n影狼',status:[7,2]});
  assert.deepEqual(timelineParams(value,overviewPage(),'hour'),{folder:value.folder,project:null,from:timelineFrom,to:timelineTo,status:'2,7',bucket:'hour'});
  assert.equal('status' in timelineParams(selection(),overviewPage(),'day'),false);
  assert.throws(()=>timelineParams(value,overviewPage(),'week'));
  for(const max of [undefined,0,1001,1.5]){const settings=timelineMetadata();settings.limits.max_timeline_buckets=max;assert.throws(()=>readMetadata(settings));}
});

test('timeline preserves partial calendar edges and distinct repeated hours without reconstructing local time',()=>{
  const bounds={from:'2026-10-25T00:20:00.0000001Z',to:'2026-10-25T01:30:00.0000002Z'};
  const rows=[timelineBucket('2026-10-25T00:00:00.0000000Z','2026-10-25T01:00:00.0000000Z'),timelineBucket('2026-10-25T01:00:00.0000000Z','2026-10-25T02:00:00.0000000Z')];
  const page=timelinePage(rows,{...bounds,bucket:'hour'});assert.equal(readTimeline(page,selection(),overviewPage(bounds),'hour',metadata,display),page);
  for(const [from,to,hours] of [['2026-03-29T00:00:00.0000000Z','2026-03-29T23:00:00.0000000Z',23],['2026-10-24T23:00:00.0000000Z','2026-10-26T00:00:00.0000000Z',25]]){
    const day=timelinePage([timelineBucket(from,to)],{from,to});assert.equal(readTimeline(day,selection(),overviewPage({from,to}),'day',metadata,display).data.length,1);
    assert.equal((Date.parse(to)-Date.parse(from))/3600000,hours);
  }
});

test('timeline fails closed on scope/timezone/bucket mismatches, gaps, overlaps, limits and inconsistent counts',()=>{
  const mutations=[p=>{p.meta.from=timelineTo;},p=>{p.meta.timezone='UTC';},p=>{p.meta.bucket='hour';},p=>{p.meta.selected_statuses=[2];},
    p=>{p.data=[];},p=>{p.data[0].start=timelineTo;},p=>{p.data[0].end=timelineFrom;},p=>{p.data[0].start=null;},
    p=>{p.data[0].created_count=null;},p=>{p.data[0].started_count=11;},p=>{p.data[0].failed_count=8;},p=>{p.data[0].created_count=0.1;},
    p=>{p.data[0].created_count=Number.MAX_SAFE_INTEGER+1;},p=>{p.data[0].created_count=-1;},p=>{p.data.push(p.data[0]);}];
  for(const mutate of mutations){const page=timelinePage();mutate(page);assert.throws(()=>readTimeline(page,selection(),overviewPage(),'day',metadata,display),e=>e.kind==='invalid_response');}
  assert.throws(()=>readTimeline(timelinePage(),selection(),overviewPage(),'day',{...metadata,limits:{...metadata.limits,max_timeline_buckets:0}},display));
  const rows=[timelineBucket('2026-10-17T00:00:00.0000000Z','2026-10-17T01:00:00.0000000Z'),timelineBucket('2026-10-17T02:00:00.0000000Z','2026-10-18T00:00:00.0000000Z')];
  assert.throws(()=>readTimeline(timelinePage(rows),selection(),overviewPage(),'day',metadata,display));
});

test('timeline is lazy and joins one serial list-summary-timeline refresh using list-effective bounds',async t=>{
  let active=0,peak=0;const run=setup(t,async(...args)=>{peak=Math.max(peak,++active);await flush();active--;return response(...args);});
  await run.owner.apply(selection({status:[2]}));assert.equal(run.calls.length,2);await run.owner.toggleTimeline();assert.equal(run.calls.length,3);
  const start=run.calls.length;await run.owner.refresh();assert.deepEqual(run.calls.slice(start).map(c=>c.resource),['executions','metrics/summary','metrics/timeline']);assert.equal(peak,1);
  assert.equal(run.calls.at(-2).params.status,undefined);assert.equal(run.calls.at(-1).params.status,'2');
  await run.owner.setTimelineBucket('hour');assert.equal(run.calls.at(-1).params.bucket,'hour');assert.equal(run.calls.length,start+4);
  await run.owner.toggleTimeline();await run.owner.refresh();assert.equal(run.calls.at(-1).resource,'metrics/summary');assert.equal(run.state.timeline.page,null);
});

test('opening during list work queues timeline; closing before summary completes skips it',async t=>{
  const list=deferred(),summary=deferred();const run=setup(t,resource=>resource==='executions'?list.promise:summary.promise,{restoreTimeline:{open:true,bucket:'hour'}});
  const loading=run.owner.apply(selection());list.resolve(overviewPage());await flush();assert.equal(run.state.phase,'loading-summary');await run.owner.toggleTimeline();
  summary.resolve(timelineSummary());await loading;assert.equal(run.calls.length,2);assert.equal(run.state.timeline.open,false);
});

test('closing an active timeline aborts only that read and rejects its late denial',async t=>{
  const wait=deferred();const run=setup(t,(resource,options)=>resource==='metrics/timeline'?wait.promise:Promise.resolve(response(resource,options)));
  await run.owner.apply(selection());const opening=run.owner.toggleTimeline();const signal=run.calls.at(-1).signal;await run.owner.toggleTimeline();assert.ok(signal.aborted);
  wait.reject(new ApiError('http',{status:403}));await opening;assert.ok(run.state.page);assert.ok(run.state.summary);assert.equal(run.state.phase,'ready');
});

test('newly resolved default bounds clear old timeline counts before a failed replacement read',async t=>{
  const nextFrom='2026-10-17T00:00:00.0000002Z';let changed=false;const wait=deferred();
  const run=setup(t,async(resource,options)=>{if(resource==='executions')return overviewPage(changed?{from:nextFrom}:{});
    if(resource==='metrics/summary')return timelineSummary(changed?{from:nextFrom}:{});return changed?wait.promise:timelinePage();});
  await run.owner.apply(selection());await run.owner.toggleTimeline();changed=true;const refreshing=run.owner.refresh();await flush();
  assert.equal(run.state.timeline.page,null);assert.equal(run.calls.at(-1).params.from,nextFrom);wait.reject(new ApiError('http',{status:503}));await refreshing;
  assert.equal(run.state.timeline.page,null);assert.equal(run.state.timeline.stale,false);
});

test('timeline transient errors retain a labeled same-cohort observation; invalid/400 clear only it and denial clears all',async t=>{
  for(const error of [new ApiError('http',{status:503}),new ApiError('http',{status:400}),new ApiError('invalid_response'),new ApiError('http',{status:403})]){
    let fail=false;const run=setup(t,async(resource,options)=>{if(fail&&resource==='metrics/timeline')throw error;return response(resource,options);});
    await run.owner.apply(selection());await run.owner.toggleTimeline();fail=true;await run.owner.refresh();
    assert.equal(run.state.timeline.page!==null,error.status===503);assert.equal(run.state.page!==null,error.status!==403);assert.equal(run.state.summary!==null,error.status!==403);
    if(error.status===503){fail=false;const start=run.calls.length;await run.owner.retryTimeline();assert.equal(run.calls.length,start+1);assert.equal(run.state.timeline.error,null);}
  }
});

test('summary failure remains independent and its retry refreshes open timeline without another list',async t=>{
  let fail=true;const run=setup(t,async(resource,options)=>{if(fail&&resource==='metrics/summary')throw new ApiError('http',{status:503});return response(resource,options);},{restoreTimeline:{open:true}});
  await run.owner.apply(selection());assert.equal(run.state.phase,'summary-error');assert.ok(run.state.timeline.page);assert.equal(run.calls.length,3);
  fail=false;await run.owner.retrySummary();assert.equal(run.calls.length,5);assert.equal(run.calls.at(-2).resource,'metrics/summary');assert.equal(run.state.phase,'ready');
});

test('A-to-B-to-A selection and disposal suppress old timeline successes and failures',async t=>{
  const pending=[];const run=setup(t,(resource,options)=>{if(resource!=='metrics/timeline')return Promise.resolve(response(resource,options));const wait=deferred();pending.push(wait);return wait.promise;},{restoreTimeline:{open:true}});
  const a=run.owner.apply(selection());await flush();const b=run.owner.apply(selection({folder:'B'}));await flush();const again=run.owner.apply(selection());await flush();
  pending[0].reject(new ApiError('http',{status:403}));pending[1].resolve(timelinePage());pending[2].resolve(timelinePage());await Promise.all([a,b,again]);assert.ok(run.state.timeline.page);assert.equal(run.state.selection.folder,null);
  const refreshing=run.owner.refresh();await flush();run.owner.dispose();pending[3].resolve(timelinePage());await refreshing;assert.equal(run.state.timeline.page,null);
});

test('one completion-based timer coalesces refresh and visible return behind timeline work',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});const wait=deferred();let slow=true;
  const run=setup(t,(resource,options)=>resource==='metrics/timeline'&&slow?wait.promise:Promise.resolve(response(resource,options)),{autoRefresh:true,pollIntervalMs:100});
  await run.owner.apply(selection());const opening=run.owner.toggleTimeline();t.mock.timers.tick(1000);await run.owner.refresh();run.owner.setVisible(false);run.owner.setVisible(true);assert.equal(run.calls.length,3);
  slow=false;wait.resolve(timelinePage());await opening;t.mock.timers.tick(0);await flush();assert.equal(run.calls.length,6);
  t.mock.timers.tick(99);await flush();assert.equal(run.calls.length,6);t.mock.timers.tick(1);await flush();assert.equal(run.calls.length,9);
});

test('zero buckets have a chart, keyboard selector and complete data table without inventing missing data',async t=>{
  const zero=timelinePage([timelineBucket(undefined,undefined,{created_count:0,started_count:0,succeeded_count:0,failed_count:0})]);
  const dom=screen(t,async(resource,options)=>resource==='metrics/timeline'?zero:response(resource,options));await dom.view.apply(selection());click(dom,'timeline-toggle');await flush();
  assert.equal(dom.get('timeline-chart').children.length,1);assert.equal(dom.get('timeline-chart').children[0].children[1].getAttribute('height'),'0');assert.equal(dom.get('timeline-zero').hidden,false);
  assert.equal(dom.timelineBody.children[0].children.length,7);assert.equal(dom.timelineBody.children[0].children[2].textContent,'0');assert.equal(dom.get('timeline-choice').children.length,1);
  assert.equal(dom.timelineBody.children[0].children[0].children[0].getAttribute('datetime'),zero.data[0].start);assert.match(dom.get('timeline-scope').textContent,/All statuses/);
});

test('stacked chart, selected repeated hour, table/focus/scroll survive refresh and value-free checkpoint restoration',async t=>{
  const bounds={from:'2026-10-25T00:00:00.0000000Z',to:'2026-10-25T02:00:00.0000000Z'};
  const rows=[timelineBucket(bounds.from,'2026-10-25T01:00:00.0000000Z'),timelineBucket('2026-10-25T01:00:00.0000000Z',bounds.to)];
  const get=async(resource,options)=>resource==='executions'?overviewPage(bounds):resource==='metrics/summary'?timelineSummary(bounds):timelinePage(rows,{...bounds,bucket:options.params.bucket});
  const dom=screen(t,get);await dom.view.apply(selection());click(dom,'timeline-toggle');await flush();
  const first=dom.get('timeline-choice').children[0],second=dom.get('timeline-choice').children[1];assert.notEqual(first.textContent,second.textContent);
  assert.equal(first.textContent,'2026-10-25 01:00:00 (UTC+01:00) → 2026-10-25 01:00:00 (UTC+00:00)');
  assert.equal(second.textContent,'2026-10-25 01:00:00 (UTC+00:00) → 2026-10-25 02:00:00');
  assert.equal(dom.timelineBody.children[0].children[0].firstChild.textContent,'2026-10-25 01:00:00 (UTC+01:00)');
  assert.equal(dom.timelineBody.children[0].children[1].firstChild.textContent,'2026-10-25 01:00:00 (UTC+00:00)');
  assert.equal(first.title,`${rows[0].start} → ${rows[0].end}`);
  assert.equal(second.title,`${rows[1].start} → ${rows[1].end}`);
  dom.get('timeline-choice').value=rows[1].start;dom.get('timeline-choice').dispatchEvent(new Event('change'));
  dom.get('timeline-values').open=true;dom.get('timeline-scroll').scrollLeft=120;
  const option=dom.get('timeline-choice').children[1];const refreshing=dom.view.refresh();dom.get('timeline-choice').focus();await refreshing;
  assert.equal(dom.get('timeline-choice').children[1],option);assert.equal(dom.get('timeline-choice').value,rows[1].start);assert.equal(dom.document.activeElement,dom.get('timeline-choice'));assert.equal(dom.get('timeline-scroll').scrollLeft,120);
  const saved=dom.view.checkpoint();assert.doesNotMatch(JSON.stringify(saved.view.timeline),/"(?:data|meta|created_count|failed_count)":/);dom.view.dispose();
  const restored=screen(t,get,{restoreView:saved.view,retainedPaths:saved.paths});await restored.view.apply(selection(),{restore:true});assert.equal(restored.get('timeline-choice').value,rows[1].start);assert.equal(restored.get('timeline-values').open,true);
});

test('timeline renders the full advertised 1000-bucket maximum without truncating its data alternative',async t=>{
  const from='2026-01-01T00:00:00.0000000Z',stamp=hours=>new Date(Date.UTC(2026,0,1,hours)).toISOString().replace('.000Z','.0000000Z');const to=stamp(1000);
  const rows=Array.from({length:1000},(_,i)=>timelineBucket(stamp(i),stamp(i+1)));
  const settings=timelineMetadata();settings.limits.max_range_hours=1200;
  const get=async(resource,options)=>resource==='executions'?overviewPage({from,to}):resource==='metrics/summary'?timelineSummary({from,to}):timelinePage(rows,{from,to,bucket:options.params.bucket});
  const dom=screen(t,get,{metadata:settings,restoreView:{timeline:{open:true,bucket:'hour'}}});await dom.view.apply(selection());
  assert.equal(dom.get('timeline-chart').children.length,1000);assert.equal(dom.timelineBody.children.length,1000);assert.equal(dom.get('timeline-choice').children.length,1000);
  assert.throws(()=>readTimeline(timelinePage([...rows,rows[0]],{from,to}),selection(),overviewPage({from,to}),'day',settings,display));
});

test('closing timeline cannot restart polling blocked by a malformed summary',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const run=setup(t,async(resource,options)=>{if(resource==='metrics/summary')throw new ApiError('invalid_response');return response(resource,options);},{autoRefresh:true,restoreTimeline:{open:true}});
  await run.owner.apply(selection());assert.equal(run.state.poll.mode,'blocked');await run.owner.toggleTimeline();const count=run.calls.length;
  t.mock.timers.tick(300000);await flush();assert.equal(run.calls.length,count);assert.equal(run.state.poll.mode,'blocked');
});

test('a timeline deadline retains only its current cohort and exposes a safe timeout without accepting late data',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});const wait=deferred();let slow=false;
  const run=setup(t,(resource,options)=>resource==='metrics/timeline'&&slow?wait.promise:Promise.resolve(response(resource,options)),{timeoutMs:20});
  await run.owner.apply(selection());await run.owner.toggleTimeline();slow=true;const refreshing=run.owner.refresh();await flush();t.mock.timers.tick(20);
  assert.equal(run.calls.at(-1).signal.aborted,true);wait.resolve(timelinePage());await refreshing;
  assert.equal(run.state.timeline.error.kind,'timeout');assert.equal(run.state.timeline.stale,true);assert.ok(run.state.page);
});

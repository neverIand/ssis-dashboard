import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(timelineParams(value,overviewPage(),'hour'),{folder:value.folder,project:null,package:null,from:timelineFrom,to:timelineTo,status:'2,7',bucket:'hour'});
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
    p=>{p.data[0].created_count=Number.MAX_SAFE_INTEGER+1;},p=>{p.data[0].created_count=-1;},p=>{p.data.push(p.data[0]);},
    p=>{p.data[0].halted_count=null;},p=>{delete p.data[0].halted_count;},p=>{p.data[0].halted_count=6;}];
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
  const kept=run.state.timeline.page;await run.owner.toggleTimeline();assert.equal(run.state.timeline.page,kept);
  await run.owner.refresh();assert.equal(run.calls.at(-1).resource,'metrics/summary');assert.equal(run.state.timeline.page,kept);
  // Reopening after the list moved on shows the kept chart as stale and reads the timeline once.
  const before=run.calls.length;await run.owner.toggleTimeline();assert.equal(run.calls.length,before+1);assert.equal(run.calls.at(-1).resource,'metrics/timeline');
  // Reopening with nothing new since the last read makes no request.
  await run.owner.toggleTimeline();await run.owner.toggleTimeline();assert.equal(run.calls.length,before+1);assert.equal(run.state.timeline.stale,false);
});

test('a kept timeline stays stale until a read succeeds: reopening after the list moved on or after a failed read',async t=>{
  let fail=false,wait=null;const run=setup(t,async(resource,options)=>{
    if(resource==='metrics/timeline'){if(wait)await wait.promise;if(fail)throw new ApiError('http',{status:503});}
    return response(resource,options);});
  await run.owner.apply(selection());await run.owner.toggleTimeline();const kept=run.state.timeline.page;assert.notEqual(kept,null);
  await run.owner.toggleTimeline();await run.owner.refresh();
  wait=deferred();const reopening=run.owner.toggleTimeline();await flush();
  assert.equal(run.state.timeline.page,kept);assert.equal(run.state.timeline.stale,true);assert.equal(run.calls.at(-1).resource,'metrics/timeline');
  wait.resolve();wait=null;await reopening;assert.equal(run.state.timeline.stale,false);
  // A failed read of the same list page keeps its error and stale chart across close and reopen, and reopening reads again.
  fail=true;await run.owner.retryTimeline();assert.equal(run.state.timeline.error?.status,503);assert.equal(run.state.timeline.stale,true);
  await run.owner.toggleTimeline();assert.equal(run.state.timeline.error?.status,503);assert.equal(run.state.timeline.stale,true);
  fail=false;const before=run.calls.length;await run.owner.toggleTimeline();
  assert.equal(run.calls.length,before+1);assert.equal(run.state.timeline.error,null);assert.equal(run.state.timeline.stale,false);
});

test('a list refresh that failed while the timeline was hidden: reopening keeps the stale chart and reads the list first',async t=>{
  let failList=false,list=null;const run=setup(t,async(resource,options)=>{
    if(resource==='executions'){if(list)await list.promise;if(failList)throw new ApiError('http',{status:503});}
    return response(resource,options);});
  await run.owner.apply(selection());await run.owner.toggleTimeline();const kept=run.state.timeline.page;
  await run.owner.toggleTimeline();failList=true;await run.owner.refresh();assert.equal(run.state.pageStale,true);
  failList=false;list=deferred();const before=run.calls.length;const reopening=run.owner.toggleTimeline();await flush();
  assert.equal(run.state.timeline.page,kept);assert.equal(run.state.timeline.stale,true);
  assert.deepEqual(run.calls.slice(before).map(call=>call.resource),['executions']);
  list.resolve();list=null;await reopening;
  assert.deepEqual(run.calls.slice(before).map(call=>call.resource),['executions','metrics/summary','metrics/timeline']);
  assert.equal(run.state.timeline.stale,false);assert.equal(run.state.pageStale,false);
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
  slow=false;wait.resolve(timelinePage());await opening;t.mock.timers.tick(0);await flush();assert.equal(run.calls.length,3);
  assert.equal(run.state.poll.nextAt,6000);t.mock.timers.tick(4999);await flush();assert.equal(run.calls.length,3);
  t.mock.timers.tick(1);await flush();assert.equal(run.calls.length,6);
  t.mock.timers.tick(99);await flush();assert.equal(run.calls.length,6);t.mock.timers.tick(1);await flush();assert.equal(run.calls.length,9);
});

test('a window longer than the hour-bucket cap disables Hour and reads Day instead of a certain 400',async t=>{
  // The fixture window is 18 hours plus a fraction, so 18 hour buckets cannot hold it and 19 can.
  const capped=max=>({...metadata,limits:{...metadata.limits,max_timeline_buckets:max}});
  const run=setup(t,undefined,{metadata:capped(18),restoreTimeline:{open:true,bucket:'hour'}});await run.owner.apply(selection());
  assert.equal(run.calls.at(-1).params.bucket,'day');assert.equal(run.state.timeline.bucket,'day');
  const reads=run.calls.length;await run.owner.setTimelineBucket('hour');assert.equal(run.calls.length,reads);assert.equal(run.state.timeline.bucket,'day');
  const roomy=setup(t,undefined,{metadata:capped(19)});await roomy.owner.apply(selection());await roomy.owner.toggleTimeline();
  await roomy.owner.setTimelineBucket('hour');assert.equal(roomy.calls.at(-1).params.bucket,'hour');
  for(const [max,disabled] of [[18,true],[19,false]]){
    const dom=screen(t,undefined,{metadata:capped(max)});await dom.view.apply(selection());click(dom,'timeline-toggle');await flush();
    const hour=dom.get('timeline-bucket').querySelector('option[value="hour"]');assert.equal(hour.disabled,disabled);
    assert.equal(hour.title,disabled ? 'Hour needs a creation range of 18 hours or less.' : '');
  }
});

test('a timeline Retry keeps its button and says Retrying… until the read ends',async t=>{
  let fail=true,wait=null;const dom=screen(t,async(resource,options)=>{
    if(resource==='metrics/timeline'){if(wait)await wait.promise;if(fail)throw new ApiError('http',{status:503});}
    return response(resource,options);});
  await dom.view.apply(selection());click(dom,'timeline-toggle');await flush();
  const retry=dom.get('timeline-retry'),status=dom.get('timeline-status');assert.equal(retry.hidden,false);
  fail=false;wait=deferred();click(dom,'timeline-retry');await flush();
  assert.equal(retry.hidden,false);assert.match(status.textContent,/^Retrying…/);
  wait.resolve();wait=null;await flush();await flush();
  assert.equal(retry.hidden,true);assert.doesNotMatch(status.textContent,/Retrying/);
  // A Retry replaced by a new selection ends with it: the new read does not say Retrying….
  fail=true;await dom.view.refresh();await flush();assert.equal(retry.hidden,false);
  fail=false;wait=deferred();click(dom,'timeline-retry');await flush();assert.match(status.textContent,/^Retrying…/);
  const changing=dom.view.apply(selection({folder:'Other'}));await flush();
  assert.doesNotMatch(status.textContent,/Retrying/);
  wait.resolve();wait=null;await changing;await flush();assert.doesNotMatch(status.textContent,/Retrying/);
});

test('a lone bucket keeps a narrow, centred bar instead of filling the plot',async t=>{
  const one=timelinePage([timelineBucket()]);
  const dom=screen(t,async(resource,options)=>resource==='metrics/timeline'?one:response(resource,options));await dom.view.apply(selection());
  click(dom,'timeline-toggle');await flush();
  const group=dom.get('timeline-chart').children[0],bars=[...group.children].filter(node=>node.dataset.chartStatus);
  assert.equal(bars.length,3);for(const bar of bars){assert.equal(bar.getAttribute('width'),'60');assert.equal(bar.getAttribute('x'),'470');}
  const hit=[...group.children].find(node=>node.dataset.chartHit);assert.equal(hit.getAttribute('x'),'0');assert.equal(hit.getAttribute('width'),'1000');
});

test('zero buckets have a chart, keyboard selector and complete data table without inventing missing data',async t=>{
  const zero=timelinePage([timelineBucket(undefined,undefined,{created_count:0,started_count:0,succeeded_count:0,failed_count:0})]);
  const dom=screen(t,async(resource,options)=>resource==='metrics/timeline'?zero:response(resource,options));await dom.view.apply(selection());
  assert.equal(dom.get('timeline-toggle').getAttribute('aria-expanded'),'false');assert.equal(dom.get('timeline-toggle').getAttribute('aria-pressed'),null);
  click(dom,'timeline-toggle');await flush();
  assert.equal(dom.get('timeline-toggle').getAttribute('aria-expanded'),'true');assert.equal(dom.get('timeline-toggle').getAttribute('aria-pressed'),null);
  assert.equal(dom.get('timeline-chart').children.length,1);assert.equal(dom.get('timeline-chart').children[0].children[1].getAttribute('height'),'0');assert.equal(dom.get('timeline-zero').hidden,false);
  assert.equal(dom.timelineBody.children[0].children.length,7);assert.equal(dom.timelineBody.children[0].children[2].textContent,'0');assert.equal(dom.get('timeline-choice').children.length,1);
  assert.equal(dom.timelineBody.children[0].children[0].children[0].getAttribute('datetime'),zero.data[0].start);assert.match(dom.get('timeline-scope').textContent,/All statuses/);
  const reads=dom.calls.length;click(dom,'timeline-toggle');await flush();
  assert.equal(dom.get('timeline-toggle').getAttribute('aria-expanded'),'false');assert.equal(dom.get('timeline-toggle').getAttribute('aria-pressed'),null);assert.equal(dom.calls.length,reads);
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
  // The offsets already tell the repeated hours apart; no raw-ISO hover text repeats them.
  assert.equal(first.title ?? '','');assert.equal(second.title ?? '','');
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

const drillMetadata = timelineMetadata();
const drillSelection = () => validateSelection(defaultSelection(drillMetadata), drillMetadata);
function drillScreen(t, { list = () => overviewPage(), summary = () => timelineSummary(), timeline = () => timelinePage() } = {}) {
  const dom = overviewDOM(), selected = [], calls = [];
  const view = mountOverview(dom.root, { metadata: drillMetadata, appBase: '/ops/app/', onSelect: changes => selected.push(changes),
    api: { async get(resource, options) {
      calls.push(resource);
      return resource === 'executions' ? list(options) : resource === 'metrics/summary' ? summary(options) : timeline(options);
    } } });
  t.after(view.dispose);
  return { ...dom, view, selected, calls };
}
const fire = (svg, type, target, key) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  if (key) Object.defineProperty(event, 'key', { value: key });
  svg.dispatchEvent(event);
};

test('O6: Enter, double click or the button filter the list to a bucket, clamped to the applied window', async t => {
  // The day bucket starts before and ends after the applied window, so both edges must be clamped.
  const dom = drillScreen(t, { timeline: () => timelinePage([timelineBucket('2026-10-16T23:00:00.0000000Z', '2026-10-17T23:00:00.0000000Z')]) });
  await dom.view.apply(drillSelection());
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart'), bar = svg.children[0];
  assert.equal(dom.get('timeline-drill').hidden, false);
  const reads = dom.calls.length;
  fire(svg, 'keydown', bar, 'ArrowRight');
  assert.equal(dom.selected.length, 0, 'arrows only select');
  fire(svg, 'keydown', bar, 'Enter');
  fire(svg, 'dblclick', bar);
  dom.get('timeline-drill').dispatchEvent(new Event('click'));
  const expected = { created: null, from: timelineFrom, to: timelineTo };
  assert.deepEqual(dom.selected, [expected, expected, expected]);
  assert.equal(dom.calls.length, reads, 'the drill itself reads nothing; the selection change does');
});

test('O6: an inner bucket keeps its own server bounds', async t => {
  const from = '2026-10-15T23:00:00.0000000Z', to = '2026-10-18T23:00:00.0000000Z';
  const day = (start, end) => timelineBucket(start, end, { created_count: 1, started_count: 1, succeeded_count: 1, failed_count: 0 });
  const buckets = [day(from, '2026-10-16T23:00:00.0000000Z'), day('2026-10-16T23:00:00.0000000Z', '2026-10-17T23:00:00.0000000Z'),
    day('2026-10-17T23:00:00.0000000Z', to)];
  const dom = drillScreen(t, { list: () => overviewPage({ from, to }), summary: () => timelineSummary({ from, to }),
    timeline: () => timelinePage(buckets, { from, to }) });
  await dom.view.apply(validateSelection({ ...defaultSelection(drillMetadata), from, to }, drillMetadata));
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart');
  assert.equal(svg.children.length, 3);
  fire(svg, 'keydown', svg.children[1], 'Enter');
  assert.deepEqual(dom.selected.at(-1), { created: null, from: buckets[1].start, to: buckets[1].end });
});

test('R1-3/5: Enter drill moves keyboard focus to the list; a cleared chart hides Show this bucket', async t => {
  let broken = false;
  const dom = drillScreen(t, { timeline: () => { if (broken) throw new ApiError('http', { status: 400 }); return timelinePage(); } });
  await dom.view.apply(drillSelection());
  dom.get('timeline-toggle').dispatchEvent(new Event('click')); await flush();
  const svg = dom.get('timeline-chart'), bar = svg.children[0];
  bar.focus();
  fire(svg, 'keydown', bar, 'Enter');
  assert.equal(dom.document.activeElement, dom.scroll, 'focus follows the filtered list');
  dom.get('timeline-drill').focus();
  broken = true;
  await dom.view.refresh(); await flush();
  assert.equal(dom.get('timeline-drill').hidden, true);
  assert.notEqual(dom.document.activeElement, dom.get('timeline-drill'));
});

const clickNode=node=>node.dispatchEvent(new Event('click'));
const stamp=day=>`2026-10-${String(day).padStart(2,'0')}T00:00:00.0000000Z`;
function interaction(svg,type,target,key){
  const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:target});
  if(key!==undefined)Object.defineProperty(event,'key',{value:key});
  svg.dispatchEvent(event);return event;
}
async function timelineScreen(t,rows,metadata=timelineMetadata()){
  const dom=overviewDOM(),calls=[],bounds={from:rows[0].start,to:rows.at(-1).end};
  const view=mountOverview(dom.root,{metadata,appBase:'/app/',api:{async get(resource,options){
    calls.push({resource,...options});return resource==='executions'?overviewPage(bounds):resource==='metrics/summary'?timelineSummary(bounds):timelinePage(rows,{...bounds,bucket:options.params.bucket});
  }}});t.after(view.dispose);await view.apply(defaultSelection(metadata));clickNode(dom.get('timeline-toggle'));await flush();
  return {...dom,calls,view};
}
const emptyBucket=(day)=>timelineBucket(stamp(day),stamp(day+1),{created_count:0,started_count:0,succeeded_count:0,failed_count:0});

test('zero markers show up to 31 buckets and stop at 32',async t=>{
  const at=i=>new Date(Date.UTC(2026,9,1+i)).toISOString().replace('.000Z','.0000000Z');
  const rows=n=>Array.from({length:n},(_,i)=>timelineBucket(at(i),at(i+1),i?{created_count:0,started_count:0,succeeded_count:0,failed_count:0}:{}));
  const markers=dom=>[...dom.get('timeline-chart').children].map(group=>[...group.children].find(node=>node.dataset.zero).getAttribute('display'));
  const month=markers(await timelineScreen(t,rows(31)));assert.equal(month.length,31);assert.equal(month.filter(value=>value==='inline').length,30);
  const wide=timelineMetadata();wide.limits.max_range_hours=2000;
  const longer=markers(await timelineScreen(t,rows(32),wide));assert.equal(longer.length,32);assert.ok(longer.every(value=>value==='none'));
});

test('timeline shows succeeded/failed/other stacks, chronological labels and the latest non-empty default',async t=>{
  const rows=[emptyBucket(14),timelineBucket(stamp(15),stamp(16),{created_count:10,started_count:9,succeeded_count:6,failed_count:3}),
    timelineBucket(stamp(16),stamp(17),{created_count:3,started_count:3,succeeded_count:2,failed_count:1}),emptyBucket(17)];
  const dom=await timelineScreen(t,rows),groups=dom.get('timeline-chart').children;
  assert.deepEqual(groups.map(row=>row.dataset.bucketStart),rows.map(row=>row.start));assert.equal(dom.get('timeline-choice').value,stamp(16));
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>node.dataset.chartStatus),['7','4','other']);
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>Number(node.getAttribute('height'))),[90,45,15]);
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>Number(node.getAttribute('y'))),[70,25,10]);
  assert.equal(dom.timelineBody.children[1].children[6].textContent,'1');assert.equal(dom.timelineBody.children[2].children[6].textContent,'0');
  assert.deepEqual(dom.get('timeline-y-axis').children.map(node=>node.textContent),['10','5','0']);
  assert.match(dom.get('timeline-x-axis').textContent,/2026-10-14.*2026-10-17/s);
  assert.equal(dom.get('timeline-x-axis').firstChild.title, '2026-10-14 01:00:00');
  assert.equal(dom.get('timeline-status').title, 'Observed 2026-10-17 17:00:00');
  assert.equal(dom.get('timeline-selected').textContent, '2026-10-16 01:00:00 → 2026-10-17 01:00:00 · 3 created: 2 succeeded, 1 failed');
  assert.equal(groups[2].firstChild.textContent, dom.get('timeline-selected').textContent);
  assert.equal(groups[2].getAttribute('aria-label'), groups[2].firstChild.textContent);
  assert.match(groups[1].firstChild.textContent, / · 10 created: 6 succeeded, 3 failed, 1 other, 1 not started$/);
  assert.equal(dom.get('timeline-series'),undefined);
});

test('timeline counts ended-unexpectedly runs (halted_count) with Failed in the bar, table and description',async t=>{
  const rows=[timelineBucket(stamp(15),stamp(16),{created_count:10,started_count:10,succeeded_count:6,failed_count:1,halted_count:2})];
  const dom=await timelineScreen(t,rows),group=dom.get('timeline-chart').children[0];
  assert.deepEqual(group.children.slice(1,4).map(node=>Number(node.getAttribute('height'))),[90,45,15],'failed 1 + halted 2');
  assert.equal(dom.timelineBody.children[0].children[5].textContent,'3');
  assert.match(group.firstChild.textContent,/ · 10 created: 6 succeeded, 3 failed, 1 other$/);
});

test('timeline click and keyboard select complete bucket values locally and keep focused keyed groups on refresh',async t=>{
  const rows=[timelineBucket(stamp(15),stamp(16)),timelineBucket(stamp(16),stamp(17),{created_count:20,started_count:10})];
  const dom=await timelineScreen(t,rows),plot=dom.get('timeline-chart'),first=plot.children[0],last=plot.children[1],count=dom.calls.length;
  interaction(plot,'click',first.children[2]);assert.equal(dom.get('timeline-choice').value,stamp(15));
  interaction(plot,'mouseover',last.children[2]);assert.equal(dom.get('timeline-choice').value,stamp(15)); // hover keeps the clicked bucket
  assert.match(dom.get('timeline-selected').textContent,/ · 10 created: 3 succeeded, 2 failed, 5 other, 2 not started$/);
  first.focus();interaction(plot,'focusin',first);interaction(plot,'keydown',first,'ArrowRight');
  assert.equal(dom.document.activeElement,last);assert.equal(last.getAttribute('aria-selected'),'true');
  interaction(plot,'keydown',last,' ');assert.equal(dom.calls.length,count);
  await dom.view.refresh();assert.equal(plot.children[1],last);assert.equal(dom.document.activeElement,last);
  assert.equal(dom.calls.length,count+3,'One serial list-summary-timeline refresh remains');
  assert.equal(dom.view.checkpoint().view.timeline.focus,'plot');
});

test('all-zero timeline selects the latest loaded bucket with one zero tick and no invented outcome',async t=>{
  const dom=await timelineScreen(t,[emptyBucket(15),emptyBucket(16)]);
  assert.equal(dom.get('timeline-choice').value,stamp(16));assert.equal(dom.get('timeline-zero').hidden,false);
  assert.deepEqual(dom.get('timeline-y-axis').children.map(node=>node.textContent),['0']);
  assert.equal(dom.get('timeline-selected').textContent, '2026-10-16 01:00:00 → 2026-10-17 01:00:00 · none created');
  for(const group of dom.get('timeline-chart').children){
    assert.ok(group.children.slice(1,4).every(node=>node.getAttribute('height')==='0'));
    assert.equal(group.children[4].getAttribute('display'),'inline');
  }
});

test('timeline single-count and maximum-safe outlier scales have finite geometry and integer ticks',async t=>{
  for(const total of [1,Number.MAX_SAFE_INTEGER]){
    const dom=await timelineScreen(t,[timelineBucket(stamp(15),stamp(16),{created_count:total,started_count:total,succeeded_count:total,failed_count:0})]);
    const group=dom.get('timeline-chart').firstChild;
    for(const bar of group.children.slice(1,4))for(const key of ['x','y','width','height'])assert.ok(Number.isFinite(Number(bar.getAttribute(key))));
    assert.equal(group.children[1].getAttribute('height'),'150');
    if(total===1)assert.deepEqual(dom.get('timeline-y-axis').children.map(node=>node.textContent),['1','0']);
  }
});

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('H-07: the timeline opens between the Executions toolbar and its table', () => {
  const html = source('../../dashboard/templates/app/index.html');
  const section = html.indexOf('<section class="executions panel"'), toggle = html.indexOf('data-timeline-toggle');
  const panel = html.indexOf('data-timeline-panel'), table = html.indexOf('data-execution-scroll');
  assert.ok(section < toggle && toggle < panel && panel < table);
  assert.doesNotMatch(html, /class="panel timeline-panel"/);
});

test('rolling refresh with moved bounds clears old timeline counts inside a reserved panel whose data-table row stays put', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata(), timeline = deferred(), nextFrom = '2026-10-17T00:00:00.0000002Z';
  let moved = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource) {
    if (resource === 'executions') return overviewPage(moved ? { from: nextFrom } : {});
    if (resource === 'metrics/summary') return timelineSummary(moved ? { from: nextFrom } : {});
    return moved ? timeline.promise : timelinePage();
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata)); clickNode(dom.get('timeline-toggle')); await flush();
  const panel = dom.get('timeline-panel'), values = dom.get('timeline-values');
  panel.layoutHeight = 299.2;
  moved = true; const refresh = view.refresh(); await flush();
  assert.equal(dom.get('timeline-chart').children.length, 0, 'Counts from the previous bounds are not shown as current');
  assert.equal(dom.get('timeline-selected').textContent, '');
  assert.equal(panel.style.minHeight, '300px');
  assert.equal(panel.getAttribute('data-loading'), '');
  assert.ok(panel.children.includes(values));
  const choiceBox = dom.get('timeline-choice').parentElement;
  assert.equal(dom.get('timeline-choice').children.length, 0);
  assert.equal(choiceBox.style.minWidth, 'min(800px, 100%)', 'Emptied bucket options keep their former width, capped by the line');
  timeline.resolve(timelinePage(undefined, { from: nextFrom })); await refresh;
  assert.equal(panel.style.minHeight, '');
  assert.equal(choiceBox.style.minWidth, '');
  assert.equal(panel.getAttribute('data-loading'), null);
  assert.notEqual(dom.get('timeline-chart').children.length, 0);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.timeline-panel\[data-loading\]:not\(\[hidden\]\) \{ display: flex; flex-direction: column; \}/);
  assert.match(css, /\.timeline-panel\[data-loading\] > details \{ margin-top: auto; \}/);
});

for (const scenario of ['empty retained start', 'non-empty retained start', 'all zero']) {
  test(`timeline grain change: ${scenario} uses the correct fallback with one owned read`, async t => {
    const dom = overviewDOM(), metadata = timelineMetadata(), calls = [];
    const hour = index => new Date(Date.UTC(2026, 9, 17, index)).toISOString().replace('.000Z', '.0000000Z');
    const bounds = { from: hour(0), to: hour(24) };
    const rows = Array.from({ length: 24 }, (_, index) => timelineBucket(hour(index), hour(index + 1), {
      created_count: scenario === 'all zero' ? 0 : index === (scenario === 'non-empty retained start' ? 0 : 17) ? 5 : 0,
      started_count: 0, succeeded_count: 0, failed_count: 0, halted_count: 0,
    }));
    const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
      calls.push({ resource, ...options });
      return resource === 'executions' ? overviewPage(bounds) : resource === 'metrics/summary' ? timelineSummary(bounds)
        : timelinePage(options.params.bucket === 'day' ? [timelineBucket(hour(0), hour(24))] : rows,
          { ...bounds, bucket: options.params.bucket });
    } } });
    t.after(view.dispose);
    await view.apply(defaultSelection(metadata)); clickNode(dom.get('timeline-toggle')); await flush();
    assert.equal(dom.get('timeline-choice').value, hour(0));
    const before = calls.length;
    dom.get('timeline-bucket').value = 'hour'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).params.bucket, 'hour');
    assert.equal(dom.get('timeline-choice').value, hour(scenario === 'all zero' ? 23 : scenario === 'empty retained start' ? 17 : 0));
    dom.get('timeline-choice').value = hour(0); dom.get('timeline-choice').dispatchEvent(new Event('change'));
    await view.refresh();
    assert.equal(dom.get('timeline-choice').value, hour(0), 'Same-grain refresh retains an intentionally selected empty bucket');
    assert.equal(calls.length, before + 4);
  });
}

test('timeline grain fallback survives a failed intermediate grain without claiming a hidden panel is expanded', async t => {
  const dom = overviewDOM(), metadata = timelineMetadata();
  const day = index => `2026-10-${17 + index}T00:00:00.0000000Z`;
  const bounds = { from: day(0), to: day(2) };
  let changed = false;
  const view = mountOverview(dom.root, { metadata, appBase: '/app/', api: { async get(resource, options) {
    if (resource === 'executions') return overviewPage(bounds);
    if (resource === 'metrics/summary') return timelineSummary(bounds);
    if (options.params.bucket === 'hour') throw new ApiError('invalid_request', { status: 400 });
    return timelinePage([0, 1].map(index => timelineBucket(day(index), day(index + 1), {
      created_count: index === (changed ? 1 : 0) ? 5 : 0, started_count: 0, succeeded_count: 0, failed_count: 0, halted_count: 0,
    })), bounds);
  } } });
  t.after(view.dispose);
  await view.apply(defaultSelection(metadata)); clickNode(dom.get('timeline-toggle')); await flush();
  assert.equal(dom.get('timeline-choice').value, day(0));
  dom.get('timeline-bucket').value = 'hour'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
  assert.equal(dom.get('timeline-chart').children.length, 0);
  changed = true;
  dom.get('timeline-bucket').value = 'day'; dom.get('timeline-bucket').dispatchEvent(new Event('change')); await flush();
  assert.equal(dom.get('timeline-choice').value, day(1));
  clickNode(dom.get('timeline-toggle'));
  assert.equal(dom.get('timeline-panel').hidden, true);
  assert.equal(dom.get('timeline-toggle').getAttribute('aria-expanded'), 'false');
});

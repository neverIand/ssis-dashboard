import assert from 'node:assert/strict';
import test from 'node:test';
import {mountDetail} from '../src/render-detail.js';
import {mountOverview} from '../src/render-overview.js';
import {defaultSelection} from '../src/selection.js';
import {deferred} from './fixtures.js';
import {detailDOM,detailResponse} from './detail-fixture.js';
import {executablePage} from './executable-fixture.js';
import {historyMetadata,historyPage,historyRow,estimate} from './history-fixture.js';
import {overviewDOM} from './overview-dom.js';
import {overviewPage,timelineBucket,timelineMetadata,timelinePage,timelineSummary} from './timeline-fixture.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const click=node=>node.dispatchEvent(new Event('click'));
const selected=dom=>dom.view.checkpoint().historyView.chart.selected;
const all='1,2,3,4,5,6,7,8,9';
const stamp=day=>`2026-10-${String(day).padStart(2,'0')}T00:00:00.0000000Z`;
function interaction(svg,type,target,key){
  const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:target});
  if(key!==undefined)Object.defineProperty(event,'key',{value:key});
  svg.dispatchEvent(event);return event;
}
function historyScreen(t,rows,{get,restoreView}={}){
  const dom=detailDOM(),calls=[],metadata=historyMetadata();
  const view=mountDetail(dom.root,{metadata,executionId:'17',appBase:'/app/',restoreView,api:{async get(resource,options){
    calls.push({resource,...options});
    if(resource==='history')return get?get(options):historyPage(rows.filter(row=>options.params.status.split(',').includes(String(row.status.code))),{limit:options.params.limit,direction:options.params.direction});
    if(resource.endsWith('/executables'))return executablePage();
    const response=detailResponse('17');response.data.status={code:4,name:'failed'};return response;
  }}});t.after(view.dispose);return {...dom,calls,view};
}
async function openHistory(dom,chart=false){await flush();click(dom.get('history-toggle'));await flush();if(chart)click(dom.get('history-chart-toggle'));}
const preset=(dom,key)=>dom.get('history-presets').children.find(node=>node.dataset.historyPreset===key);

test('D3 explicitly requests every known status and visibly marks a failed current execution',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'}}),historyRow('16'),historyRow('15',{status:{code:4,name:'failed'}})];
  const dom=historyScreen(t,rows);await openHistory(dom);
  assert.equal(dom.calls.at(-1).params.status,all);assert.equal(dom.historyBody.children.length,3);
  const current=dom.historyBody.children[0];assert.equal(current.dataset.current,'true');
  assert.equal(current.children[0].firstChild.getAttribute('aria-current'),'page');assert.match(current.textContent,/current/);
  assert.equal(dom.historyBody.children[1].dataset.current,'false');assert.doesNotMatch(dom.historyBody.children[1].textContent,/current/);
  assert.equal(dom.get('history-status-options').hidden,true);assert.equal(preset(dom,'all').getAttribute('aria-pressed'),'true');
  current.children[0].firstChild.focus();click(dom.get('detail-refresh'));await flush();
  assert.equal(dom.historyBody.children[0],current);assert.equal(dom.document.activeElement,current.children[0].firstChild);
});

test('history presets apply once, reset checkbox drafts, and leave estimates to the returned server page',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'},estimate:estimate({duration_seconds:12})}),historyRow('16'),
    historyRow('15',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null})];
  const dom=historyScreen(t,rows);await openHistory(dom);const choices=dom.get('history-choices').children.map(label=>label.firstChild);
  for(const [key,status] of [['succeeded','7'],['failed','4'],['running','2'],['all',all]]){
    for(const input of choices)input.checked=false;
    const count=dom.calls.length;click(preset(dom,key));await flush();
    assert.equal(dom.calls.length,count+1);assert.equal(dom.calls.at(-1).params.status,status);
    assert.equal(preset(dom,key).getAttribute('aria-pressed'),'true');
    assert.deepEqual(choices.filter(input=>input.checked).map(input=>input.value),status.split(','));
    if(key==='failed')assert.match(dom.historyBody.children[0].children[5].textContent,/12 s · ends .*\(5\)/);
    click(preset(dom,key));await flush();assert.equal(dom.calls.length,count+1,'Reapplying the same preset adds no read');
  }
});

test('busy history presets cannot send reads or change applied status and retain keyboard focus',async t=>{
  const wait=deferred();let slow=false;
  const dom=historyScreen(t,[],{get:()=>slow?wait.promise:historyPage()});await openHistory(dom);
  const button=preset(dom,'failed');button.focus();slow=true;click(dom.get('detail-refresh'));await flush();
  const count=dom.calls.length;click(button);click(button);
  assert.equal(dom.calls.length,count);assert.equal(button.getAttribute('aria-disabled'),'true');
  assert.equal(preset(dom,'all').getAttribute('aria-pressed'),'true');
  wait.resolve(historyPage());await flush();assert.equal(dom.document.activeElement,button);
});

test('secondary history choices and a preset focus restore after fresh reads without persisting rows',async t=>{
  const rows=[historyRow('17',{status:{code:4,name:'failed'}})];
  const dom=historyScreen(t,rows);await openHistory(dom);click(preset(dom,'failed'));await flush();
  click(dom.get('history-custom'));dom.get('history-choices').children[0].firstChild.focus();
  const saved=dom.view.checkpoint();assert.doesNotMatch(JSON.stringify(saved),/Main\.dtsx|duration_seconds|sample_count/);dom.view.dispose();
  const restored=historyScreen(t,rows,{restoreView:saved});await flush();
  assert.equal(restored.calls.length,2);assert.equal(restored.calls.at(-1).params.status,'4');
  assert.equal(restored.get('history-status-options').hidden,false);assert.equal(restored.document.activeElement,restored.get('history-choices').children[0].firstChild);
});

test('history plots chronological creation order independently of table order, with labels, status and estimate markers',async t=>{
  const rows=[historyRow('19',{created_at:stamp(16),duration_seconds:10,status:{code:4,name:'failed'},estimate:estimate({duration_seconds:20})}),
    historyRow('17',{created_at:stamp(15),duration_seconds:0}),historyRow('16',{created_at:stamp(17),duration_seconds:40})];
  const dom=historyScreen(t,rows);await openHistory(dom,true);const plot=dom.get('history-chart-plot'),groups=plot.children;
  assert.deepEqual(groups.map(row=>row.dataset.executionId),['17','19','16']);
  assert.deepEqual(dom.historyBody.children.map(row=>row.dataset.historyId),['19','17','16']);
  assert.equal(selected(dom),'16');assert.equal(groups[1].getAttribute('data-status'),'4');
  const marker=groups[1].children[2];assert.equal(marker.tag,'line');assert.equal(marker.getAttribute('y1'),'85');assert.equal(marker.getAttribute('y2'),'85');
  assert.equal(groups[1].children[1].getAttribute('height'),'37.5');assert.equal(groups[0].children[3].getAttribute('display'),'inline');
  assert.deepEqual(dom.get('history-chart-y-axis').children.map(node=>node.textContent),['40 s','20 s','0 ms']);
  // Short projections use compact ID labels; each label's title keeps the full creation time.
  assert.deepEqual(dom.get('history-chart-x-axis').children.map(node=>node.textContent),['#17','#19','#16']);
  assert.match(dom.get('history-chart-x-axis').children[0].title,/2026-10-15.*Execution 17/);
  assert.equal(dom.get('history-chart-scale').textContent,'Duration');
  assert.equal(groups.filter(row=>row.getAttribute('tabindex')==='0').length,1);
});

test('history chart x labels show creation dates once seven executions give the axis room',async t=>{
  const rows=Array.from({length:7},(_,index)=>historyRow(String(30-index),{created_at:stamp(10+index),duration_seconds:index+1}));
  const dom=historyScreen(t,rows);await openHistory(dom,true);
  assert.match(dom.get('history-chart-x-axis').textContent,/2026-10-10.*#30.*2026-10-16.*#24/s);
});

test('history hover and keyboard expose values without requests; keyed plot focus survives refresh and removal falls back',async t=>{
  let rows=[historyRow('18',{duration_seconds:20}),historyRow('17',{duration_seconds:5})];
  const dom=historyScreen(t,rows,{get:()=>historyPage(rows)});await openHistory(dom,true);
  const plot=dom.get('history-chart-plot'),count=dom.calls.length,first=plot.children[0],last=plot.children[1];
  interaction(plot,'mouseover',first.children[1]);assert.equal(selected(dom),'17');
  assert.match(dom.get('history-chart-selected').textContent,/Actual duration: 5 s/);
  first.focus();interaction(plot,'focusin',first);assert.equal(first.getAttribute('aria-selected'),'true');
  assert.equal(interaction(plot,'keydown',first,'ArrowRight').defaultPrevented,true);
  assert.equal(dom.document.activeElement,last);assert.equal(selected(dom),'18');
  interaction(plot,'keydown',last,'Home');assert.equal(dom.document.activeElement,first);
  interaction(plot,'keydown',first,'End');assert.equal(dom.document.activeElement,last);
  interaction(plot,'keydown',last,'Enter');assert.equal(dom.calls.length,count);
  click(dom.get('detail-refresh'));await flush();assert.equal(plot.children[1],last);assert.equal(dom.document.activeElement,last);
  rows=[rows[1]];click(dom.get('detail-refresh'));await flush();
  assert.equal(selected(dom),'17');assert.equal(dom.document.activeElement,plot.children[0]);
});

test('history keeps exact high IDs for chronological ties, and missing actuals remain absent beside estimate markers',async t=>{
  const rows=[historyRow('9223372036854775807',{ended_at:null,duration_seconds:null,estimate:estimate({duration_seconds:20})}),historyRow('9007199254740993')];
  const dom=historyScreen(t,rows);await openHistory(dom,true);const groups=dom.get('history-chart-plot').children;
  assert.deepEqual(groups.map(row=>row.dataset.executionId),['9007199254740993','9223372036854775807']);
  assert.equal(selected(dom),'9223372036854775807');
  assert.equal(groups[1].children[1].getAttribute('display'),'none');assert.equal(groups[1].children[2].getAttribute('display'),'inline');
  assert.match(groups[1].getAttribute('aria-label'),/Actual duration: Unavailable.*Estimated duration: 20 s/);
});

async function timelineScreen(t,rows){
  const dom=overviewDOM(),calls=[],metadata=timelineMetadata(),bounds={from:rows[0].start,to:rows.at(-1).end};
  const view=mountOverview(dom.root,{metadata,appBase:'/app/',api:{async get(resource,options){
    calls.push({resource,...options});return resource==='executions'?overviewPage(bounds):resource==='metrics/summary'?timelineSummary(bounds):timelinePage(rows,{...bounds,bucket:options.params.bucket});
  }}});t.after(view.dispose);await view.apply(defaultSelection(metadata));click(dom.get('timeline-toggle'));await flush();
  return {...dom,calls,view};
}
const emptyBucket=(day)=>timelineBucket(stamp(day),stamp(day+1),{created_count:0,started_count:0,succeeded_count:0,failed_count:0});

test('timeline shows succeeded/failed/other stacks, chronological labels and the latest non-empty default',async t=>{
  const rows=[emptyBucket(14),timelineBucket(stamp(15),stamp(16),{created_count:10,started_count:9,succeeded_count:6,failed_count:3}),
    timelineBucket(stamp(16),stamp(17),{created_count:7,started_count:5,succeeded_count:2,failed_count:0}),emptyBucket(17)];
  const dom=await timelineScreen(t,rows),groups=dom.get('timeline-chart').children;
  assert.deepEqual(groups.map(row=>row.dataset.bucketStart),rows.map(row=>row.start));assert.equal(dom.get('timeline-choice').value,stamp(16));
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>node.dataset.chartStatus),['7','4','other']);
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>Number(node.getAttribute('height'))),[90,45,15]);
  assert.deepEqual(groups[1].children.slice(1,4).map(node=>Number(node.getAttribute('y'))),[70,25,10]);
  assert.equal(dom.timelineBody.children[1].children[6].textContent,'1');assert.equal(dom.timelineBody.children[2].children[6].textContent,'5');
  assert.deepEqual(dom.get('timeline-y-axis').children.map(node=>node.textContent),['10','5','0']);
  assert.match(dom.get('timeline-x-axis').textContent,/2026-10-14.*2026-10-17/s);
  assert.match(dom.get('timeline-selected').textContent,/Created: 7 · Succeeded: 2 · Failed: 0 · Other: 5/);
  assert.equal(dom.get('timeline-series'),undefined);
});

test('timeline hover and keyboard select complete bucket values locally and keep focused keyed groups on refresh',async t=>{
  const rows=[timelineBucket(stamp(15),stamp(16)),timelineBucket(stamp(16),stamp(17),{created_count:20,started_count:10})];
  const dom=await timelineScreen(t,rows),plot=dom.get('timeline-chart'),first=plot.children[0],last=plot.children[1],count=dom.calls.length;
  interaction(plot,'mouseover',first.children[2]);assert.equal(dom.get('timeline-choice').value,stamp(15));
  assert.match(dom.get('timeline-selected').textContent,/Created: 10 · Succeeded: 3 · Failed: 2 · Other: 5/);
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

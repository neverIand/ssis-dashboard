import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiError} from '../src/api.js';
import {mountDetail} from '../src/render-detail.js';
import {deferred} from './fixtures.js';
import {detailDOM,detailResponse} from './detail-fixture.js';
import {historyMetadata,historyPage,historyRow,estimate} from './history-fixture.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function screen(t,get=async()=>historyPage(),options={}){
  const dom=detailDOM(),calls=[],view=mountDetail(dom.root,{executionId:'17',metadata:historyMetadata(),appBase:'/ops/app/',...options,
    api:{get(resource,options){calls.push({resource,...options});return resource==='history'?get(options):Promise.resolve(detailResponse('17'));}}});
  t.after(view.dispose);return {...dom,calls,view};
}
const click=(dom,key)=>dom.get(key).dispatchEvent(new Event('click'));
const choose=(dom,id)=>{dom.get('history-chart-choice').value=id;dom.get('history-chart-choice').dispatchEvent(new Event('change'));};
async function open(dom){await flush();click(dom,'history-toggle');await flush();click(dom,'history-chart-toggle');}
const plot=dom=>dom.get('history-chart-plot'),groups=dom=>plot(dom).children;

test('duration chart uses only the loaded history page; opening, selecting and closing add no request',async t=>{
  const dom=screen(t,async()=>historyPage([historyRow('3'),historyRow('2')]));await flush();assert.equal(dom.calls.length,1);
  assert.equal(dom.get('history-chart-toggle').disabled,true);click(dom,'history-toggle');await flush();assert.equal(dom.calls.length,2);
  assert.equal(groups(dom).length,0);click(dom,'history-chart-toggle');assert.equal(groups(dom).length,2);
  choose(dom,'2');assert.match(dom.get('history-chart-selected').textContent,/Execution 2/);
  assert.match(dom.get('history-chart-scope').textContent,/Loaded history page 1 · 2 executions.*rest of package history is not plotted/);
  dom.get('history-chart-choice').focus();click(dom,'history-chart-toggle');assert.equal(groups(dom).length,0);
  assert.equal(dom.document.activeElement,dom.get('history-chart-toggle'));assert.equal(dom.calls.length,2);
});

test('missing actual duration never becomes observed elapsed or estimate, while actual zero has an explicit marker',async t=>{
  const rows=[historyRow('3',{duration_seconds:0}),historyRow('2',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null,elapsed_seconds:123,estimate:estimate({sample_count:1,duration_seconds:10})}),
    historyRow('1',{started_at:null,ended_at:null,duration_seconds:null,elapsed_seconds:null})];
  const dom=screen(t,async()=>historyPage(rows));await open(dom);
  assert.equal(groups(dom)[0].children[1].getAttribute('height'),'0');assert.equal(groups(dom)[0].children[3].getAttribute('display'),'inline');
  assert.equal(groups(dom)[1].children[1].getAttribute('display'),'none');assert.equal(groups(dom)[1].children[3].getAttribute('display'),'none');
  choose(dom,'2');assert.match(dom.get('history-chart-selected').textContent,/Actual duration: Unavailable.*Elapsed \(observed\):.*123.*Estimated duration:.*10.*Mean of 1 prior successful run/);
  choose(dom,'1');assert.match(dom.get('history-chart-selected').textContent,/Actual duration: Unavailable · Estimated duration: Unavailable/);
  assert.doesNotMatch(dom.get('history-chart-selected').textContent,/Elapsed|Mean of/);
});

test('finite huge and sub-millisecond durations keep finite plot geometry and separate exact returned estimates',async t=>{
  const dom=screen(t,async()=>historyPage([historyRow('3',{duration_seconds:Number.MAX_VALUE,estimate:estimate({duration_seconds:Number.MAX_VALUE})}),
    historyRow('2',{duration_seconds:0.0000001,estimate:estimate()}),historyRow('1',{duration_seconds:10})]));await open(dom);
  for(const group of groups(dom))for(const bar of group.children.slice(1,3))for(const key of ['x','y','height','width'])assert.ok(Number.isFinite(Number(bar.getAttribute(key))));
  assert.equal(groups(dom)[0].children[1].getAttribute('height'),'150');choose(dom,'2');
  assert.match(dom.get('history-chart-selected').textContent,/Actual duration: <.*0\.001.*Estimated duration: <.*0\.001/);
  assert.equal(groups(dom)[1].children[3].getAttribute('display'),'none');
});

test('empty and unavailable-duration pages have explicit text without invented zero observations',async t=>{
  for(const rows of [[],[historyRow('1',{started_at:null,ended_at:null,duration_seconds:null,elapsed_seconds:null})]]){
    const dom=screen(t,async()=>historyPage(rows,{upper_id:rows.length?'1':null}));await open(dom);
    assert.equal(dom.get('history-chart-empty').hidden,false);assert.equal(dom.get('history-chart-scale').textContent,'');
    assert.match(dom.get('history-chart-empty').textContent,rows.length?/No durations are available/:/No executions/);
    assert.equal(dom.get('history-chart-choice').disabled,rows.length===0);
  }
});

test('live estimate removal updates keyed chart values while current choice, table scroll and moved focus survive',async t=>{
  let changed=false;const dom=screen(t,async()=>historyPage([historyRow('2',{estimate:changed?null:estimate({duration_seconds:10})}),historyRow('1')]));await open(dom);
  choose(dom,'2');const group=groups(dom)[0];dom.get('history-chart-choice').focus();dom.get('history-scroll').scrollLeft=120;
  changed=true;click(dom,'detail-refresh');await flush();assert.equal(groups(dom)[0],group);assert.equal(dom.get('history-chart-choice').value,'2');
  assert.equal(dom.document.activeElement,dom.get('history-chart-choice'));assert.equal(dom.get('history-scroll').scrollLeft,120);
  assert.match(dom.get('history-chart-selected').textContent,/Estimated duration: Unavailable/);assert.doesNotMatch(plot(dom).textContent,/Mean of/);
  assert.equal(group.children[2].getAttribute('display'),'none');assert.equal(group.children[2].getAttribute('height'),'0');
  dom.get('legacy-detail-link').focus();click(dom,'detail-refresh');await flush();assert.equal(dom.document.activeElement,dom.get('legacy-detail-link'));
  assert.equal(dom.calls.length,6);
});

test('paging plots only the returned bounded page and chooses a valid execution after a selected ID disappears',async t=>{
  const dom=screen(t,async({params})=>params.cursor?historyPage([historyRow('1')]):historyPage([historyRow('3'),historyRow('2')],{has_more:true,next_cursor:'next'}));await open(dom);
  choose(dom,'2');click(dom,'history-next');await flush();assert.equal(groups(dom).length,1);assert.equal(dom.get('history-chart-choice').value,'1');
  assert.match(dom.get('history-chart-scope').textContent,/page 2 · 1 execution/);assert.equal(dom.calls.length,3);
});

test('transient history errors label a retained chart; denial and malformed data remove plot values and selected anchors',async t=>{
  for(const failure of ['transient','denied','invalid']){
    let failed=false;const dom=screen(t,async()=>{if(failed&&failure!=='invalid')throw new ApiError('http',{status:failure==='denied'?403:503});
      return historyPage([historyRow('1',{estimate:estimate(),...(failed?{package_name:'Wrong.dtsx'}:{})})]);});await open(dom);
    failed=true;dom.get('history-chart-choice').focus();click(dom,'detail-refresh');await flush();
    if(failure==='transient'){assert.equal(groups(dom).length,1);assert.match(dom.get('history-chart-scope').textContent,/Previous observation shown/);}
    else {assert.equal(groups(dom).length,0);assert.equal(dom.get('history-chart-choice').children.length,0);assert.equal(dom.view.checkpoint().historyView.chart.selected,null);assert.equal(dom.document.activeElement,dom.get('history-chart-toggle'));}
  }
});

test('retained chart checkpoint contains only local choices and refetches before restoring exact high-ID selection and focus',async t=>{
  const rows=[historyRow('9223372036854775807',{estimate:estimate()}),historyRow('9007199254740993')];
  const dom=screen(t,async()=>historyPage(rows));await open(dom);choose(dom,'9007199254740993');dom.get('history-chart-choice').focus();
  const checkpoint=dom.view.checkpoint();assert.deepEqual(checkpoint.historyView.chart,{open:true,selected:'9007199254740993',focus:'choice'});
  assert.doesNotMatch(JSON.stringify(checkpoint),/duration_seconds|sample_count|Main\.dtsx|Folder|estimate/);dom.view.dispose();
  const restored=screen(t,async()=>historyPage(rows),{restoreView:checkpoint});await flush();
  assert.equal(restored.calls.length,2);assert.equal(restored.get('history-chart-choice').value,'9007199254740993');
  assert.equal(restored.document.activeElement,restored.get('history-chart-choice'));
});

test('maximum history page renders all 200 execution pairs; disposal and late closed history cannot repopulate it',async t=>{
  const rows=Array.from({length:200},(_,index)=>historyRow(String(200-index),{duration_seconds:index,estimate:estimate()}));
  const wait=deferred();let slow=false;
  const dom=screen(t,({params})=>slow?wait.promise:Promise.resolve(historyPage(rows.slice(0,params.limit),{limit:params.limit})));await open(dom);
  assert.equal(groups(dom).length,50);
  dom.get('history-limit').value='200';dom.get('history-limit').dispatchEvent(new Event('change'));await flush();
  assert.equal(groups(dom).length,200);assert.equal(dom.get('history-chart-choice').children.length,200);
  choose(dom,'1');assert.match(dom.get('history-chart-selected').textContent,/Execution 1 ·/);slow=true;click(dom,'detail-refresh');await flush();
  click(dom,'history-toggle');assert.equal(groups(dom).length,0);wait.resolve(historyPage(rows,{limit:200}));await flush();assert.equal(groups(dom).length,0);
  dom.view.dispose();const count=dom.calls.length;click(dom,'history-chart-toggle');assert.equal(dom.calls.length,count);assert.equal(dom.get('history-chart-panel').hidden,true);
});

test('base execution denial clears chart data and selection together with the whole detail',async t=>{
  const dom=detailDOM();let denied=false;
  const view=mountDetail(dom.root,{executionId:'17',metadata:historyMetadata(),appBase:'/ops/app/',api:{async get(resource){
    if(resource==='history')return historyPage([historyRow('1',{estimate:estimate()})]);
    if(denied)throw new ApiError('http',{status:403});return detailResponse('17');
  }}});t.after(view.dispose);await open(dom);assert.equal(groups(dom).length,1);
  denied=true;click(dom,'detail-refresh');await flush();assert.equal(groups(dom).length,0);assert.equal(dom.get('history-chart-panel').hidden,true);
  assert.equal(dom.get('history-chart-choice').children.length,0);assert.equal(view.checkpoint().historyView.chart.selected,null);
});

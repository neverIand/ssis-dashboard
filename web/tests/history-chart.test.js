import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiError} from '../src/api.js';
import {mountDetail} from '../src/render-detail.js';
import {deferred} from './fixtures.js';
import {detailDOM,detailResponse} from './detail-fixture.js';
import {historyMetadata,historyPage,historyRow,estimate} from './history-fixture.js';
import {executablePage} from './executable-fixture.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function screen(t,get=async()=>historyPage(),options={}){
  const dom=detailDOM(),calls=[],view=mountDetail(dom.root,{executionId:'17',metadata:historyMetadata(),appBase:'/ops/app/',...options,
    api:{get(resource,options){calls.push({resource,...options});return resource==='history'?get(options):Promise.resolve(resource.endsWith('/executables')?executablePage():detailResponse('17'));}}});
  t.after(view.dispose);return {...dom,calls,view};
}
const click=(dom,key)=>dom.get(key).dispatchEvent(new Event('click'));
const selected=dom=>dom.view.checkpoint().historyView.chart.selected;
const choose=(dom,id)=>{const event=new Event('click');Object.defineProperty(event,'target',{value:group(dom,id)});plot(dom).dispatchEvent(event);};
async function open(dom){await flush();click(dom,'history-toggle');await flush();click(dom,'history-chart-toggle');}
const plot=dom=>dom.get('history-chart-plot'),groups=dom=>plot(dom).children;
const group=(dom,id)=>groups(dom).find(node=>node.dataset.executionId===id);

test('a hidden duration chart keeps its nodes; a refresh while hidden repaints them on reopen and a denial clears them',async t=>{
  let rows=[historyRow('3',{duration_seconds:5}),historyRow('2',{duration_seconds:7})],denied=false;
  const dom=screen(t,async()=>{if(denied)throw new ApiError('http',{status:403});return historyPage(rows);});await open(dom);
  choose(dom,'2');const kept=group(dom,'2');click(dom,'history-chart-toggle');assert.equal(dom.get('history-chart-panel').hidden,true);
  rows=[historyRow('4',{duration_seconds:9}),historyRow('3',{duration_seconds:5}),historyRow('2',{duration_seconds:11})];
  click(dom,'detail-refresh');await flush();assert.equal(groups(dom).length,2);
  click(dom,'history-chart-toggle');assert.equal(groups(dom).length,3);assert.equal(group(dom,'2'),kept);
  assert.match(dom.get('history-chart-selected').textContent,/#2 · .* · 11 s/);
  click(dom,'history-chart-toggle');denied=true;click(dom,'detail-refresh');await flush();
  assert.equal(groups(dom).length,0);assert.equal(dom.get('history-chart-selected').textContent,'');
});

test('duration chart uses only the loaded history page; opening, selecting and closing add no request and keep the drawing',async t=>{
  const dom=screen(t,async()=>historyPage([historyRow('3'),historyRow('2')]));await flush();assert.equal(dom.calls.length,2);
  assert.equal(dom.get('history-chart-toggle').disabled,true);click(dom,'history-toggle');await flush();assert.equal(dom.calls.length,3);
  assert.equal(groups(dom).length,0);click(dom,'history-chart-toggle');assert.equal(groups(dom).length,2);
  choose(dom,'2');assert.match(dom.get('history-chart-selected').textContent,/#2 ·/);
  assert.match(dom.get('history-status').textContent,/Page 1 · 2 executions/);
  group(dom,selected(dom)).focus();click(dom,'history-chart-toggle');assert.equal(dom.get('history-chart-panel').hidden,true);
  const kept=[...groups(dom)];assert.equal(kept.length,2);click(dom,'history-chart-toggle');
  assert.deepEqual([...groups(dom)],kept);assert.match(dom.get('history-chart-selected').textContent,/#2 ·/);click(dom,'history-chart-toggle');
  assert.equal(dom.document.activeElement,dom.get('history-chart-toggle'));assert.equal(dom.calls.length,3);
});

test('missing actual duration never becomes observed elapsed or estimate, while actual zero has an explicit marker',async t=>{
  const rows=[historyRow('3',{duration_seconds:0}),historyRow('2',{status:{code:2,name:'running'},ended_at:null,duration_seconds:null,elapsed_seconds:123,estimate:estimate({sample_count:1,duration_seconds:10})}),
    historyRow('1',{started_at:null,ended_at:null,duration_seconds:null,elapsed_seconds:null})];
  const dom=screen(t,async()=>historyPage(rows));await open(dom);
  assert.equal(group(dom,'3').children[1].getAttribute('height'),'0');assert.equal(group(dom,'3').children[3].getAttribute('display'),'inline');
  assert.equal(group(dom,'2').children[1].getAttribute('display'),'none');assert.equal(group(dom,'2').children[3].getAttribute('display'),'none');
  choose(dom,'2');
  assert.equal(group(dom,'2').firstChild.textContent, '#2 · 2026-10-17 17:00:00 · Running · 2 min 03 s elapsed');
  assert.equal(dom.get('history-chart-selected').textContent, group(dom,'2').firstChild.textContent);
  choose(dom,'1');
  assert.equal(dom.get('history-chart-selected').textContent, '#1 · 2026-10-17 17:00:00 · Succeeded · Unavailable');
});

test('finite huge and sub-millisecond durations keep finite plot geometry and separate exact returned estimates',async t=>{
  const dom=screen(t,async()=>historyPage([historyRow('3',{duration_seconds:Number.MAX_VALUE,estimate:estimate({duration_seconds:Number.MAX_VALUE})}),
    historyRow('2',{duration_seconds:0.0000001,estimate:estimate()}),historyRow('1',{duration_seconds:10})]));await open(dom);
  for(const row of groups(dom)){
    for(const key of ['x','y','height','width'])assert.ok(Number.isFinite(Number(row.children[1].getAttribute(key))));
    for(const key of ['x1','x2','y1','y2'])assert.ok(Number.isFinite(Number(row.children[2].getAttribute(key))));
  }
  assert.equal(group(dom,'3').children[1].getAttribute('height'),'150');choose(dom,'2');
  assert.equal(dom.get('history-chart-selected').textContent, '#2 · 2026-10-17 17:00:00 · Succeeded · <1 ms (estimate <1 ms)');
  assert.equal(group(dom,'2').children[3].getAttribute('display'),'none');
});

test('empty and unavailable-duration pages have explicit text without invented zero observations',async t=>{
  for(const rows of [[],[historyRow('1',{started_at:null,ended_at:null,duration_seconds:null,elapsed_seconds:null})]]){
    const dom=screen(t,async()=>historyPage(rows,{upper_id:rows.length?'1':null}));await open(dom);
    assert.equal(dom.get('history-chart-empty').hidden,false);assert.equal(dom.get('history-chart-scale').textContent,'');
    assert.match(dom.get('history-chart-empty').textContent,rows.length?/No durations are available/:/No executions/);
    assert.equal(plot(dom).getAttribute('data-empty'),'true');
  }
});

test('live estimate removal updates keyed chart values while current choice, table scroll and moved focus survive',async t=>{
  let changed=false;const dom=screen(t,async()=>historyPage([historyRow('2',{estimate:changed?null:estimate({duration_seconds:10})}),historyRow('1')]));await open(dom);
  choose(dom,'2');const selectedGroup=group(dom,'2');group(dom,selected(dom)).focus();dom.get('history-scroll').scrollLeft=120;
  changed=true;click(dom,'detail-refresh');await flush();assert.equal(group(dom,'2'),selectedGroup);assert.equal(selected(dom),'2');
  assert.equal(dom.document.activeElement,group(dom,selected(dom)));assert.equal(dom.get('history-scroll').scrollLeft,120);
  assert.equal(dom.get('history-chart-selected').textContent, '#2 · 2026-10-17 17:00:00 · Succeeded · 0 ms');
  assert.equal(selectedGroup.children[2].getAttribute('display'),'none');assert.equal(selectedGroup.children[2].getAttribute('y1'),'160');
  dom.get('legacy-detail-link').focus();click(dom,'detail-refresh');await flush();assert.equal(dom.document.activeElement,dom.get('legacy-detail-link'));
  assert.equal(dom.calls.length,7);
});

test('paging plots only the returned bounded page and chooses a valid execution after a selected ID disappears',async t=>{
  const dom=screen(t,async({params})=>params.cursor?historyPage([historyRow('1')]):historyPage([historyRow('3'),historyRow('2')],{has_more:true,next_cursor:'next'}));await open(dom);
  choose(dom,'2');click(dom,'history-next');await flush();assert.equal(groups(dom).length,1);assert.equal(selected(dom),'1');
  assert.match(dom.get('history-status').textContent,/Page 2 · 1 execution/);assert.equal(dom.calls.length,4);
});

test('transient history errors label a retained chart; denial and malformed data remove plot values and selected anchors',async t=>{
  for(const failure of ['transient','denied','invalid']){
    let failed=false;const dom=screen(t,async()=>{if(failed&&failure!=='invalid')throw new ApiError('http',{status:failure==='denied'?403:503});
      return historyPage([historyRow('1',{estimate:estimate(),...(failed?{package_name:''}:{})})]);});await open(dom);
    failed=true;group(dom,selected(dom)).focus();click(dom,'detail-refresh');await flush();
    if(failure==='transient'){assert.equal(groups(dom).length,1);assert.match(dom.get('history-status').textContent,/Previous history page shown/);}
    else {assert.equal(groups(dom).length,0);assert.equal(groups(dom).length,0);assert.equal(dom.view.checkpoint().historyView.chart.selected,null);assert.equal(dom.document.activeElement,dom.get('history-chart-toggle'));}
  }
});

test('retained chart checkpoint contains only local choices and refetches before restoring exact high-ID selection and focus',async t=>{
  const rows=[historyRow('9223372036854775807',{estimate:estimate()}),historyRow('9007199254740993')];
  const dom=screen(t,async()=>historyPage(rows));await open(dom);choose(dom,'9007199254740993');group(dom,selected(dom)).focus();
  const checkpoint=dom.view.checkpoint();assert.deepEqual(checkpoint.historyView.chart,{open:true,selected:'9007199254740993',focus:'plot'});
  assert.doesNotMatch(JSON.stringify(checkpoint),/duration_seconds|sample_count|Main\.dtsx|Folder|estimate/);dom.view.dispose();
  const restored=screen(t,async()=>historyPage(rows),{restoreView:checkpoint});await flush();
  assert.equal(restored.calls.length,2);assert.equal(selected(restored),'9007199254740993');
  assert.equal(restored.document.activeElement,group(restored,selected(restored)));
});

test('maximum history page renders all 200 execution pairs; disposal and late closed history cannot repopulate it',async t=>{
  const rows=Array.from({length:200},(_,index)=>historyRow(String(200-index),{duration_seconds:index,estimate:estimate()}));
  const wait=deferred();let slow=false;
  const dom=screen(t,({params})=>slow?wait.promise:Promise.resolve(historyPage(rows.slice(0,params.limit),{limit:params.limit})));await open(dom);
  assert.equal(groups(dom).length,50);
  dom.get('history-limit').value='200';dom.get('history-limit').dispatchEvent(new Event('change'));await flush();
  assert.equal(groups(dom).length,200);assert.equal(groups(dom).length,200);
  choose(dom,'1');assert.match(dom.get('history-chart-selected').textContent,/#1 ·/);slow=true;click(dom,'detail-refresh');await flush();
  click(dom,'executables-toggle');assert.equal(groups(dom).length,0);wait.resolve(historyPage(rows,{limit:200}));await flush();assert.equal(groups(dom).length,0);
  dom.view.dispose();const count=dom.calls.length;click(dom,'history-chart-toggle');assert.equal(dom.calls.length,count);assert.equal(dom.get('history-chart-panel').hidden,true);
});

test('base execution denial clears chart data and selection together with the whole detail',async t=>{
  const dom=detailDOM();let denied=false;
  const view=mountDetail(dom.root,{executionId:'17',metadata:historyMetadata(),appBase:'/ops/app/',api:{async get(resource){
    if(resource==='history')return historyPage([historyRow('1',{estimate:estimate()})]);
    if(denied)throw new ApiError('http',{status:403});return detailResponse('17');
  }}});t.after(view.dispose);await open(dom);assert.equal(groups(dom).length,1);
  denied=true;click(dom,'detail-refresh');await flush();assert.equal(groups(dom).length,0);assert.equal(dom.get('history-chart-panel').hidden,true);
  assert.equal(groups(dom).length,0);assert.equal(view.checkpoint().historyView.chart.selected,null);
});

const clickNode=node=>node.dispatchEvent(new Event('click'));
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
async function openHistory(dom,chart=false){await flush();clickNode(dom.get('history-toggle'));await flush();if(chart)clickNode(dom.get('history-chart-toggle'));}

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
  assert.equal(dom.get('history-chart-x-axis').children[0].title, '2026-10-15 01:00:00 · #17');
  assert.equal(groups[1].firstChild.textContent, '#19 · 2026-10-16 01:00:00 · Failed · 10 s (estimate 20 s)');
  assert.equal(groups[1].getAttribute('aria-label'), groups[1].firstChild.textContent);
  assert.equal(dom.get('history-chart-scale').textContent,'Duration');
  assert.equal(groups.filter(row=>row.getAttribute('tabindex')==='0').length,1);
});

test('a status 6 history row reads Ended unexpectedly in the table and the chart',async t=>{
  const rows=[historyRow('19',{status:{code:6,name:'halted'},duration_seconds:10})];
  const dom=historyScreen(t,rows);await openHistory(dom,true);
  const row=dom.historyBody.children[0],group=dom.get('history-chart-plot').children[0];
  assert.ok(row.children.some(cell=>cell.textContent.includes('Ended unexpectedly')));
  assert.match(group.firstChild.textContent,/ · Ended unexpectedly · /);
  assert.equal(group.getAttribute('aria-label'),group.firstChild.textContent);
  assert.equal(group.getAttribute('data-status'),'6');
});

test('history chart x labels show creation dates once seven executions give the axis room',async t=>{
  const rows=Array.from({length:7},(_,index)=>historyRow(String(30-index),{created_at:stamp(10+index),duration_seconds:index+1}));
  const dom=historyScreen(t,rows);await openHistory(dom,true);
  assert.match(dom.get('history-chart-x-axis').textContent,/2026-10-10.*#30.*2026-10-16.*#24/s);
});

test('history click and keyboard expose values without requests; keyed plot focus survives refresh and removal falls back',async t=>{
  let rows=[historyRow('18',{duration_seconds:20}),historyRow('17',{duration_seconds:5})];
  const dom=historyScreen(t,rows,{get:()=>historyPage(rows)});await openHistory(dom,true);
  const plot=dom.get('history-chart-plot'),count=dom.calls.length,first=plot.children[0],last=plot.children[1];
  interaction(plot,'click',first.children[1]);assert.equal(selected(dom),'17');
  interaction(plot,'mouseover',last.children[1]);assert.equal(selected(dom),'17'); // hover does not replace a selection
  assert.equal(dom.get('history-chart-selected').textContent, '#17 · 2026-10-17 17:00:00 · Succeeded · 5 s');
  first.focus();interaction(plot,'focusin',first);assert.equal(first.getAttribute('aria-selected'),'true');
  assert.equal(interaction(plot,'keydown',first,'ArrowRight').defaultPrevented,true);
  assert.equal(dom.document.activeElement,last);assert.equal(selected(dom),'18');
  interaction(plot,'keydown',last,'Home');assert.equal(dom.document.activeElement,first);
  interaction(plot,'keydown',first,'End');assert.equal(dom.document.activeElement,last);
  const opened=[];dom.window.location.assign=href=>opened.push(href);
  interaction(plot,'keydown',last,'Enter');assert.equal(dom.calls.length,count);
  assert.deepEqual(opened,[dom.historyBody.children.find(row=>row.dataset.historyId==='18').firstChild.firstChild.getAttribute('href')]);
  clickNode(dom.get('detail-refresh'));await flush();assert.equal(plot.children[1],last);assert.equal(dom.document.activeElement,last);
  rows=[rows[1]];clickNode(dom.get('detail-refresh'));await flush();
  assert.equal(selected(dom),'17');assert.equal(dom.document.activeElement,plot.children[0]);
});

test('history keeps exact high IDs for chronological ties, and missing actuals remain absent beside estimate markers',async t=>{
  const rows = [historyRow('9223372036854775807', { ended_at: null, duration_seconds: null, elapsed_seconds: null,
    status: { code: 2, name: 'running' }, estimate: estimate({ duration_seconds: 20 }) }), historyRow('9007199254740993')];
  const dom=historyScreen(t,rows);await openHistory(dom,true);const groups=dom.get('history-chart-plot').children;
  assert.deepEqual(groups.map(row=>row.dataset.executionId),['9007199254740993','9223372036854775807']);
  assert.equal(selected(dom),'9223372036854775807');
  assert.equal(groups[1].children[1].getAttribute('display'),'none');assert.equal(groups[1].children[2].getAttribute('display'),'inline');
  assert.equal(groups[1].getAttribute('aria-label'), '#9223372036854775807 · 2026-10-17 17:00:00 · Running · Unavailable (estimate 20 s)');
});

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

for (const count of [1, 2]) test(`history caps the centered bar projection for ${count} execution(s)`, async t => {
  const dom = historyTabScreen(t, { read: () => historyPage(Array.from({ length: count }, (_, i) => historyRow(String(count - i)))) });
  await flush(); const toggle = dom.get('history-chart-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  clickNode(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  assert.equal(dom.get('history-chart-plot').style.maxWidth, `${count * 48}px`);
  assert.equal(dom.get('history-chart-x-axis').style.maxWidth, `${count * 48}px`);
  assert.equal(dom.get('history-chart-plot').children.filter(node => node.getAttribute('tabindex') === '0').length, 1);
  assert.equal(dom.calls.length, 2);
  clickNode(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-pressed'), null);
  assert.equal(dom.calls.length, 2);
});

import {createDisplay,formatCode} from './display.js';
import {chartAttribute as attribute,durationTick,mountChartInteraction,renderChartAxes} from './chart-view.js';
import {reserveLoadingSpace} from './loading-space.js';

export function mountHistoryChart(root,{metadata,restoreView=null}) {
  const document=root.ownerDocument,get=key=>root.querySelector(`[data-history-chart-${key}]`);
  const toggle=get('toggle'),panel=get('panel'),svg=get('plot'),selectedText=get('selected'),scale=get('scale'),empty=get('empty');
  const xAxis=get('x-axis'),yAxis=get('y-axis');
  const display=createDisplay({timeZone:metadata.display_timezone}),rows=new Map(),controls={toggle};
  const initialFocus=document.activeElement;
  const reserveSpace=reserveLoadingSpace(panel);
  let open=restoreView?.open===true,selected=restoreView?.selected??null,returning=restoreView,current=null,rendered=null,order=[];
  const shape=tag=>document.createElementNS('http://www.w3.org/2000/svg',tag);
  const duration=value=>value===null?'Unavailable':display.duration(value);
  const describe=item=>`Execution ${item.execution_id} · ${display.timestamp(item.created_at)} · ${formatCode(item.status)} · Actual duration: ${duration(item.duration_seconds)}`
    +`${item.ended_at===null&&item.elapsed_seconds!==null?` · Elapsed (observed): ${display.duration(item.elapsed_seconds)}`:''}`
    +` · Estimated duration: ${duration(item.estimate?.duration_seconds??null)}`
    +`${item.estimate?` · Mean of ${display.count(item.estimate.sample_count)} prior successful ${item.estimate.sample_count===1?'run':'runs'}`:''}`;
  function clear(){rows.clear();order=[];svg.replaceChildren();xAxis.replaceChildren();yAxis.replaceChildren();selectedText.textContent=selectedText.title=scale.textContent='';empty.hidden=true;rendered=null;}
  function mark(){
    if(!rows.has(selected))selected=order.at(-1)??null;
    for(const [id,row] of rows){
      attribute(row.group,'data-selected',id===selected);attribute(row.group,'aria-selected',id===selected);
      attribute(row.group,'tabindex',id===selected?0:-1);
    }
    selectedText.textContent=rows.has(selected)?describe(rows.get(selected).item):'';
    selectedText.title=selectedText.textContent;
  }
  const select=id=>{if(rows.has(id)&&selected!==id){selected=id;mark();}};
  const disposeInteraction=mountChartInteraction(svg,{field:'executionId',keys:()=>order,node:id=>rows.get(id)?.group,select});
  function paint(page){
    // The table keeps its server order; only this loaded-page projection is chronological.
    const data=[...page.data].sort((a,b)=>a.created_at===b.created_at
      ?(BigInt(a.execution_id)<BigInt(b.execution_id)?-1:1):a.created_at<b.created_at?-1:1);
    order=data.map(item=>item.execution_id);
    // The 1000-unit projection scales into at most 48 CSS px per execution.
    svg.style.maxWidth=xAxis.style.maxWidth=`${Math.max(1,data.length)*48}px`;
    const wanted=new Set(),maximum=Math.max(0,...data.flatMap(item=>[item.duration_seconds??0,item.estimate?.duration_seconds??0]));
    const step=1000/Math.max(1,data.length);let groupAnchor=svg.firstChild,index=0,available=0;
    for(const item of data){
      const id=item.execution_id;wanted.add(id);let row=rows.get(id);
      if(!row){
        const group=shape('g'),title=shape('title'),actual=shape('rect'),estimate=shape('line'),zero=shape('circle'),hit=shape('rect');
        group.dataset.executionId=id;attribute(group,'role','option');
        actual.dataset.series='actual';estimate.dataset.series='estimate';zero.dataset.series='actual';zero.dataset.zero='true';hit.dataset.chartHit='true';
        group.append(title,actual,estimate,zero,hit);row={group,title,actual,estimate,zero,hit,item:null};rows.set(id,row);
      }
      row.item=item;row.title.textContent=describe(item);
      attribute(row.group,'aria-label',describe(item));attribute(row.group,'data-status',item.status.code);
      const actual=item.duration_seconds,estimate=item.estimate?.duration_seconds??null;
      const height=actual===null||maximum===0?0:(actual/maximum)*150;
      for(const [key,value] of Object.entries({x:(index+.15)*step,y:160-height,width:step*.7,height,display:actual===null?'none':'inline'}))attribute(row.actual,key,value);
      const estimateY=160-(estimate===null||maximum===0?0:(estimate/maximum)*150);
      for(const [key,value] of Object.entries({x1:(index+.05)*step,x2:(index+.95)*step,y1:estimateY,y2:estimateY,display:estimate===null?'none':'inline'}))attribute(row.estimate,key,value);
      for(const [key,value] of Object.entries({cx:(index+.5)*step,cy:160,r:2,display:actual===0?'inline':'none'}))attribute(row.zero,key,value);
      for(const [key,value] of Object.entries({x:index*step,y:0,width:step,height:170}))attribute(row.hit,key,value);
      if(actual!==null||estimate!==null)available++;
      if(row.group!==groupAnchor)svg.insertBefore(row.group,groupAnchor);
      groupAnchor=row.group.nextSibling;index++;
    }
    for(const [id,row] of rows)if(!wanted.has(id)){row.group.remove();rows.delete(id);}
    scale.textContent=available?'Duration':'';
    // Below seven executions the 48 px groups leave no room for dates; the title and readout keep them.
    renderChartAxes(xAxis,yAxis,data.map(item=>({text:data.length<7?`#${item.execution_id}`:`${display.timestamp(item.created_at).slice(0,10)}\n#${item.execution_id}`,title:`${display.timestamp(item.created_at)} · Execution ${item.execution_id} · ${item.created_at}`})),maximum,value=>durationTick(value,display));
    empty.hidden=available!==0;empty.textContent=page.data.length?'No durations are available on this loaded history page.':'No executions on this loaded history page.';
    attribute(svg,'data-empty',available===0);
    mark();
  }
  function render(context){
    current=context;const {page,busy,visible}=context,focused=document.activeElement,plotFocused=svg.contains(focused),active=open&&visible;
    reserveSpace(active&&busy&&!page,rendered!==null);
    if(!page&&!busy)selected=null;
    toggle.disabled=!visible;toggle.textContent='Chart';attribute(toggle,'aria-expanded',active);panel.hidden=!active;
    attribute(svg,'aria-busy',busy);
    if(!active||!page)clear();else if(page!==rendered){paint(page);rendered=page;}
    if(visible&&plotFocused&&(!focused.isConnected||!active)){
      (active&&rows.get(selected)?.group||toggle).focus({preventScroll:true});
    }
    if(returning&&visible&&page&&!busy){
      if(document.activeElement===initialFocus)(returning.focus==='plot'?rows.get(selected)?.group:controls[returning.focus])?.focus({preventScroll:true});
      returning=null;
    }
  }
  const toggled=()=>{if(!current?.visible)return;open=!open;render(current);};
  toggle.addEventListener('click',toggled);
  return {render,checkpoint:()=>({open,selected,focus:svg.contains(document.activeElement)?'plot':Object.keys(controls).find(key=>controls[key]===document.activeElement)??null}),
    dispose(){reserveSpace(false);toggle.removeEventListener('click',toggled);disposeInteraction();clear();panel.hidden=toggle.disabled=true;attribute(toggle,'aria-expanded',false);current=returning=selected=null;}};
}

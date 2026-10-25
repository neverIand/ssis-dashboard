import { createDisplay, formatCode } from './display.js';
import { timelineSeries } from './timeline.js';
import { chartAttribute as attribute, mountChartInteraction, renderChartAxes } from './chart-view.js';
import { reserveLoadingSpace } from './loading-space.js';

export function mountTimeline(root,{metadata,actions,restoreView=null}) {
  const document=root.ownerDocument, get=key=>root.querySelector(`[data-timeline-${key}]`);
  const controls=Object.fromEntries(['toggle','bucket','choice','retry','scroll'].map(key=>[key,get(key)]));
  const {toggle,bucket,choice,retry,scroll}=controls;
  const panel=get('panel'),status=get('status'),scope=get('scope'),svg=get('chart'),values=get('values');
  const xAxis=get('x-axis'),yAxis=get('y-axis');
  const body=get('table').querySelector('tbody'),rows=new Map(),listeners=[];
  const display=createDisplay({timeZone:metadata.display_timezone});
  const label=instant=>display.timestamp(instant);
  const initialFocus=document.activeElement,initialPosition={left:scroll.scrollLeft,top:scroll.scrollTop};
  const reserveSpace=reserveLoadingSpace(panel);
  const reserveTableSpace=reserveLoadingSpace(scroll);
  let grainChanged=false;
  let current=null,rendered=null,busy=true,selected=typeof restoreView?.selected==='string'?restoreView.selected:null,returning=restoreView,order=[];
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const shape=tag=>document.createElementNS('http://www.w3.org/2000/svg',tag);
  const other=item=>item.created_count-item.succeeded_count-item.failed_count;
  const describe=row=>`${row.label} · Created: ${display.count(row.item.created_count)} · Succeeded: ${display.count(row.item.succeeded_count)} · Failed: ${display.count(row.item.failed_count)} · Other: ${display.count(other(row.item))} · With an actual start: ${display.count(row.item.started_count)}`;
  values.open=restoreView?.tableOpen===true;
  function clear(){rows.clear();order=[];body.replaceChildren();choice.replaceChildren();svg.replaceChildren();xAxis.replaceChildren();yAxis.replaceChildren();get('selected').textContent=get('scale').textContent='';get('zero').hidden=true;}
  function mark(){
    if(!rows.has(selected))selected=order.findLast(start=>rows.get(start).item.created_count>0)??order.at(-1)??null;
    choice.value=selected??'';
    for(const [start,row] of rows){
      attribute(row.node,'data-selected',start===selected);attribute(row.group,'data-selected',start===selected);
      attribute(row.group,'aria-selected',start===selected);attribute(row.group,'tabindex',start===selected?0:-1);
    }
    const row=rows.get(selected);
    get('selected').textContent=row?describe(row):'';
    get('selected').title=get('selected').textContent;
  }
  const select=start=>{if(rows.has(start)&&selected!==start){selected=start;mark();}};
  const disposeInteraction=mountChartInteraction(svg,{field:'bucketStart',keys:()=>order,node:start=>rows.get(start)?.group,select});
  function plot(){
    const maximum=Math.max(0,...[...rows.values()].map(row=>row.item.created_count));
    const step=1000/Math.max(1,rows.size);let index=0;
    for(const start of order){
      const row=rows.get(start);let cumulative=0;
      for(const [bar,value] of [[row.bars[0],row.item.succeeded_count],[row.bars[1],row.item.failed_count],[row.bars[2],other(row.item)]]){
        cumulative+=value;
        const height=maximum===0?0:(value/maximum)*150,y=160-(maximum===0?0:(cumulative/maximum)*150);
        for(const [key,value] of Object.entries({x:(index+.075)*step,y,width:step*.85,height}))attribute(bar,key,value);
      }
      for(const [key,value] of Object.entries({cx:(index+.5)*step,cy:160,r:2,display:row.item.created_count===0?'inline':'none'}))attribute(row.zero,key,value);
      for(const [key,value] of Object.entries({x:index*step,y:0,width:step,height:170}))attribute(row.hit,key,value);
      text(row.title,describe(row));attribute(row.group,'aria-label',describe(row));index++;
    }
    renderChartAxes(xAxis,yAxis,order.map(start=>{
      const value=label(start);
      return {text:current.bucket==='day'?value.slice(0,10):`${value.slice(0,10)}\n${value.slice(11,16)}${value.slice(19)}`,title:`${value} · ${start}`};
    }),maximum,value=>display.count(value),{counts:true});
    get('scale').textContent='Created executions';
    get('zero').hidden=maximum!==0;attribute(svg,'data-empty',maximum===0);mark();
  }
  function paint(page){
    if(grainChanged&&page.data.find(item=>item.start===selected)?.created_count===0)selected=null;
    grainChanged=false;
    order=page.data.map(item=>item.start);
    const wanted=new Set();let rowAnchor=body.firstChild,optionAnchor=choice.firstChild,barAnchor=svg.firstChild;
    for(const item of page.data){
      wanted.add(item.start);let row=rows.get(item.start);
      if(!row){
        const node=element('tr');node.dataset.bucketStart=item.start;
        const cells=Array.from({length:7},()=>element('td'));node.append(...cells);
        const option=element('option');option.value=item.start;
        const group=shape('g'),title=shape('title'),bars=['7','4','other'].map(code=>{const bar=shape('rect');bar.dataset.chartStatus=code;return bar;}),zero=shape('circle'),hit=shape('rect');
        group.dataset.bucketStart=item.start;attribute(group,'role','option');zero.dataset.zero='true';hit.dataset.chartHit='true';group.append(title,...bars,zero,hit);
        row={node,cells,option,group,bars,zero,hit,title,item:null,label:''};rows.set(item.start,row);
      }
      if(!row.item||row.item.end!==item.end){
        row.label=`${label(item.start)} → ${label(item.end)}`;text(row.option,row.label);
        row.option.title=`${item.start} → ${item.end}`;
        for(const [index,key] of [[0,'start'],[1,'end']]){
          const time=element('time',label(item[key]));time.setAttribute('datetime',item[key]);time.title=item[key];row.cells[index].replaceChildren(time);
        }
      }
      Object.keys(timelineSeries).forEach((key,index)=>text(row.cells[index+2],display.count(item[key])));row.item=item;
      text(row.cells[6],display.count(other(item)));
      for(const [node,parent,anchor] of [[row.node,body,rowAnchor],[row.option,choice,optionAnchor],[row.group,svg,barAnchor]])if(node!==anchor)parent.insertBefore(node,anchor);
      rowAnchor=row.node.nextSibling;optionAnchor=row.option.nextSibling;barAnchor=row.group.nextSibling;
    }
    for(const [start,row] of rows)if(!wanted.has(start)){row.node.remove();row.option.remove();row.group.remove();rows.delete(start);}
    plot();
  }
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push([node,event,handler]);};
  listen(toggle,'click',actions.toggle);listen(retry,'click',actions.retry);
  listen(bucket,'change',()=>{if(busy){if(current)bucket.value=current.bucket;return;}actions.bucket(bucket.value);});
  listen(choice,'change',()=>{selected=choice.value;mark();});
  return {
    render(state,isBusy,selection,page){
      if(current&&state.bucket!==current.bucket)grainChanged=true;
      current=state;busy=isBusy;
      reserveSpace(state.open&&selection!==null&&busy&&state.page===null,rendered!==null);
      reserveTableSpace(state.open&&selection!==null&&busy&&state.page===null,rendered!==null);
      const focused=document.activeElement,panelFocused=panel.contains(focused),plotFocused=svg.contains(focused),position={left:scroll.scrollLeft,top:scroll.scrollTop};
      toggle.disabled=selection===null||page===null;toggle.textContent='Timeline';toggle.title=state.open?'Hide timeline':'Show timeline';
      panel.hidden=!state.open||selection===null||(!page&&!busy);
      toggle.setAttribute('aria-expanded',String(!panel.hidden));
      bucket.value=state.bucket;bucket.disabled=retry.disabled=panel.hidden;
      bucket.setAttribute('aria-disabled',String(busy));retry.setAttribute('aria-disabled',String(busy));
      retry.hidden=state.error===null;svg.setAttribute('aria-busy',String(busy));
      const response=panel.hidden?null:state.page;
      choice.disabled=response===null;
      if(response!==rendered){if(response)paint(response);else clear();rendered=response;}
      status.title=response?`Observed ${display.timestamp(response.meta.generated_at)} · ${response.meta.generated_at}`:'';
      status.textContent=panel.hidden?'':state.error?`${state.error.message}${state.error.requestId?` Request ID: ${state.error.requestId}`:''}${state.error.status===400?' Choose Day or adjust the creation range.':''}${state.stale?' Previous timeline shown.':''}`
        :state.stale?`${busy?'Refreshing… ':''}Previous timeline shown.`:response?`${display.count(response.data.length)} calendar ${response.data.length===1?'bucket':'buckets'}`:'Loading timeline…';
      status.title=[status.textContent,status.title].filter(Boolean).join(' · ');
      scope.title=panel.hidden||!page?'':`Created ${display.timestamp(page.meta.from)} → ${display.timestamp(page.meta.to)} (exclusive)`;
      scope.textContent=panel.hidden?'':`Counts by creation time · ${selection.status.length?selection.status.map(code=>formatCode(metadata.execution_statuses.find(item=>item.code===code))).join(', '):'All statuses'} · All execution pages`;
      if(!panel.hidden&&plotFocused&&!focused.isConnected&&!choice.disabled)choice.focus({preventScroll:true});
      else if((panel.hidden&&panelFocused)||(focused===retry&&retry.hidden)||(response===null&&focused===choice)){
        if(!toggle.disabled)toggle.focus({preventScroll:true});else document.getElementById?.('main-content')?.focus({preventScroll:true});
      }
      scroll.scrollLeft=position.left;scroll.scrollTop=position.top;
      if(returning&&response&&!busy){
        if(document.activeElement===initialFocus)(returning.focus==='plot'?rows.get(selected)?.group:controls[returning.focus])?.focus({preventScroll:true});
        if(scroll.scrollLeft===initialPosition.left&&scroll.scrollTop===initialPosition.top){scroll.scrollLeft=returning.left;scroll.scrollTop=returning.top;}
        returning=null;
      }
    },
    checkpoint:()=>({selected,tableOpen:values.open,left:scroll.scrollLeft,top:scroll.scrollTop,
      focus:svg.contains(document.activeElement)?'plot':Object.keys(controls).find(key=>controls[key]===document.activeElement)??null}),
    dispose(){reserveSpace(false);reserveTableSpace(false);disposeInteraction();for(const [node,event,handler] of listeners)node.removeEventListener(event,handler);clear();for(const node of Object.values(controls))node.disabled=true;panel.hidden=true;values.open=false;scope.textContent=status.textContent=scope.title=status.title='';current=rendered=returning=selected=null;},
  };
}

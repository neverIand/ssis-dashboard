import { createDisplay, formatCode } from './display.js';
import { timelineSeries } from './timeline.js';

export function mountTimeline(root,{metadata,actions,restoreView=null}) {
  const document=root.ownerDocument, get=key=>root.querySelector(`[data-timeline-${key}]`);
  const controls=Object.fromEntries(['toggle','bucket','series','choice','retry','scroll'].map(key=>[key,get(key)]));
  const {toggle,bucket,series,choice,retry,scroll}=controls;
  const panel=get('panel'),status=get('status'),scope=get('scope'),svg=get('chart'),values=get('values');
  const body=get('table').querySelector('tbody'),rows=new Map(),listeners=[];
  const display=createDisplay({timeZone:metadata.display_timezone});
  const label=instant=>display.timestamp(instant);
  const initialFocus=document.activeElement,initialPosition={left:scroll.scrollLeft,top:scroll.scrollTop};
  let current=null,rendered=null,busy=true,selected=typeof restoreView?.selected==='string'?restoreView.selected:null,returning=restoreView;
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const attribute=(node,key,value)=>{if(node.getAttribute(key)!==String(value))node.setAttribute(key,String(value));};
  for(const [key,title] of Object.entries(timelineSeries)){const option=element('option',title);option.value=key;series.append(option);}
  series.value=Object.hasOwn(timelineSeries,restoreView?.series)?restoreView.series:'created_count';
  values.open=restoreView?.tableOpen===true;
  function clear(){rows.clear();body.replaceChildren();choice.replaceChildren();svg.replaceChildren();get('selected').textContent=get('scale').textContent='';get('zero').hidden=true;}
  function mark(){
    if(!rows.has(selected))selected=rows.keys().next().value??null;
    choice.value=selected??'';
    for(const [start,row] of rows){attribute(row.node,'data-selected',start===selected);attribute(row.bar,'data-selected',start===selected);}
    const row=rows.get(selected);
    get('selected').textContent=row?`${row.label} · ${timelineSeries[series.value]}: ${display.count(row.item[series.value])}`:'';
  }
  function plot(){
    const maximum=Math.max(0,...[...rows.values()].map(row=>row.item[series.value]));
    const step=1000/Math.max(1,rows.size);let index=0;
    for(const row of rows.values()){
      const height=maximum===0?0:150*row.item[series.value]/maximum;
      for(const [key,value] of Object.entries({x:index++*step,y:160-height,width:step*.85,height}))attribute(row.bar,key,value);
      text(row.title,`${row.label} · ${timelineSeries[series.value]}: ${display.count(row.item[series.value])}`);
    }
    get('scale').textContent=`${timelineSeries[series.value]} · 0–${display.count(maximum)}`;
    get('zero').hidden=maximum!==0;mark();
  }
  function paint(page){
    const wanted=new Set();let rowAnchor=body.firstChild,optionAnchor=choice.firstChild,barAnchor=svg.firstChild;
    for(const item of page.data){
      wanted.add(item.start);let row=rows.get(item.start);
      if(!row){
        const node=element('tr');node.dataset.bucketStart=item.start;
        const cells=Array.from({length:6},()=>element('td'));node.append(...cells);
        const option=element('option');option.value=item.start;
        const bar=document.createElementNS('http://www.w3.org/2000/svg','rect');bar.dataset.bucketStart=item.start;
        const title=document.createElementNS('http://www.w3.org/2000/svg','title');bar.append(title);
        row={node,cells,option,bar,title,item:null,label:''};rows.set(item.start,row);
      }
      if(!row.item||row.item.end!==item.end){
        row.label=`${label(item.start)} → ${label(item.end)}`;text(row.option,row.label);
        row.option.title=`${item.start} → ${item.end}`;
        for(const [index,key] of [[0,'start'],[1,'end']]){
          const time=element('time',label(item[key]));time.setAttribute('datetime',item[key]);time.title=item[key];row.cells[index].replaceChildren(time);
        }
      }
      Object.keys(timelineSeries).forEach((key,index)=>text(row.cells[index+2],display.count(item[key])));row.item=item;
      for(const [node,parent,anchor] of [[row.node,body,rowAnchor],[row.option,choice,optionAnchor],[row.bar,svg,barAnchor]])if(node!==anchor)parent.insertBefore(node,anchor);
      rowAnchor=row.node.nextSibling;optionAnchor=row.option.nextSibling;barAnchor=row.bar.nextSibling;
    }
    for(const [start,row] of rows)if(!wanted.has(start)){row.node.remove();row.option.remove();row.bar.remove();rows.delete(start);}
    plot();
  }
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push([node,event,handler]);};
  listen(toggle,'click',actions.toggle);listen(retry,'click',actions.retry);
  listen(bucket,'change',()=>{if(busy){if(current)bucket.value=current.bucket;return;}actions.bucket(bucket.value);});
  listen(series,'change',()=>{if(rows.size)plot();});
  listen(choice,'change',()=>{selected=choice.value;mark();});
  listen(svg,'click',event=>{if(rows.has(event.target?.dataset.bucketStart)){selected=event.target.dataset.bucketStart;mark();}});
  return {
    render(state,isBusy,selection,page){
      current=state;busy=isBusy;
      const focused=document.activeElement,panelFocused=panel.contains(focused),position={left:scroll.scrollLeft,top:scroll.scrollTop};
      toggle.disabled=selection===null||page===null;toggle.textContent=`${state.open?'Hide':'Show'} timeline`;
      toggle.setAttribute('aria-expanded',String(state.open&&page!==null));panel.hidden=!state.open||page===null;
      bucket.value=state.bucket;bucket.disabled=retry.disabled=panel.hidden;
      bucket.setAttribute('aria-disabled',String(busy));retry.setAttribute('aria-disabled',String(busy));
      retry.hidden=state.error===null;svg.setAttribute('aria-busy',String(busy));
      const response=panel.hidden?null:state.page;
      series.disabled=choice.disabled=response===null;
      if(response!==rendered){if(response)paint(response);else clear();rendered=response;}
      status.title=response?`Observed ${display.timestamp(response.meta.generated_at)} · ${response.meta.generated_at}`:'';
      status.textContent=panel.hidden?'':state.error?`${state.error.message}${state.error.requestId?` Request ID: ${state.error.requestId}`:''}${state.error.status===400?' Choose Day or adjust the creation range.':''}${state.stale?' Previous timeline shown.':''}`
        :state.stale?`${busy?'Refreshing… ':''}Previous timeline shown.`:response?`${display.count(response.data.length)} calendar ${response.data.length===1?'bucket':'buckets'}`:'Loading timeline…';
      scope.title=panel.hidden?'':`Created ${display.timestamp(page.meta.from)} → ${display.timestamp(page.meta.to)} (exclusive)`;
      scope.textContent=panel.hidden?'':`Counts by creation time · ${selection.status.length?selection.status.map(code=>formatCode(metadata.execution_statuses.find(item=>item.code===code))).join(', '):'All statuses'} · All execution pages`;
      if((panel.hidden&&panelFocused)||(focused===retry&&retry.hidden)||(response===null&&[series,choice].includes(focused))){
        if(!toggle.disabled)toggle.focus({preventScroll:true});else document.getElementById?.('main-content')?.focus({preventScroll:true});
      }
      scroll.scrollLeft=position.left;scroll.scrollTop=position.top;
      if(returning&&response&&!busy){
        if(document.activeElement===initialFocus)controls[returning.focus]?.focus({preventScroll:true});
        if(scroll.scrollLeft===initialPosition.left&&scroll.scrollTop===initialPosition.top){scroll.scrollLeft=returning.left;scroll.scrollTop=returning.top;}
        returning=null;
      }
    },
    checkpoint:()=>({series:series.value,selected,tableOpen:values.open,left:scroll.scrollLeft,top:scroll.scrollTop,
      focus:Object.keys(controls).find(key=>controls[key]===document.activeElement)??null}),
    dispose(){for(const [node,event,handler] of listeners)node.removeEventListener(event,handler);clear();for(const node of Object.values(controls))node.disabled=true;panel.hidden=true;values.open=false;scope.textContent=status.textContent=scope.title=status.title='';current=rendered=returning=selected=null;},
  };
}

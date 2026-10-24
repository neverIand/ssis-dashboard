import {createDisplay,formatCode} from './display.js';

export function mountHistoryChart(root,{metadata,restoreView=null}) {
  const document=root.ownerDocument,get=key=>root.querySelector(`[data-history-chart-${key}]`);
  const toggle=get('toggle'),panel=get('panel'),choice=get('choice'),svg=get('plot'),scope=get('scope'),selectedText=get('selected'),scale=get('scale'),empty=get('empty');
  const display=createDisplay({timeZone:metadata.display_timezone}),rows=new Map(),controls={toggle,choice};
  const initialFocus=document.activeElement;
  let open=restoreView?.open===true,selected=restoreView?.selected??null,returning=restoreView,current=null,rendered=null;
  const attribute=(node,key,value)=>node.setAttribute(key,String(value));
  const element=(tag)=>document.createElement(tag),shape=tag=>document.createElementNS('http://www.w3.org/2000/svg',tag);
  const duration=value=>value===null?'Unavailable':display.duration(value);
  const describe=item=>`Execution ${item.execution_id} · ${formatCode(item.status)} · Actual duration: ${duration(item.duration_seconds)}`
    +`${item.ended_at===null&&item.elapsed_seconds!==null?` · Elapsed (observed): ${display.duration(item.elapsed_seconds)}`:''}`
    +` · Estimated duration: ${duration(item.estimate?.duration_seconds??null)}`
    +`${item.estimate?` · Mean of ${display.count(item.estimate.sample_count)} prior successful ${item.estimate.sample_count===1?'run':'runs'}`:''}`;
  function clear(){rows.clear();choice.replaceChildren();svg.replaceChildren();selectedText.textContent=scale.textContent='';empty.hidden=true;rendered=null;}
  function mark(){
    if(!rows.has(selected))selected=choice.firstChild?.value??null;
    choice.value=selected??'';
    for(const [id,row] of rows)attribute(row.group,'data-selected',id===selected);
    selectedText.textContent=rows.has(selected)?describe(rows.get(selected).item):'';
  }
  function paint(page){
    const wanted=new Set(),maximum=Math.max(0,...page.data.flatMap(item=>[item.duration_seconds??0,item.estimate?.duration_seconds??0]));
    const step=1000/Math.max(1,page.data.length);let groupAnchor=svg.firstChild,optionAnchor=choice.firstChild,index=0,available=0;
    for(const item of page.data){
      const id=item.execution_id;wanted.add(id);let row=rows.get(id);
      if(!row){
        const group=shape('g'),title=shape('title'),actual=shape('rect'),estimate=shape('rect'),zero=shape('circle'),option=element('option');
        actual.dataset.series='actual';estimate.dataset.series='estimate';zero.dataset.series='actual';zero.dataset.zero='true';
        for(const node of [actual,estimate,zero])node.dataset.executionId=id;
        option.value=id;group.append(title,actual,estimate,zero);row={group,title,actual,estimate,zero,option,item:null};rows.set(id,row);
      }
      row.item=item;row.option.textContent=`${id} · ${formatCode(item.status)}`;row.title.textContent=describe(item);
      for(const [node,value,offset] of [[row.actual,item.duration_seconds,.08],[row.estimate,item.estimate?.duration_seconds??null,.51]]){
        const height=value===null||maximum===0?0:150*(value/maximum);
        for(const [key,value] of Object.entries({x:(index+offset)*step,y:160-height,width:step*.35,height}))attribute(node,key,value);
        attribute(node,'display',value===null?'none':'inline');if(value!==null)available++;
      }
      for(const [key,value] of Object.entries({cx:(index+.255)*step,cy:160,r:2,display:item.duration_seconds===0?'inline':'none'}))attribute(row.zero,key,value);
      for(const [node,parent,anchor] of [[row.group,svg,groupAnchor],[row.option,choice,optionAnchor]])if(node!==anchor)parent.insertBefore(node,anchor);
      groupAnchor=row.group.nextSibling;optionAnchor=row.option.nextSibling;index++;
    }
    for(const [id,row] of rows)if(!wanted.has(id)){row.group.remove();row.option.remove();rows.delete(id);}
    scale.textContent=available?`Duration · 0–${display.duration(maximum)}`:'';
    empty.hidden=available!==0;empty.textContent=page.data.length?'No durations are available on this loaded history page.':'No executions on this loaded history page.';
    mark();
  }
  function render(context){
    current=context;const {page,pageNumber,busy,visible,stale}=context,focused=document.activeElement,active=open&&visible;
    if(!page&&!busy)selected=null;
    toggle.disabled=!visible;toggle.textContent=`${open?'Hide':'Show'} duration chart`;attribute(toggle,'aria-expanded',active);panel.hidden=!active;
    choice.disabled=!active||!page?.data.length;attribute(svg,'aria-busy',busy);
    if(!active||!page)clear();else if(page!==rendered){paint(page);rendered=page;}
    scope.textContent=!active?'':page?`Loaded history page ${display.count(pageNumber)} · ${display.count(page.data.length)} execution${page.data.length===1?'':'s'} · ${stale?'Previous observation shown.':'Live observation.'} The rest of package history is not plotted.`:'No history page loaded.';
    if(focused===choice&&choice.disabled&&!toggle.disabled)toggle.focus({preventScroll:true});
    if(returning&&visible&&page&&!busy){
      if(document.activeElement===initialFocus)controls[returning.focus]?.focus({preventScroll:true});
      returning=null;
    }
  }
  const toggled=()=>{if(!current?.visible)return;open=!open;render(current);};
  const chosen=()=>{selected=choice.value;mark();};
  const pointed=event=>{if(rows.has(event.target?.dataset.executionId)){selected=event.target.dataset.executionId;mark();}};
  toggle.addEventListener('click',toggled);choice.addEventListener('change',chosen);svg.addEventListener('click',pointed);
  return {render,checkpoint:()=>({open,selected,focus:Object.keys(controls).find(key=>controls[key]===document.activeElement)??null}),
    dispose(){toggle.removeEventListener('click',toggled);choice.removeEventListener('change',chosen);svg.removeEventListener('click',pointed);clear();scope.textContent='';panel.hidden=toggle.disabled=choice.disabled=true;attribute(toggle,'aria-expanded',false);current=returning=selected=null;}};
}

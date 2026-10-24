import {metadata,envelope,wireTime} from './fixtures.js';
export const timelineFrom='2026-10-17T00:00:00.0000001Z', timelineTo='2026-10-17T18:00:00.1234567Z';
export function timelineMetadata(){const value=metadata();value.execution_statuses=[{code:1,name:'created'},{code:2,name:'running'},{code:4,name:'failed'},{code:7,name:'succeeded'}];return value;}
export const overviewPage=(bounds={})=>({...envelope([{execution_id:'1',folder_name:'Folder',project_name:'Project',package_name:'Main.dtsx',status:{code:2,name:'running'},
  created_at:bounds.from??timelineFrom,started_at:null,ended_at:null,duration_seconds:null,elapsed_seconds:null,warning_count:0,error_count:0}]),
  meta:{...envelope().meta,from:timelineFrom,to:timelineTo,as_of:wireTime,upper_id:'99',consistency:'live',sort:'execution_id',direction:'desc',limit:50,has_more:false,next_cursor:null,...bounds}});
export const timelineSummary=(bounds={})=>({...envelope({total:10,by_status:[{code:1,name:'created',count:0},{code:2,name:'running',count:5},{code:4,name:'failed',count:2},{code:7,name:'succeeded',count:3}]}),
  meta:{...envelope().meta,from:timelineFrom,to:timelineTo,status_scope:'all',...bounds}});
export const timelineBucket=(start='2026-10-16T23:00:00.0000000Z',end='2026-10-17T23:00:00.0000000Z',changes={})=>({start,end,created_count:10,started_count:8,succeeded_count:3,failed_count:2,...changes});
export const timelinePage=(data=[timelineBucket()],meta={})=>({...envelope(data),meta:{...envelope().meta,from:timelineFrom,to:timelineTo,timezone:'Europe/London',bucket:'day',selected_statuses:[],...meta}});

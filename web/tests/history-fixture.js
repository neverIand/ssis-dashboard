import { metadata, envelope, wireTime } from './fixtures.js';
import { detailResponse } from './detail-fixture.js';

export function historyMetadata() {
  const value = metadata();
  value.execution_statuses = ['created','running','canceled','failed','pending','ended_unexpectedly','succeeded','stopping','completed'].map((name,index)=>({code:index+1,name}));
  return value;
}
export const historyRow = (id = '1', changes = {}) => {
  const {event_counts,...row} = detailResponse(id).data;
  return {...row,estimate:null,...changes};
};
export const historyPage = (data = [historyRow()], meta = {}) => ({...envelope(data),meta:{...envelope().meta,
  from:null,to:null,limit:50,sort:'execution_id',direction:'desc',as_of:wireTime,upper_id:'9223372036854775807',
  has_more:false,next_cursor:null,consistency:'live',...meta}});
export const estimate = (changes = {}) => ({method:'mean_last_5_successful',sample_count:5,duration_seconds:0.00000002,ended_at:wireTime,...changes});

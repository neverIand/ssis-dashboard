import { metadata, envelope, wireTime } from './fixtures.js';
import { detailResponse } from './detail-fixture.js';

export function historyMetadata() {
  const value = metadata();
  value.execution_statuses = ['created','running','cancelled','failed','pending','halted','succeeded','stopping','completed'].map((name,index)=>({code:index+1,name}));
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

// The Exact-mode suggestion panels of the standalone History form, for screen doubles built on `Node`.
export function suggestionNodes(Node, document, extra) {
  const panels = {};
  for (const key of ['folder', 'project', 'package']) {
    const panel = new Node(document, 'div'), list = new Node(document, 'ul');
    const status = new Node(document, 'p'), more = new Node(document, 'button');
    list.id = `history-${key}-suggestions`; panel.hidden = true; more.hidden = true;
    panel.append(list, status, more);
    const parts = { '[data-suggestion-list]': list, '[data-suggestion-status]': status, '[data-suggestion-more]': more };
    panel.querySelector = selector => parts[selector];
    extra.set(`[data-history-suggestions="${key}"]`, panel);
    panels[key] = { panel, list, status, more };
  }
  return panels;
}

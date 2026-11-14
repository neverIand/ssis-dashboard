import { mountBootstrap } from './bootstrap.js';
import { mountDetail } from './render-detail.js';

export function mountDetailScreen(root, saved = null) {
  let checkpoint = () => null;
  const dispose = mountBootstrap(root, { ready(metadata, api, config) {
    const detail = mountDetail(root, { metadata, api, executionId: config.execution_id,
      appBase: config.app_base, restoreView: saved?.detail });
    checkpoint = () => ({ detail: detail.checkpoint() });
    return detail.dispose;
  } });
  return { dispose, checkpoint: () => checkpoint() };
}

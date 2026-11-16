// Fit sticky headers to the viewport; reveal a new page only after an explicit paging action.
export function mountTableViewport(table, scroll, toolbar) {
  const window = table.ownerDocument.defaultView;
  let page = null, pending = null, revealPage = null;
  scroll.dataset.stickyTable = '';
  if (toolbar) toolbar.dataset.stickyToolbar = '';
  function fit() {
    const fits = table.getBoundingClientRect().width <= scroll.clientWidth + 0.5;
    if (fits) scroll.dataset.fits = ''; else delete scroll.dataset.fits;
    if (toolbar) scroll.style.setProperty?.('--sd-list-toolbar-height', `${toolbar.getBoundingClientRect().height}px`);
  }
  function reveal() {
    const header = table.querySelector('thead')?.getBoundingClientRect();
    if (!toolbar || !header) return;
    const bar = toolbar.getBoundingClientRect();
    const sticky = window.getComputedStyle(toolbar).position === 'sticky';
    const top = sticky ? Math.max(0, bar.bottom) : 0;
    if (header.top >= top && header.bottom <= window.innerHeight) return;
    // A stuck toolbar's current rect is at zero. Its layout anchor still gives its natural document position.
    const position = toolbar.style.position;
    toolbar.style.position = 'static';
    const y = toolbar.getBoundingClientRect().top + window.scrollY;
    toolbar.style.position = position;
    window.scrollTo({ left: window.scrollX, top: y, behavior: 'instant' });
  }
  window.addEventListener?.('resize', fit);
  return {
    pageChange() { pending = { page }; revealPage = null; },
    cancelPageChange() { pending = revealPage = null; },
    update(nextPage, { busy, reveal: allowed = true }) {
      page = nextPage;
      fit();
      if (busy || !allowed) revealPage = null;
      if (busy) return;
      const changed = pending && page && page !== pending.page;
      pending = null;
      if (changed && allowed) {
        const loaded = revealPage = page;
        // The containing detail view restores its refresh position after rendering all sections.
        queueMicrotask(() => {
          if (revealPage !== loaded) return;
          revealPage = null;
          reveal();
        });
      }
    },
    dispose() {
      window.removeEventListener?.('resize', fit);
      delete scroll.dataset.stickyTable;
      delete scroll.dataset.fits;
      if (toolbar) delete toolbar.dataset.stickyToolbar;
      scroll.style.removeProperty?.('--sd-list-toolbar-height');
      page = pending = revealPage = null;
    },
  };
}

// Reserve geometry, never payloads. Call before replacing a loaded region's DOM.
export function reserveLoadingSpace(region) {
  let holding = false;
  return (loading, hasContent = false) => {
    if (loading && !holding) {
      const height = hasContent ? region.getBoundingClientRect().height : 0;
      region.style.minHeight = height > 0 ? `${Math.ceil(height)}px` : '';
      region.setAttribute('data-loading', '');
    } else if (!loading && holding) {
      region.style.minHeight = '';
      region.removeAttribute('data-loading');
    }
    holding = loading;
  };
}

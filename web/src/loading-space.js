// Reserve geometry, never payloads. Call before replacing a loaded region's DOM.
export function reserveLoadingSpace(region, axis = 'height') {
  const property = axis === 'width' ? 'minWidth' : 'minHeight';
  let holding = false;
  return (loading, hasContent = false) => {
    if (loading && !holding) {
      const size = hasContent ? region.getBoundingClientRect()[axis] : 0;
      // A held width never exceeds its line, so narrowing the window during a read cannot overflow.
      const value = axis === 'width' ? `min(${Math.ceil(size)}px, 100%)` : `${Math.ceil(size)}px`;
      region.style[property] = size > 0 ? value : '';
      region.setAttribute('data-loading', '');
    } else if (!loading && holding) {
      region.style[property] = '';
      region.removeAttribute('data-loading');
    }
    holding = loading;
  };
}

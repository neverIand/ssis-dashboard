// Only the native state/activation boundary is doubled. Browser tests own light-dismiss ordering and focus/layout.
export function popoverButton(button, panel, action = 'toggle') {
  const dispatch = button.dispatchEvent.bind(button);
  button.dispatchEvent = event => {
    const result = dispatch(event);
    if (event.type === 'click' && !event.defaultPrevented && !button.disabled) {
      if (action === 'hide' || panel.matches(':popover-open')) panel.hidePopover();
      else panel.showPopover();
    }
    return result;
  };
}

export function installPopover(panel, trigger = null, autofocus = () => null) {
  const document = panel.ownerDocument;
  let open = false, hiding = false;
  panel.matches = selector => selector === ':popover-open' && open;
  panel.showPopover = () => {
    if (open) return;
    const event = Object.assign(new Event('beforetoggle', { cancelable: true }), { oldState: 'closed', newState: 'open' });
    if (!panel.dispatchEvent(event)) return;
    if (trigger) {
      for (const other of document.openPopovers ?? []) other.hidePopover();
      (document.openPopovers ??= new Set()).add(panel);
    }
    open = true;
    const first = autofocus();
    if (first?.autofocus) first.focus();
  };
  panel.hidePopover = () => {
    if (!open || hiding) return;
    hiding = true;
    panel.dispatchEvent(Object.assign(new Event('beforetoggle'), { oldState: 'open', newState: 'closed' }));
    open = hiding = false;
    document.openPopovers?.delete(panel);
    if (trigger && panel.contains(document.activeElement)) trigger.focus();
  };
  if (trigger) popoverButton(trigger, panel);
}

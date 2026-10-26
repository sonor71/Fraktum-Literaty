const pending = new Set();

// Keep feedback outside #app: reporting an error must not remount an unsaved form.
export function showFeedback(message, {kind = 'status'} = {}) {
  document.querySelector('#operationFeedback')?.remove();
  const box = document.createElement('section');
  box.id = 'operationFeedback';
  box.className = `operation-feedback ${kind === 'error' ? 'error' : ''}`;
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = String(message);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Закрыть уведомление');
  close.addEventListener('click', () => box.remove());
  box.append(text, close);
  document.body.appendChild(box);
}

export function withOperation(handler, {report = showFeedback} = {}) {
  return async event => {
    const control = event.type === 'submit'
      ? event.submitter || event.target.querySelector?.('button[type="submit"],button:not([type])')
      : event.target.closest?.('[data-action]');
    const action = control?.dataset?.action;
    const key = action
      ? `action:${action}:${control.dataset.id || control.dataset.targetId || ''}:${control.dataset.kind || ''}`
      : event.type === 'submit' ? `form:${event.target.id || event.target.dataset?.thread || ''}` : null;
    if (key && pending.has(key)) { event.preventDefault(); return; }
    if (control?.disabled) return;
    if (key) pending.add(key);
    if (key && (event.type === 'submit' || action !== 'close-modal')) {
      globalThis.document?.querySelector?.('#operationFeedback')?.remove();
    }
    const wasDisabled = control?.disabled;
    if (control) {
      control.setAttribute('aria-busy', 'true');
      if ('disabled' in control) control.disabled = true;
    }
    try {
      return await handler(event);
    } catch (error) {
      report(`Действие не выполнено: ${error instanceof Error ? error.message : String(error)}`, {kind: 'error'});
    } finally {
      if (key) pending.delete(key);
      if (control) {
        control.removeAttribute('aria-busy');
        if ('disabled' in control) control.disabled = wasDisabled;
      }
    }
  };
}

import { button, esc, iconButton } from './ui.js';

export function openDialog(title, body) {
  const dialog = document.querySelector('#dialog');
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-head"><h2 class="section-title" id="dialog-title">${esc(title)}</h2>${iconButton('Fechar diálogo', 'close', 'data-close')}</div><div class="dialog-body">${body}</div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.showModal();
  return dialog;
}

export function confirmAction(title, message, confirm = 'Confirmar') {
  const dialog = openDialog(title, `<p class="muted">${esc(message)}</p><div class="form-actions dialog-actions">${button('Cancelar', '', '', 'data-close autofocus')}${button(confirm, '', 'danger', 'data-confirm')}</div>`);
  return new Promise(resolve => {
    let accepted = false;
    dialog.querySelector('[data-confirm]').addEventListener('click', () => { accepted = true; dialog.close(); });
    dialog.addEventListener('close', () => resolve(accepted), { once: true });
  });
}

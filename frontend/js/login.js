import { api } from './api.js';
import { button, onSubmit } from './ui.js';

const form = document.querySelector('#login-form');
const params = new URLSearchParams(location.search);
const next = params.get('next');
const destination = next?.startsWith('#/') ? `/${next}` : '/#/dashboard';

onSubmit(form, async values => {
  await api('/auth/login', { method: 'POST', body: { email: values.get('email').trim(), password: values.get('password') }, session: false });
  location.replace(destination);
});

const demo = { admin: 'Administrador', gestor: 'Gestor', atendente: 'Atendente', solicitante: 'Solicitante' };

try {
  const publicInfo = await api('/auth/public', { session: false });
  if (publicInfo.demo) {
    const choices = document.querySelector('#demo-roles');
    choices.innerHTML = Object.entries(demo).map(([id, label]) => button(label, '', 'compact', `data-demo="${id}"`)).join('');
    choices.addEventListener('click', event => {
      const profile = event.target.closest('[data-demo]')?.dataset.demo;
      if (!profile || form.querySelector('[type="submit"]').disabled) return;
      form.elements.email.value = `${profile}@nexus.demo`;
      form.elements.password.value = 'NexusDemo#2026';
      form.requestSubmit();
    });
    document.querySelector('#demo-panel').hidden = false;
  }
} catch { /* The form displays connection feedback on submission. */ }

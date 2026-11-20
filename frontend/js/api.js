import { apiBase } from '/config.js';

export class ApiError extends Error {
  constructor(message, status, fields = []) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function api(path, { method = 'GET', body, signal, binary, session = true } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Nexus-Request'] = '1';
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, { method, credentials: 'include', headers, body, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('Sem conexão com o Nexus Desk. Verifique a conexão e tente novamente.', 0);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && session) window.dispatchEvent(new Event('nexus:session-expired'));
    throw new ApiError(error.error ?? `Não foi possível concluir a solicitação (${response.status}).`, response.status, error.fields);
  }
  if (binary) return response.blob();
  return response.headers.get('Content-Type')?.includes('application/json') ? response.json() : undefined;
}

export function queryString(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const search = new URLSearchParams(entries).toString();
  return search ? `?${search}` : '';
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

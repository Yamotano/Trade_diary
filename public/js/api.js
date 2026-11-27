import { cloud } from './cloud.js';

async function request(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('Нет связи с сервером. Проверьте, что запущен node server.js');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  if (!res.ok) throw new Error(data && data.error ? data.error : `Ошибка запроса (${res.status})`);
  return data;
}

const localApi = {
  load: () => request('GET', '/data'),
  create: (table, row) => request('POST', `/${table}`, row),
  update: (table, id, row) => request('PUT', `/${table}/${id}`, row),
  remove: (table, id) => request('DELETE', `/${table}/${id}`),
  saveJournal: (row) => request('PUT', '/journal', row),
  bulkTrades: (rows) => request('POST', '/trades/bulk', { trades: rows }),
  demo: () => request('POST', '/demo'),
  clear: () => request('DELETE', '/data'),
  restore: (snapshot) => request('POST', '/restore', snapshot),
};

export const isCloud = cloud.enabled;

// В облачном режиме все операции идут в Supabase (PostgREST + RLS),
// в локальном — в Node-сервер с SQLite.
export const api = isCloud ? cloud.api : localApi;

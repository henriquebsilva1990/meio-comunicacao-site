import { json, sessaoValida, pedidoDoAdmin } from '../_lib.js';

// Tudo em /api/innocondo/admin/* exige sessão; escrita exige também o cabeçalho do admin.
export async function onRequest({ request, env, next }) {
  if (!(await sessaoValida(request, env))) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
  if (request.method !== 'GET' && !pedidoDoAdmin(request)) return json({ erro: 'Pedido inválido.' }, 400);
  return next();
}

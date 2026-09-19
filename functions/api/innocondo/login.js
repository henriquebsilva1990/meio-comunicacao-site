import { json, conferirSenha, hashAtual, criarSessao, pedidoDoAdmin } from './_lib.js';

const TENTATIVAS = 8;       // por IP
const JANELA_SEG = 15 * 60; // 15 minutos

export async function onRequestPost({ request, env }) {
  if (!pedidoDoAdmin(request)) return json({ erro: 'Pedido inválido.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || 'sem-ip';
  const chave = `rl:${ip}`;
  const feitas = Number((await env.INNOCONDO_KV.get(chave)) || 0);
  if (feitas >= TENTATIVAS) return json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);

  let senha = '';
  try { senha = String((await request.json())?.senha || ''); } catch { /* corpo inválido */ }
  if (senha && senha.length <= 200 && await conferirSenha(senha, await hashAtual(env))) {
    await env.INNOCONDO_KV.delete(chave);
    return json({ ok: true }, 200, { 'Set-Cookie': await criarSessao(env) });
  }
  await env.INNOCONDO_KV.put(chave, String(feitas + 1), { expirationTtl: JANELA_SEG });
  return json({ erro: 'Senha incorreta.' }, 401);
}

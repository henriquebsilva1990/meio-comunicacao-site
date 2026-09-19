import { json, conferirSenha, hashAtual, hashSenha } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  let atual = '', nova = '';
  try { ({ atual = '', nova = '' } = await request.json()); } catch { return json({ erro: 'Formato inválido.' }, 400); }
  if (!(await conferirSenha(String(atual), await hashAtual(env)))) return json({ erro: 'Senha atual incorreta.' }, 403);
  nova = String(nova);
  if (nova.length < 10 || nova.length > 200) return json({ erro: 'A nova senha precisa ter de 10 a 200 caracteres.' }, 422);
  await env.INNOCONDO_KV.put('auth:hash', await hashSenha(nova));
  return json({ ok: true });
}

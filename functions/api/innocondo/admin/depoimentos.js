import { json, lerDepoimentos, validarLista, limparFotosOrfas } from '../_lib.js';

export async function onRequestGet({ env }) {
  return json(await lerDepoimentos(env));
}

export async function onRequestPut({ request, env, waitUntil }) {
  let entrada;
  try { entrada = await request.json(); } catch { return json({ erro: 'Formato inválido.' }, 400); }
  const { lista, erro } = validarLista(entrada);
  if (erro) return json({ erro }, 422);
  await env.INNOCONDO_KV.put('depoimentos', JSON.stringify(lista));
  waitUntil(limparFotosOrfas(env, lista));
  return json({ ok: true, lista });
}

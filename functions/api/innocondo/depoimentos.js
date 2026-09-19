import { json, lerDepoimentos, paraPublico } from './_lib.js';

// Público: o site lê esta lista. Cache curto para a edição aparecer em até 1 minuto.
export async function onRequestGet({ env }) {
  const lista = paraPublico(await lerDepoimentos(env));
  return json(lista, 200, { 'Cache-Control': 'public, max-age=30, s-maxage=60', 'Access-Control-Allow-Origin': '*' });
}

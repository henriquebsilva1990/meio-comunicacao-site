import { json, LIMITES, TIPOS_FOTO } from '../_lib.js';

// Recebe a foto já recortada e reduzida no navegador; guarda com id novo.
export async function onRequestPost({ request, env }) {
  const tipo = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!TIPOS_FOTO.includes(tipo)) return json({ erro: 'Envie JPG, PNG ou WebP.' }, 415);
  const corpo = await request.arrayBuffer();
  if (!corpo.byteLength) return json({ erro: 'Arquivo vazio.' }, 400);
  if (corpo.byteLength > LIMITES.fotoBytes) return json({ erro: 'Foto grande demais (máx. 400 KB).' }, 413);
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.INNOCONDO_KV.put(`foto:${id}`, corpo, { metadata: { tipo, criado: Date.now() } });
  return json({ ok: true, id, url: `/api/innocondo/foto/${id}` });
}

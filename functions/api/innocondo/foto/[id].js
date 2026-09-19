import { idValido } from '../_lib.js';

export async function onRequestGet({ params, env }) {
  if (!idValido(params.id)) return new Response('Não encontrado', { status: 404 });
  const { value, metadata } = await env.INNOCONDO_KV.getWithMetadata(`foto:${params.id}`, { type: 'arrayBuffer' });
  if (!value) return new Response('Não encontrado', { status: 404 });
  // O id muda a cada envio de foto, então o arquivo pode ficar em cache para sempre.
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.tipo || 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

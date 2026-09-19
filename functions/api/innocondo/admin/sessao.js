import { json } from '../_lib.js';

// Só chega aqui quem passou pelo _middleware: serve para o painel saber se já está logado.
export async function onRequestGet() {
  return json({ ok: true });
}

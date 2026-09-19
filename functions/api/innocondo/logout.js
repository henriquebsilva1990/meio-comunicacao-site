import { json, sairCookie } from './_lib.js';

export async function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': sairCookie });
}

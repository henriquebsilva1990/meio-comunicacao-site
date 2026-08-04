// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: quiz-lead
// Único caminho de escrita na tabela v2.quiz_leads.
// A chave anon nunca toca a tabela — aqui dentro usamos service_role.
//
// Ações:
//   start     → cria a lead (tela de cadastro) e devolve o session_token
//   progress  → salva nicho / respostas / última tela (salvamento progressivo)
//   finish    → calcula o perfil no servidor, conclui e notifica o Telegram
//   whatsapp  → marca que a lead clicou no botão de agendamento
//
// Deploy: supabase functions deploy quiz-lead
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Pepper do hash de IP. Não é segredo criptográfico — só impede que o hash
// seja revertido por força bruta sobre o espaço de IPv4.
const IP_PEPPER = Deno.env.get("QUIZ_IP_PEPPER") ?? "meio-quiz-instagram-v1";

// Máximo de cadastros por IP numa janela — freio de spam, não de tráfego real.
const RATE_MAX = 8;
const RATE_WINDOW_MIN = 15;

const ORIGIN_ALLOWLIST = [
  "https://meiocomunica.com.br",
  "https://www.meiocomunica.com.br",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const ok =
    origin &&
    (ORIGIN_ALLOWLIST.includes(origin) ||
      /^https:\/\/[a-z0-9-]+\.meio-comunicacao-site\.pages\.dev$/.test(origin) ||
      origin === "https://meio-comunicacao-site.pages.dev" ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGIN_ALLOWLIST[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// ── Validação ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Normaliza para E.164 brasileiro (55 + DDD + número). Devolve null se inválido. */
function normalizeWhatsapp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/\D/g, "");
  if (d.length >= 10 && d.length <= 11) d = "55" + d; // veio sem DDI
  if (!/^55[1-9][0-9]{9,10}$/.test(d)) return null;
  return d;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.slice(0, max);
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Pontuação (fonte da verdade — o cliente nunca decide o perfil) ───────────

const PERFIL_POR_LETRA: Record<string, "timida" | "sem_constancia" | "perdida"> =
  { A: "timida", B: "sem_constancia", C: "perdida" };

/**
 * A = Tímida, B = Sem constância, C = Perdida.
 * Vence quem acumular mais respostas. Empate resolve na ordem
 * Tímida > Sem constância > Perdida — insegurança é a barreira mais profunda,
 * então é a primeira a ser tratada.
 */
function pontuar(respostas: Record<string, string>) {
  let a = 0, b = 0, c = 0;
  for (const letra of Object.values(respostas ?? {})) {
    if (letra === "A") a++;
    else if (letra === "B") b++;
    else if (letra === "C") c++;
  }
  const max = Math.max(a, b, c);
  const perfil = a === max ? "timida" : b === max ? "sem_constancia" : "perdida";
  return { a, b, c, perfil };
}

const NOME_PERFIL: Record<string, string> = {
  timida: "Tímida",
  sem_constancia: "Sem constância",
  perdida: "Perdida",
};

// ── Notificação ──────────────────────────────────────────────────────────────

/**
 * Avisa a agência a cada evento do quiz.
 *
 * O notificador da VPS resolve destinatários assim (scripts/ops/vps/notifier.js):
 *   regra 1 — quem tem papel 'henrique' recebe SEMPRE (Telegram + WhatsApp);
 *   regra 2 — a pessoa nomeada em `triggered_by` recebe pelo canal dela.
 * Não existe campo de destinatário explícito, então `triggered_by` é o único
 * jeito de endereçar sem alterar infra compartilhada. Apontamos para 'meio',
 * cadastrado em v2.notify_registry com o WhatsApp comercial 5516997340173.
 *
 * Quem recebe: Henrique (Telegram + WhatsApp, regra 1) e o número da Meio
 * (WhatsApp, regra 2). Efeito colateral do notificador: ele acrescenta a linha
 * "— disparado por: meio" no fim da mensagem.
 *
 * Falha de notificação nunca derruba a resposta ao usuário.
 */
async function notificar(
  db: ReturnType<typeof createClient>,
  resumo: string,
): Promise<void> {
  const { error } = await db.from("v2_notify_outbox").insert({
    tenant: "meio",
    origem: "nexus",
    agente: "quiz-instagram",
    status: "done",
    resumo,
    triggered_by: "meio",
  });
  if (error) console.error("notify_outbox falhou:", error.message);
}

/** Aceita só as 6 chaves esperadas com valores A/B/C. Ignora o resto. */
function sanitizeRespostas(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (/^[1-6]$/.test(k) && typeof v === "string" && PERFIL_POR_LETRA[v]) {
      out[k] = v;
    }
  }
  return out;
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: cors,
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: cors,
    });
  }

  const action = body.action;

  try {
    // ── start ───────────────────────────────────────────────────────────────
    if (action === "start") {
      // Honeypot: campo invisível preenchido = bot. Devolve sucesso falso
      // para não ensinar o bot que foi detectado.
      if (typeof body.website === "string" && body.website.trim() !== "") {
        return new Response(
          JSON.stringify({ session_token: crypto.randomUUID() }),
          { headers: cors },
        );
      }

      const nome = cleanText(body.nome, 120);
      const email = cleanText(body.email, 160)?.toLowerCase() ?? null;
      const whatsapp = normalizeWhatsapp(body.whatsapp);

      if (!nome || nome.length < 2) {
        return new Response(JSON.stringify({ error: "nome_invalido" }), {
          status: 422, headers: cors,
        });
      }
      if (!email || !EMAIL_RE.test(email)) {
        return new Response(JSON.stringify({ error: "email_invalido" }), {
          status: 422, headers: cors,
        });
      }
      if (!whatsapp) {
        return new Response(JSON.stringify({ error: "whatsapp_invalido" }), {
          status: 422, headers: cors,
        });
      }
      if (body.consentimento !== true) {
        return new Response(JSON.stringify({ error: "consentimento_obrigatorio" }), {
          status: 422, headers: cors,
        });
      }

      const ip =
        req.headers.get("cf-connecting-ip") ??
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "sem-ip";
      const ipHash = await sha256(ip + IP_PEPPER);

      // Rate limit por IP
      const desde = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
      const { count } = await db
        .from("v2_quiz_leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", desde);

      if ((count ?? 0) >= RATE_MAX) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: cors,
        });
      }

      const utm = (body.utm ?? {}) as Record<string, unknown>;
      const sessionToken = crypto.randomUUID();

      const { error } = await db.from("v2_quiz_leads").insert({
        session_token: sessionToken,
        nome,
        whatsapp,
        whatsapp_raw: cleanText(body.whatsapp, 40),
        email,
        status: "iniciado",
        ultima_tela: 1,
        consentimento_lgpd: true,
        consentido_em: new Date().toISOString(),
        utm_source: cleanText(utm.source, 120),
        utm_medium: cleanText(utm.medium, 120),
        utm_campaign: cleanText(utm.campaign, 160),
        utm_content: cleanText(utm.content, 160),
        utm_term: cleanText(utm.term, 160),
        referrer: cleanText(body.referrer, 400),
        user_agent: cleanText(req.headers.get("user-agent"), 400),
        ip_hash: ipHash,
      });

      if (error) throw error;

      // Novo cadastro: avisa na hora, antes mesmo de a lead responder o quiz.
      // Se ela abandonar no meio, o contato já está com vocês.
      const origemCad = [utm.source, utm.campaign].filter(Boolean).join(" / ");
      await notificar(
        db,
        `📝 Novo cadastro no Quiz de Instagram\n` +
          `${nome}\n` +
          `WhatsApp: ${whatsapp}\n` +
          `E-mail: ${email}` +
          (origemCad ? `\nOrigem: ${origemCad}` : "") +
          `\n\nAinda não respondeu o quiz — o perfil chega quando ela concluir.`,
      );

      return new Response(JSON.stringify({ session_token: sessionToken }), {
        headers: cors,
      });
    }

    // ── progress ────────────────────────────────────────────────────────────
    if (action === "progress") {
      const token = cleanText(body.session_token, 40);
      if (!token) {
        return new Response(JSON.stringify({ error: "sem_token" }), {
          status: 422, headers: cors,
        });
      }

      const respostas = sanitizeRespostas(body.respostas);
      const { a, b, c } = pontuar(respostas);

      const patch: Record<string, unknown> = {
        respostas,
        score_a: a,
        score_b: b,
        score_c: c,
        status: "em_andamento",
      };

      const nicho = cleanText(body.nicho, 160);
      if (nicho) patch.nicho = nicho;

      const tela = Number(body.ultima_tela);
      if (Number.isFinite(tela) && tela >= 1 && tela <= 10) patch.ultima_tela = tela;

      const { error } = await db
        .from("v2_quiz_leads")
        .update(patch)
        .eq("session_token", token);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ── finish ──────────────────────────────────────────────────────────────
    if (action === "finish") {
      const token = cleanText(body.session_token, 40);
      if (!token) {
        return new Response(JSON.stringify({ error: "sem_token" }), {
          status: 422, headers: cors,
        });
      }

      const respostas = sanitizeRespostas(body.respostas);
      if (Object.keys(respostas).length < 6) {
        return new Response(JSON.stringify({ error: "respostas_incompletas" }), {
          status: 422, headers: cors,
        });
      }

      const { a, b, c, perfil } = pontuar(respostas);

      const { data: rows, error } = await db
        .from("v2_quiz_leads")
        .update({
          respostas,
          score_a: a,
          score_b: b,
          score_c: c,
          perfil,
          status: "concluido",
          ultima_tela: 10,
          concluido_em: new Date().toISOString(),
        })
        .eq("session_token", token)
        .select("nome, whatsapp, email, nicho, utm_source, utm_campaign");

      if (error) throw error;

      const lead = rows?.[0];

      if (lead) {
        const origem = [lead.utm_source, lead.utm_campaign]
          .filter(Boolean)
          .join(" / ");
        await notificar(
          db,
          `🎯 Quiz concluído — lead qualificada\n` +
            `${lead.nome} — perfil ${NOME_PERFIL[perfil]}\n` +
            `WhatsApp: ${lead.whatsapp}\n` +
            `E-mail: ${lead.email}\n` +
            `Nicho: ${lead.nicho ?? "não informado"}` +
            (origem ? `\nOrigem: ${origem}` : ""),
        );
      }

      return new Response(JSON.stringify({ perfil }), { headers: cors });
    }

    // ── whatsapp ────────────────────────────────────────────────────────────
    if (action === "whatsapp") {
      const token = cleanText(body.session_token, 40);
      if (!token) {
        return new Response(JSON.stringify({ error: "sem_token" }), {
          status: 422, headers: cors,
        });
      }

      const { error } = await db
        .from("v2_quiz_leads")
        .update({
          clicou_whatsapp: true,
          clicou_whatsapp_em: new Date().toISOString(),
        })
        .eq("session_token", token);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: "acao_desconhecida" }), {
      status: 400,
      headers: cors,
    });
  } catch (err) {
    console.error("quiz-lead:", err);
    return new Response(JSON.stringify({ error: "erro_interno" }), {
      status: 500,
      headers: cors,
    });
  }
});

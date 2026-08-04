# Quiz de Diagnóstico — Instagram

Quiz de captação em `meiocomunica.com.br/quiz-instagram/`. Identifica o perfil da lead
entre Tímida, Sem constância e Perdida, entrega o diagnóstico e oferece o
**Mapa de Ação — Instagram** com 50% de desconto.

## Arquivos

| Arquivo | O quê |
|---|---|
| `index.html` | O quiz. HTML/CSS/JS puro, sem bibliotecas, sem build. |
| `quiz.json` | Perguntas, resultados, preço e cupom. **Edite aqui, não no HTML.** |
| `admin.html` | Lista de leads, filtros e exportar CSV. Login do Nexus. |
| `_infra/migration-quiz-leads.sql` | DDL aplicado no Supabase (cópia para o histórico). |
| `_infra/edge-function-quiz-lead.ts` | Fonte da edge function `quiz-lead`. |

## Como funciona

```
Abertura → Cadastro → Nicho → 6 perguntas → Resultado
              │         │         │             │
              └── grava ┴─ grava ─┴── grava ────┘
```

O cadastro (nome, WhatsApp, e-mail) vem **antes** do quiz e cada passo é gravado na
hora. Quem abandona no meio continua sendo lead, com o registro de onde parou —
é o que o admin mostra como "Abandonou no meio (tela N)".

### Escrita no banco

A chave anon **nunca** toca a tabela. Tudo passa pela edge function `quiz-lead`,
que valida, aplica honeypot e rate limit, e escreve com `service_role`.

O schema `v2` não é exposto pelo PostgREST — por isso a função escreve pelas views
`public.v2_quiz_leads` e `public.v2_notify_outbox`, não por `.schema("v2")`.

### O perfil é calculado no servidor

A = Tímida, B = Sem constância, C = Perdida. Vence quem tiver mais respostas;
empate resolve em Tímida > Sem constância > Perdida. O cliente pode mandar
qualquer coisa no campo `perfil` — a função ignora e recalcula.

### Notificações

Cada cadastro novo e cada quiz concluído gera uma linha em `v2_notify_outbox`.
O notificador da VPS (`scripts/ops/vps/notifier.js` do repo nexus) resolve
destinatários assim:

- **regra 1** — quem tem `papel = 'henrique'` recebe sempre (Telegram + WhatsApp);
- **regra 2** — a pessoa nomeada em `triggered_by` recebe pelo canal dela.

Não existe campo de destinatário explícito, então usamos `triggered_by: 'meio'`,
que aponta para a linha `meio` de `v2.notify_registry` (WhatsApp comercial da
agência, 5516997340173).

Quem recebe: **Henrique** (Telegram + WhatsApp, pela regra 1) e o **número da
Meio** (WhatsApp, pela regra 2). **Efeito colateral:** o notificador acrescenta a
linha "— disparado por: meio" no fim da mensagem. A correção limpa é uma regra
adicional no notifier da VPS.

## Editar o conteúdo

Mexa em `quiz.json` e faça push. `{nome}` vira o primeiro nome da lead;
`{perfil}` (só na mensagem do WhatsApp) vira o rótulo do perfil.

Trocar as perguntas exige manter as chaves `A`/`B`/`C` — a pontuação depende delas.

## Banco

Tabela `v2.quiz_leads`, view `public.v2_quiz_leads`.

**Sem trigger de auditoria, de propósito.** O salvamento progressivo faz ~9 escritas
por lead; auditar isso multiplicaria o volume sem servir para nada — foi assim que o
disco encheu em julho de 2026.

## Deploy

Site: push na `main` → GitHub Actions → Cloudflare Pages.

Edge function:

```bash
supabase functions deploy quiz-lead --project-ref wrxgpfsjupgbtowuspth
```

## Qualidade verificada em 04/08/2026

Lighthouse mobile 100/100/100/100 · desktop 99/100/100/100.

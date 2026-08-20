# F-031 — Auditoria de arquitetura zero-cost para VTT realtime

Exigida antes de implementar F-031 (`docs/product/FULL_ROADMAP.md`,
`.claude/CLAUDE.md` §9/§29). Pergunta: é possível sincronizar posição de
tokens, iniciativa/turno e troca de cena "em tempo real" entre GM e
jogadores sem sair da política Zero Cost (Cloudflare Workers Free)?

## O que a política Zero Cost permite hoje

Workers Free, D1 Free, KV Free, processamento no navegador, bibliotecas
OSS gratuitas — nunca R2, nunca Workers Paid, nunca serviço com cobrança
automática (`CLAUDE.md` §9).

## Por que WebSocket broadcast real não é viável em Zero Cost

O padrão correto da Cloudflare para coordenar várias conexões
WebSocket simultâneas (GM + N jogadores todos vendo o mesmo estado ao
vivo) são **Durable Objects** — é o único primitivo da plataforma que
mantém estado coordenado e roteia mensagens entre conexões que podem
cair em isolates/edges diferentes. **Durable Objects não existem no
plano Free** — exigem Workers Paid (US$5/mês mínimo), o que viola
diretamente a política Zero Cost (`CLAUDE.md` §9: "Não ativar plano
pago", "Se uma solução gratuita atingir o limite: preferir
falha/degradação controlada a cobrança").

Um Worker plano comum (`WebSocketPair`) consegue abrir e manter UMA
conexão WebSocket, mas sem Durable Objects não há como um Worker que
recebe a atualização do GM (numa requisição) "empurrar" essa atualização
para as conexões abertas dos jogadores (que vivem em invocações/isolates
diferentes) — não existe estado compartilhado em memória entre
invocações do Worker. Contornar isso com D1/KV como intermediário de
"fila de eventos" reintroduziria polling por baixo dos panos (o cliente
teria que checar a fila periodicamente de qualquer forma) com a
complexidade extra de um mecanismo de pub/sub artesanal — sem ganho real
sobre simplesmente fazer polling direto no endpoint que já existe.

## Decisão: polling client-side sobre `GET /vtt/:campaignId/live`

Não é realtime no sentido de push instantâneo — é a "degradação
controlada / sincronização alternativa gratuita" que o próprio pedido de
roadmap previu como resultado possível desta auditoria
(`docs/product/FULL_ROADMAP.md`, nota de F-031).

Por que é adequado para o caso de uso real (mesa de RPG por turnos, não
um jogo de reflexo):

- Uma mesa de RPG não exige latência sub-segundo — o ritmo natural de
  jogo (falar, decidir, mover) é medido em segundos, não em
  frames/milissegundos.
- `GET /vtt/:campaignId/live` **já existe** desde F-029/F-030/F-032 e já
  faz toda a filtragem de segurança do lado do servidor (nunca vaza
  `entityId`/`entityName`/HP/token oculto — ver `src/server/routes/vtt.ts`).
  Realtime via polling reaproveita o MESMO endpoint, MESMA barreira de
  segurança — não abre nenhum canal novo de leitura.
- Custo previsível e dentro do Free Tier: um poll a cada 3s por jogador
  conectado é uma fração ínfima do limite diário de requisições do
  Workers Free (100.000/dia) — mesmo uma mesa de 6 jogadores por 4h
  semanais consome uma ordem de grandeza a menos que esse limite.
- Sem necessidade de nenhuma infraestrutura nova (Durable Objects, fila,
  broker externo) — zero risco de custo, zero superfície nova de
  segurança além do que `/live` já tinha.

**Intervalo escolhido: 3 segundos**, com pausa automática quando a aba
não está em foco (`document.visibilitychange`) — evita poll
desnecessário quando o jogador não está olhando a tela, sem exigir
nenhuma biblioteca nova.

## O que fica de fora desta v1 (documentado, não escondido)

- **Posição de token arrastável em tempo real (drag ao vivo)**: fora de
  escopo — o jogador vê a posição atualizada a cada poll (até 3s de
  atraso), não um arrasto suave frame a frame. Aceitável para
  reposicionamento tático de mesa, não para um jogo de ação.
- **Notificação instantânea de troca de cena**: mesma limitação — até
  3s de atraso até o jogador ver a nova cena.
- Se no futuro houver orçamento real para Workers Paid, Durable Objects
  reabilitaria WebSocket verdadeiro sem precisar redesenhar o
  contrato de dados (o shape de `/live` continuaria o mesmo, só o
  transporte mudaria de poll para push) — não é um beco sem saída
  arquitetural, só adiado por custo.

## Conclusão

F-031 = polling de 3s sobre `/live` (GM já vê suas próprias mudanças
instantaneamente via estado local, sem precisar de poll). Implementado
como o componente de "visão ao vivo" do jogador para VTT, que também é
a peça que F-033 (Player View integrada) vai incorporar ao Portal.
`BLOCKED` fica resolvido — não por falta de solução técnica, mas porque
a solução real (polling) já foi encontrada e implementada.

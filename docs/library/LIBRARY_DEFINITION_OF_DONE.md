# Biblioteca — Definition of Done (LIB-001)

Status por escopo. `DONE` exige produção validada, não só código.

## Bug de coverUrl (escopo concreto do incidente) — `DONE`

- [x] RPG existente com coverUrl histórica → Editar → não mudar nada →
      Salvar → sucesso.
- [x] RPG existente → alterar apenas Quero jogar → Salvar → sucesso →
      capa histórica preservada.
- [x] RPG existente → alterar coverUrl para URL nova insegura → rejeitar,
      erro junto ao campo (não existe mais "host proibido" — é sobre a
      URL ser sintaticamente segura).
- [x] RPG existente → remover capa → salvar → comportamento correto.
- [x] RPG existente com URL atualmente aceita → editar sem alteração →
      sucesso.
- [x] CREATE com uma URL HTTPS pública de qualquer host → sucesso (não
      apenas PATCH — o bug também afetava criação de RPGs novos com
      capas de editoras não listadas).
- [x] Import CSV usa a mesma regra (canonical normalization
      compartilhada entre create/edit/import).
- [x] SSRF: URLs inseguras (IP privado/loopback, protocolo perigoso,
      não-HTTPS) continuam rejeitadas — testado explicitamente.
- [x] CSP (`img-src`) ajustada para não bloquear no navegador o que o
      servidor aceita.
- [x] lint, typecheck, unit (102), integration (35), E2E
      (desktop+mobile), build — todos verdes.
- [x] Commit `ec51077`, CI verde, deploy Version
      `77696b49-0204-47c9-92da-1cebea49c4d7`.
- [x] `/api/v1/version` confirma HEAD local == origin/main == build ==
      produção.
- [x] Smoke read-only em produção: 30 RPGs, nenhuma escrita feita.
- [ ] Smoke autenticado por clique real — `MANUAL_SMOKE_REQUIRED`
      (Turnstile/CAPTCHA, não contornado). Checklist:
      1. Login manual.
      2. Abrir um RPG existente → Editar → não alterar nada → Salvar →
         deve funcionar.
      3. Alterar "Quero jogar" → Salvar → capa preservada.
      4. Trocar a capa para uma URL de um editor **novo**, nunca usado
         antes no catálogo (ex.: qualquer loja HTTPS pública real) →
         deve salvar com sucesso (comportamento **novo**: antes desta
         sessão isso teria sido rejeitado se o host não estivesse na
         allowlist).

## Vertical slice completo (upload, providers, split de domínio) — `IN_PROGRESS`

Não implementado nesta sessão — desenhado e documentado:

- [ ] `docs/library/LIBRARY_ARCHITECTURE.md` — decisão de domínio
      (Opção A recomendada) — **documentado, não implementado**.
- [ ] `docs/library/COVER_STORAGE.md` — upload real + KV — **desenhado,
      não implementado**.
- [ ] `docs/library/METADATA_PROVIDERS.md` — Open Library — **desenhado,
      não implementado**.
- [ ] Dedup por ISBN (hoje é por título exato).
- [ ] Archive de RPG (hoje só existe delete físico).
- [ ] Preview antes de salvar metadata externa.

Essas linhas permanecem `NOT_STARTED` no
`docs/product/MASTER_BACKLOG.md`, sequenciadas para uma sessão futura
dedicada, com o mesmo rigor (audit → implement → test first → CI →
deploy → smoke) usado no bug corrigido nesta sessão.

## Por que o vertical slice não foi declarado DONE

A instrução do responsável do produto é explícita: "não faça feature
pela metade" e "não faça rewrite automaticamente" antes de documentar a
arquitetura. Implementar upload+KV+processamento de imagem+providers+
split de schema em uma única sessão já longa, sem o mesmo nível de
verificação aplicado ao resto do trabalho, produziria exatamente o tipo
de entrega apressada que a regra 29 do pedido original proíbe. O bug
funcional concreto (coverUrl rejeitando URLs válidas) está
genuinamente resolvido e verificado em produção; o restante fica
como plano acionável, não como pendência escondida.

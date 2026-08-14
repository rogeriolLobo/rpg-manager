# RPG MANAGER — ZERO COST POLICY

O projeto deve operar exclusivamente em infraestrutura gratuita.

## Regras

1. Nenhuma feature pode exigir plano pago.
2. Nenhuma feature pode exigir cartão de crédito.
3. Nenhum serviço com overage automático pode ser ativado.
4. R2 não será utilizado.
5. Workers deve permanecer no Free Plan.
6. D1 deve permanecer no Free Plan.
7. Ao atingir limites gratuitos, preferimos degradação/falha controlada
   a cobrança.
8. Assets grandes devem usar:
   - URL externa;
   - processamento local;
   - armazenamento local;
   - ou static assets autorizados.
9. Antes de introduzir qualquer nova dependência de infraestrutura,
   verificar:
   - preço atual;
   - free tier;
   - necessidade de billing;
   - possibilidade de cobrança automática.
10. Qualquer serviço que possa gerar custo precisa de autorização
    explícita do responsável pelo projeto.
11. Workers KV **Free** é permitido para armazenamento de binários
    pequenos (ex.: capas de RPG enviadas por upload — ver
    `docs/library/COVER_STORAGE.md`), dentro dos limites do tier
    gratuito (1 GB de storage, 100.000 reads/dia, 1.000 writes/dia,
    valores sujeitos aos termos vigentes da Cloudflare). Ao atingir
    qualquer um desses limites, a escrita/leitura deve falhar de forma
    controlada (erro claro ao usuário) — nunca cair automaticamente
    para R2 ou qualquer plano pago.
12. GitHub Actions deve permanecer dentro da franquia gratuita do
    GitHub Free. Otimizações permitidas e já aplicadas: `concurrency`
    cancelando runs supersedidos da mesma branch, `paths-ignore`
    pulando o pipeline em mudanças só de documentação, e um retry
    interno do Playwright (não um re-run do workflow inteiro) para
    absorver timing induzido por runner compartilhado. Se a franquia
    gratuita se esgotar: rodar testes localmente e publicar pelo fluxo
    de deploy local existente até a franquia resetar — nunca habilitar
    cobrança ou comprar minutos adicionais.

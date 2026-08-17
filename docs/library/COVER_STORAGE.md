# Capas de RPG — URL Externa (LIB-001) + Upload (LIB-005)

## URL externa (LIB-001 — em produção)

`coverUrl` é uma URL HTTPS pública, validada só sintaticamente
(`isPublicHttpsUrl`, `src/shared/security/cover-url.ts`):

- protocolo `https:` obrigatório;
- sem `username`/`password`/porta na URL;
- hostname não pode ser `localhost`/`.local`/`.internal`, nem um IP
  literal privado/loopback/link-local (`10.x`, `127.x`, `169.254.x`,
  `172.16-31.x`, `192.168.x`, `100.64-127.x`, `198.18-19.x`);
- **sem allowlist de hosts** — qualquer editora/loja do mundo funciona.

O **servidor nunca busca essa URL** — só o navegador, via `<img
src={...}>` (`CoverImage`, `src/client/pages/library-pages.tsx`), com
`loading="lazy"`/`"eager"`, `referrerPolicy="no-referrer"` e fallback
(`onError`) para um placeholder com as iniciais do título, sem loop de
requisição. Por isso a proteção contra SSRF de fetch remoto (que faria
sentido se o servidor buscasse a URL) não se aplica a este fluxo.

A CSP (`img-src`, `src/server/security/headers.ts` e `public/_headers`)
permite `'self' data: https:` — qualquer host HTTPS, mantendo
`script-src`/`style-src` restritos como antes.

### Por que não uma allowlist "melhor" em vez de removê-la

Uma allowlist de hosts para capas de RPG não escala: o catálogo mundial
de editoras, lojas e sites de referência (DriveThruRPG, lojas
regionais, sites de editoras pequenas, Wikipédia, etc.) é
essencialmente ilimitado. Manter uma lista fixa sempre vai deixar de
fora um editor legítimo (como aconteceu com `devir.com.br`) e exige
manutenção manual crescente. A validação correta para "URL só usada
pelo navegador" é sobre a **forma** da URL (protocolo seguro, sem
IP/host privado, sem credenciais embutidas) — não sobre uma lista
fechada de quem pode publicar imagens na internet.

## Upload de capa — LIB-005 (implementado, Zero Cost)

### Por que Workers KV Free (comparação de alternativas gratuitas)

Antes de assumir KV, as alternativas gratuitas realmente disponíveis na
conta (verificadas na documentação oficial da Cloudflare no momento da
implementação) foram avaliadas para "guardar poucos KB-MB de bytes de
imagem por Publication, servidos por ID":

| Opção | Free tier | Veredito |
|---|---|---|
| **Workers KV** | 1 GB storage, 100k reads/dia, 1k writes/dia (chave diferente), 1 write/s (mesma chave), valor até 25 MiB, chave até 512 bytes, metadata até 1024 bytes | **Escolhida** — encaixa exatamente no padrão de acesso (poucas escritas, muitas leituras, por chave), sem cartão/billing configurado na conta |
| **D1** | 5 GB storage, 5M rows read/dia, 100k rows written/dia | Tecnicamente possível (BLOB em coluna), mas D1 é relacional — misturar binário grande em linhas prejudica performance de leitura das tabelas principais e não é o uso pretendido do produto (fica só para os campos estruturados existentes) |
| **R2** | Tem free tier próprio (10 GB-mês, 1M Class A ops/mês, 10M Class B ops/mês) | **Proibido por política do projeto independente de custo** (CLAUDE.md §14, `ZERO_COST_POLICY.md`) — não avaliado além disso |
| **Durable Objects (SQLite-backed)** | Disponível no Free plan | Descartado por desalinhamento arquitetural, não por custo — DO é feito para coordenação/estado por objeto, não para servir blobs em massa por ID |
| **Cache API** | Gratuita | Descartada — sem garantia de persistência (pode ser evictada a qualquer momento), inadequada para dado que o usuário espera que persista |
| **Static Assets** | Gratuito, mas só em build/deploy | Descartada — não permite adicionar arquivos em runtime sem um redeploy completo |

Conclusão: **Workers KV Free**, com falha controlada (erro claro ao
usuário, nunca fallback automático para R2/pago) se a cota se esgotar —
ver `docs/architecture/ZERO_COST_POLICY.md`, item 11.

### D1 (aditivo — `migrations/0022_publication_cover_asset.sql`)

```sql
ALTER TABLE publications ADD COLUMN cover_asset_id TEXT;
```

A coluna vive em `publications` (não em `rpgs`) porque, desde o LIB-002,
`publications` é a fonte de verdade para todo campo editorial
compartilhado (título, ISBN, `cover_url`, etc. — ver
`docs/library/LIBRARY_ARCHITECTURE.md`). Capa por upload é o mesmo tipo
de dado editorial compartilhado, só armazenado de outra forma.

Deliberadamente **sem** `cover_type`/`CHECK` constraint: a precedência
entre "capa por upload" e "capa por URL externa" é só uma convenção de
**leitura** (ver abaixo), nunca uma constraint de banco — isso evita por
completo a necessidade de um rebuild de tabela (`DROP TABLE`) só para
adicionar este campo, e com isso o risco documentado em
`docs/architecture/DATABASE_MIGRATION_SAFETY.md` (incidente LIB-004B)
nem chega a se aplicar aqui.

`cover_url` (URL externa) **nunca é escrito** pelas rotas de upload —
enviar uma capa não apaga nem sobrescreve uma URL externa já persistida;
elas coexistem na mesma linha, e a apresentação decide qual mostrar.

### KV (`COVERS_KV`, `wrangler.jsonc`)

- Chave: `cover/{uuid}` (`coverAssetKvKey`, `src/domain/rpg/cover-asset.ts`).
- Valor: bytes da imagem já processada pelo navegador.
- Metadata do KV (não o D1): `contentType`, `uploadedAt`, `ownerUserId`.
- Nunca base64 em coluna D1 — D1 é relacional, não storage de binário.
- Ao trocar de capa, o asset anterior é removido do KV (best-effort,
  não bloqueia a resposta de sucesso) — evita acumular lixo na cota
  gratuita de 1 GB.
- Se a escrita no KV falhar (quota esgotada ou qualquer outro erro), a
  requisição falha com erro genérico tratado (500, mensagem em
  português) — nunca cai automaticamente para outro storage.

### Processamento (browser-first, antes do upload)

`processCoverImage`, `src/client/pages/library-pages.tsx`:

- Decodifica a imagem de verdade via `createImageBitmap` (nunca confia
  só em `filename`/MIME declarado do `File`).
- Redimensiona mantendo aspect ratio para o maior lado ≤ 800px.
- Reexporta como WebP (fallback JPEG) via `<canvas>.toBlob`.
- Rejeita no cliente, com mensagem amigável, se o resultado ainda
  exceder `MAX_COVER_ASSET_BYTES` (2 MB) mesmo após compressão.

O servidor **nunca confia nesse processamento** — `POST
/api/v1/rpgs/:id/cover` (`src/server/routes/rpgs.ts`) sempre revalida do
zero: tamanho (`Content-Length` + tamanho real do arquivo) e formato
real por "magic bytes" (`sniffCoverAssetContentType`,
`src/domain/rpg/cover-asset.ts` — JPEG/PNG/WebP; qualquer outro
conteúdo, mesmo com nome/extensão de imagem, é rejeitado com
`422 INVALID_COVER_FORMAT`).

### Endpoints

```
POST   /api/v1/rpgs/:id/cover    — envia/troca a capa (multipart/form-data, campo "cover")
DELETE /api/v1/rpgs/:id/cover    — remove a capa enviada
GET    /api/v1/media/covers/:id  — lê os bytes (usado como <img src>)
```

`POST`/`DELETE` (`rpgs.ts`) são ações **independentes** do formulário
principal de edição — não passam por `rpgInputSchema`/`coverUrl`, para
não interagir com o fluxo de URL externa já corrigido (LIB-001,
CLAUDE.md §18). Ambas exigem posse do RPG (mesma checagem `user_id`
usada no resto de `rpgs.ts`) e respeitam a mesma trava de metadata
compartilhada do LIB-003 (`SHARED_PUBLICATION_METADATA_LOCKED`,
`assertSharedPublicationEditable` em `library-writes.ts`) — capa por
upload é metadata editorial da Publication tanto quanto `cover_url`;
uma Publication reaproveitada por 2+ contas (mesmo ISBN) não pode ter a
capa trocada por uma única conta sem afetar as demais.

`GET /api/v1/media/covers/:id` (`media.ts`) é autenticado (herda
`requireAuth` do grupo `/api/v1/media/*` em `index.ts`) — GET é método
seguro, isento de CSRF, por isso funciona normalmente num `<img src>`.
`:id` é validado como UUID antes de qualquer lookup no KV; um ID
mal-formado ou de um asset já removido cai em `404 NOT_FOUND` — nunca
distingue "não existe" de "não autorizado". `Cache-Control: private,
max-age=31536000, immutable` (cada upload gera um UUID novo, nunca
reaproveitado para conteúdo diferente).

### Apresentação (precedência de leitura)

`present()` em `rpgs.ts` expõe `coverAssetId` como campo próprio (nunca
mistura com `coverUrl`). O cliente decide a URL efetiva de exibição
(`effectiveCoverSrc`, `CoverImage`, `library-pages.tsx`):

```
coverAssetId presente → /api/v1/media/covers/{coverAssetId}
caso contrário         → coverUrl (URL externa, ou null → placeholder)
```

O campo `coverUrl` do formulário de edição continua vinculado
exclusivamente à URL externa, sem qualquer mudança de comportamento —
abrir "Editar" num RPG com capa por upload mostra o campo "URL da capa"
vazio (ou com a URL externa antiga, se houver) exatamente como antes; a
capa por upload é gerenciada só pelos botões dedicados na página de
detalhe.

### Fluxos de capa (visão do usuário) — estado atual

A) Upload de imagem do computador — **implementado** (botão "Enviar
   capa"/"Trocar capa" na página de detalhe).
B) URL externa — implementado (LIB-001, formulário de edição).
C) Buscar via metadata provider (`METADATA_PROVIDERS.md`) e usar a URL
   encontrada como `coverUrl` — implementado (LIB-004); salvar cópia
   local (upload automático) da capa encontrada **não** foi
   implementado nesta vertical — fora de escopo do LIB-005.
D) Remover capa enviada — implementado (botão "Remover capa").
E) Trocar capa enviada — implementado (novo upload substitui e remove
   o asset anterior do KV).

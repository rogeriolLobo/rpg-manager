# Capas de RPG — Arquitetura Atual e Futura (LIB-001)

## Estado atual (em produção)

`coverUrl` é uma URL HTTPS pública, validada só sintaticamente
(`isPublicHttpsUrl`, `src/shared/security/cover-url.ts`):

- protocolo `https:` obrigatório;
- sem `username`/`password`/porta na URL;
- hostname não pode ser `localhost`/`.local`/`.internal`, nem um IP
  literal privado/loopback/link-local (`10.x`, `127.x`, `169.254.x`,
  `172.16-31.x`, `192.168.x`, `100.64-127.x`, `198.18-19.x`);
- **sem allowlist de hosts** — qualquer editora/loja do mundo funciona.

O **servidor nunca busca essa URL** — só o navegador, via `<img
src={coverUrl}>` (`CoverImage`, `src/client/pages/library-pages.tsx`),
com `loading="lazy"`/`"eager"`, `referrerPolicy="no-referrer"` e
fallback (`onError`) para um placeholder com as iniciais do título,
sem loop de requisição. Por isso a proteção contra SSRF de fetch
remoto (que faria sentido se o servidor buscasse a URL) não se aplica
a este fluxo — ela continua obrigatória em qualquer endpoint futuro que
realmente faça fetch server-side (nenhum existe hoje para capas).

A CSP (`img-src`, `src/server/security/headers.ts` e `public/_headers`)
permite `'self' data: https:` — qualquer host HTTPS, mantendo
`script-src`/`style-src` restritos como antes.

## Por que não uma allowlist "melhor" em vez de removê-la

Uma allowlist de hosts para capas de RPG não escala: o catálogo mundial
de editoras, lojas e sites de referência (DriveThruRPG, lojas
regionais, sites de editoras pequenas, Wikipédia, etc.) é
essencialmente ilimitado. Manter uma lista fixa sempre vai deixar de
fora um editor legítimo (como aconteceu com `devir.com.br`) e exige
manutenção manual crescente. A validação correta para "URL só usada
pelo navegador" é sobre a **forma** da URL (protocolo seguro, sem
IP/host privado, sem credenciais embutidas) — não sobre uma lista
fechada de quem pode publicar imagens na internet.

## Upload real de capa (zero-cost) — DESENHADO, NÃO IMPLEMENTADO

Não implementado nesta sessão — ver `docs/product/MASTER_BACKLOG.md`
(F-00X). Desenho:

### D1 (aditivo)

```sql
ALTER TABLE rpgs ADD COLUMN cover_type TEXT NOT NULL DEFAULT 'NONE'
  CHECK(cover_type IN ('NONE','EXTERNAL_URL','UPLOAD'));
ALTER TABLE rpgs ADD COLUMN cover_asset_id TEXT; -- chave no KV, quando UPLOAD
-- cover_url existente passa a ser usado só quando cover_type='EXTERNAL_URL'
```

### KV (Workers KV Free — 1 GB, 100k reads/dia, 1k writes/dia)

- Chave: `cover/{uuid}`.
- Valor: bytes da imagem já processada (ver processamento abaixo).
- Metadata do KV (não o D1): `contentType`, `width`, `height`,
  `uploadedAt`, `ownerUserId` — usados pelo endpoint de leitura para
  cabeçalhos e checagem de posse.
- **Nunca** salvar base64 em coluna D1 — D1 é relacional, não storage
  de binário; KV é o lugar certo e já é zero-cost dentro do Free tier.
- Se a quota gratuita de KV se esgotar: a escrita deve falhar
  controladamente (`507` ou equivalente, mensagem clara "limite de
  armazenamento de capas atingido"), nunca cair para R2/pago
  automaticamente.

### Processamento (browser-first, antes do upload)

- Decodificar a imagem de verdade no navegador (`createImageBitmap`ou
  `<canvas>`), nunca confiar só em `filename`/MIME declarado.
- Aceitar apenas JPEG/PNG/WebP decodificáveis.
- Redimensionar mantendo aspect ratio para uma resolução máxima
  suficiente para card + detail (ex.: maior lado ≤ 1000px) — evita
  guardar originais gigantes.
- Reexportar como WebP (fallback JPEG) com qualidade otimizada antes de
  enviar ao servidor.
- Limite de tamanho pós-processamento (ex.: 500 KB) e de dimensão
  aplicados no cliente **e** revalidados no servidor (nunca confiar só
  no cliente).

### Endpoint de mídia

```
GET /api/v1/media/covers/:id
```

- Busca no KV por `cover/{id}`.
- Valida posse/visibilidade quando aplicável (mesma regra de
  autorização do RPG dono da capa).
- Cabeçalhos: `Content-Type` real (do KV metadata), `Cache-Control:
  public, max-age=...` (capas não mudam de conteúdo no mesmo ID — pode
  cachear agressivamente), `X-Content-Type-Options: nosniff`.
- `:id` validado como UUID antes de qualquer lookup — sem path
  traversal possível (KV não tem filesystem, mas a validação de forma
  do parâmetro continua sendo boa prática defensiva).

### Fluxos de capa (visão do usuário)

A) Upload de imagem do computador.
B) URL externa (já implementado).
C) Buscar via metadata provider (ver `METADATA_PROVIDERS.md`) e, se
   viável tecnicamente, salvar cópia local (upload) da capa encontrada.
D) Remover capa (já implementado — `cover_type` volta a `NONE`).
E) Trocar capa (já implementado para URL externa; upload seguiria o
   mesmo PATCH, trocando `cover_type`/`cover_asset_id`).

Nenhum desses exige URL manual obrigatória — o usuário pode ficar sem
capa (placeholder) indefinidamente.

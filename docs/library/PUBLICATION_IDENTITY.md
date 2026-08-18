# Identidade de Publication, ISBN, Provenance e Deduplicação (LIB-003)

LIB-002 criou a separação física (Game System / Publication / User Library
Entry) mas deliberadamente manteve cada Publication 1:1 com o RPG que a
criou — nenhuma identidade real, nenhum reuso entre contas. LIB-003 resolve
identidade: a partir desta migration, **duas bibliotecas que cadastram o
mesmo livro (mesmo ISBN) passam a compartilhar a mesma linha em
`publications`**, cada uma com sua própria `User Library Entry` (`rpgs`)
isolada.

## Auditoria antes de mexer (seção 13 do pedido)

Antes de qualquer alteração, os 30 registros reais de produção foram
inventariados (leitura, sem escrita):

- 20 publications com ISBN não vazio, **todas EAN-13 de 13 dígitos, todas
  com checksum válido, todas distintas** (0 duplicatas).
- 0 colisões de `normalized_name` entre `game_systems`.

Conclusão: **nenhum merge automático de dados históricos foi necessário** —
o backfill desta migration só popula colunas até então vazias
(`isbn13`/`isbn10`), nunca funde duas linhas existentes.

## Identidade canônica de Publication

Prioridade (seção 4 do pedido):

1. ISBN-13 normalizado (`publications.isbn13`).
2. ISBN-10 normalizado, convertido para ISBN-13 equivalente para fins de
   busca de identidade (`publications.isbn10` guarda o valor original
   fornecido; `isbn13` guarda sempre a forma canônica, direta ou derivada).
3. Provider + external ID (`publication_external_ids` — schema pronto,
   não populado nesta tarefa; nenhum provider é chamado aqui).
4. Sem identificador confiável → Publication distinta, sempre (nunca por
   título sozinho — título não é identificador, seção 4).

**Sem fuzzy match.** Identidade é só por igualdade exata do ISBN-13
canônico (ou, no futuro, do par `(provider, external_id)`). Duas grafias
diferentes do mesmo título sem ISBN em comum permanecem duas Publications
distintas — correto e seguro, não uma falha.

## ISBN — normalização e validação (`src/domain/rpg/isbn.ts`)

- Aceita hífens/espaços na entrada; persiste forma normalizada (só
  dígitos, `X` maiúsculo quando aplicável).
- Valida checksum real (ISO 2108 para ISBN-10, EAN-13 para ISBN-13) — não
  aceita qualquer sequência de 10/13 dígitos, só as matematicamente
  corretas.
- Campo vazio continua permitido (RPG sem ISBN é válido).
- ISBN preenchido e inválido → `422 VALIDATION_ERROR` com `fields.isbn`
  (erro junto ao campo, igual ao padrão já usado para `coverUrl`).
- **Não inventa nem corrige** ISBN — um valor que não bate no checksum é
  rejeitado, nunca "arredondado" para o mais próximo válido.

### Compatibilidade com edição sem alteração (regra crítica)

Mesmo princípio do incidente de `coverUrl` (LIB-001, seção 18 do
`CLAUDE.md`): **se o ISBN enviado no PATCH é idêntico ao já persistido, a
validação de checksum é pulada** — um RPG legado com ISBN historicamente
inválido (hipoteticamente; nenhum existe hoje, mas a proteção é
permanente) continua editável sem forçar o usuário a corrigir ou apagar o
campo só para salvar outra alteração. Só ISBN **novo/alterado** passa pela
validação de checksum.

### Conversão ISBN-10 → ISBN-13

Implementada (`isbn10ToIsbn13`) e usada **só internamente**, para calcular
a chave de identidade (`isbn13`) quando o usuário fornece ISBN-10. O valor
exibido/retornado pela API (`isbn`) continua sendo exatamente a forma que
o usuário digitou (normalizada, sem hífens) — a conversão nunca substitui
silenciosamente o que a pessoa digitou (seção 6 do pedido).

## Provenance

`publications.metadata_source` já existia desde LIB-002
(`MANUAL | OPEN_LIBRARY | GOOGLE_BOOKS`, `CHECK` constraint). Decisão desta
sessão: **não adicionar `IMPORT` como valor distinto no `CHECK`.**

SQLite/D1 não suporta alterar uma `CHECK` constraint existente sem
reconstruir a tabela (`CREATE` nova + copiar dados + `DROP` da antiga) — e
o pedido desta tarefa proíbe explicitamente `DROP` (seção 25). Import CSV é,
na prática, a mesma categoria de proveniência que cadastro manual (dado
fornecido pelo usuário, não por um provider externo) — `MANUAL` já
descreve isso com precisão, não é uma lacuna. Se um dia for necessário
distinguir `IMPORT` fisicamente, isso justifica uma migration dedicada de
reconstrução da tabela `publications` (hoje ~30 linhas, baixo risco) — não
está bloqueado, só fora do escopo aditivo desta tarefa.

`metadata_source_id`/`metadata_source_url`/`metadata_fetched_at` também já
existiam (LIB-002) e continuam prontos, não populados (sem provider ativo).

## Provider External IDs (`publication_external_ids`)

```sql
CREATE TABLE publication_external_ids (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('OPEN_LIBRARY','GOOGLE_BOOKS','PUBLISHER','OTHER')),
  external_id TEXT NOT NULL,
  external_type TEXT NOT NULL DEFAULT 'EDITION' CHECK(external_type IN ('EDITION','WORK')),
  created_at TEXT NOT NULL,
  UNIQUE(provider, external_id)
);
```

Schema pronto, tabela vazia — nenhuma chamada externa nesta tarefa (LIB-003
é fundação de identidade, não integração de provider; isso é LIB-004+).

## Deduplicação segura (CREATE e import)

Ao cadastrar (manual ou CSV) com ISBN válido:

1. Resolve `isbn13` (direto ou derivado de ISBN-10).
2. Busca Publication existente com esse `isbn13` (índice único —
   `idx_publications_isbn13_unique`, criado nesta migration).
3. **Encontrada** → reutiliza (não cria Game System/Publication novos);
   cria só a nova User Library Entry, com o próprio estado pessoal do
   usuário. Se esse usuário **já** tem uma entry para essa Publication →
   `409 ALREADY_IN_LIBRARY` (não duplica; índice único
   `idx_rpgs_user_publication_unique` garante isso também no nível do
   banco, não só na aplicação).
4. **Não encontrada** → cria Game System + Publication novos (mesmo
   caminho de sempre), com `isbn13`/`isbn10` já populados pela
   classificação.
5. **Sem ISBN** → sempre cria Publication distinta (sem identidade para
   deduplicar) — comportamento inalterado desde LIB-002.

**Sem merge fuzzy.** Título nunca é usado para decidir reuso de
Publication — só igualdade exata de `isbn13`.

## Política de segurança para metadata compartilhada (seção 10 do pedido — CRÍTICA)

Avaliadas as opções A–D do pedido. **Decisão: variante de (C) — edição de
metadata editorial permitida só enquanto a Publication tiver exatamente
UMA User Library Entry referenciando-a.**

Por quê esta e não (B) "user overrides": (B) exigiria uma tabela nova de
overrides por usuário (título/capa/notas exibidos) — mais complexidade e
superfície nova de dados sem necessidade comprovada agora (viola a
instrução explícita da seção 11: "Não crie EAV genérico. Não complique
sem necessidade."). (A) "imutável após compartilhado" e (C)
"editável só com referência única" são a mesma regra vista de dois
ângulos — optei pela redação de (C) porque é a mais simples de implementar
e auditar: uma contagem (`COUNT(*) FROM rpgs WHERE publication_id=?`) antes
de aceitar qualquer alteração nos campos editoriais.

**Como funciona:**

- Estado pessoal (`readingStatus`, `priority`, `notes`, `plannedPlayDate`,
  etc.) — sempre editável, independente de compartilhamento. Nunca
  bloqueado.
- Metadata editorial (`title`, `isbn`, `coverUrl`, `coverSourceUrl`,
  `coverSourceNote`) — editável livremente **enquanto a Publication tiver
  1 única referência** (o caso comum: RPG cadastrado só por você).
- No momento em que uma segunda biblioteca também referencia essa
  Publication (reuso por ISBN), a edição desses campos por **qualquer**
  uma das duas contas passa a ser bloqueada com erro claro
  (`422 SHARED_PUBLICATION_METADATA_LOCKED`, com `fields` apontando os
  campos que a pessoa tentou mudar) — só é bloqueado se o valor **enviado
  for diferente do já persistido**; reenviar o formulário sem alterar
  metadata (o caso comum de "editar só o estado pessoal e salvar")
  continua funcionando normalmente, porque não há diferença a aplicar.
- PATCH nunca reatribui `publication_id` para uma Publication diferente
  (sem "merge por edição" — só o CREATE resolve/reusa Publication
  existente). Isso mantém o escopo do PATCH idêntico ao de LIB-002,
  simplesmente protegido pela trava acima.
- Nenhum endpoint novo expõe `publications`/`game_systems` diretamente —
  a única superfície continua sendo `/rpgs` (seção 19 do pedido).
- LIB-005: a mesma checagem foi extraída para uma função reutilizável
  (`assertSharedPublicationEditable`, `library-writes.ts`) e passou a ser
  usada também pelos endpoints de capa por upload (`POST`/`DELETE
  /api/v1/rpgs/:id/cover`) — capa por upload é metadata editorial da
  Publication tanto quanto `coverUrl`, mesma trava, mesmo critério
  (`COUNT(*) > 1`). Ver `docs/library/COVER_STORAGE.md`.
- LIB-006: uma Library Entry **arquivada** continua contando para esse
  `COUNT(*)` — archive nunca "libera" a trava. Se User A arquiva sua
  entry e User B continua ativo na mesma Publication, B permanece
  bloqueado: se pudesse editar livremente, A veria os dados trocados ao
  restaurar, sem nunca ter concordado. Testado explicitamente em
  `tests/integration/library-archive.test.ts`. Ver
  `docs/library/LIBRARY_ARCHIVE.md`.

**Por que isso é seguro contra IDOR/escalada:** o bloqueio não depende de
quem é "dono" da Publication (não existe dono — é catálogo compartilhado,
mesmo modelo de `categories`/`subgenres`); depende só de quantas contas a
referenciam. Ninguém pode alterar dados de uma Publication que outra conta
também usa, mesmo que tecnicamente "chegue perto" via um PATCH no próprio
RPG. Estado pessoal de outra conta nunca é lido nem escrito por esta
funcionalidade — inalterado desde sempre (`user_id` scoping em `rpgs`).

## Game System — sem merge automático (seção 12 do pedido)

`game_systems.normalized_name` (já existente desde LIB-002) auditado:
zero colisões exatas nos dados reais. Mesmo que houvesse ("Alien" vs
"ALIEN" vs "Alien RPG"), a instrução é explícita: **revisão humana deve
prevalecer em ambiguidades** — esta tarefa não implementa merge de Game
System, automático ou assistido. Fica registrado como candidato a
ferramenta futura (com preview e confirmação humana, nunca automática).

## Import CSV — mesma regra canônica (seção 17 do pedido)

Preview (`/import/preview`) ganha duas classificações novas, além das já
existentes (`NOVO`/`ATUALIZACAO`/`IGNORADO`/`ERRO`):

- `EXISTING_PUBLICATION`: a linha tem ISBN válido que já existe no
  catálogo (em qualquer conta) e o usuário atual ainda não tem entry para
  essa Publication → ao confirmar, cria só a User Library Entry,
  reaproveitando a Publication (título/capa da Publication existente
  prevalecem — a linha do CSV não sobrescreve metadata compartilhada,
  mesma trava da seção anterior).
- `ALREADY_IN_LIBRARY`: a linha tem ISBN válido que já existe no catálogo
  **e** o usuário atual já tem uma entry para essa Publication →
  informativa, não aparece como selecionável para confirmar (mesmo
  tratamento de `ERRO` nesse aspecto — nada a aplicar).

Sem ISBN na linha → comportamento de LIB-001/LIB-002 inalterado (dedup só
por título normalizado, path `NOVO`/`ATUALIZACAO`/`IGNORADO`).

Não foi adotado literalmente o vocabulário sugerido no pedido
(`NEW`/`EXISTING_PUBLICATION`/`ALREADY_IN_LIBRARY`/`CONFLICT`/`ERROR`)
porque isso exigiria descartar o fluxo de backfill de capa
(`ATUALIZACAO`/`IGNORADO`) já testado e em produção desde LIB-001/LIB-002
— o pedido permite arquitetura equivalente ("ou arquitetura equivalente
melhor" já é o padrão adotado em outras seções). `CONFLICT` não foi
implementado como estado distinto: quando uma linha do CSV tem ISBN que
resolve para uma Publication com título diferente do informado no CSV, a
mensagem da linha (`EXISTING_PUBLICATION`/`ALREADY_IN_LIBRARY`) já deixa
isso visível ao usuário — sem tentar julgamento automático de "quão
diferente" os títulos são (isso seria fuzzy match, proibido pela seção 9).

## Export/Backup

`/export` (JSON completo) passa a incluir `publicationExternalIds` (vazio
hoje, pronto para o futuro) — versão do formato sobe de 6 para 7. O
formato é só leitura/diagnóstico (não existe endpoint que reimporte um
backup completo); a mudança é aditiva (chave nova no JSON), sem quebra de
compatibilidade para quem já tem backups da versão 6.

## O que NÃO foi feito nesta tarefa (fora de escopo, por instrução explícita)

- Nenhuma chamada a Open Library/Google Books/qualquer provider externo.
- Nenhum upload de capa/Workers KV.
- Nenhum archive de RPG.
- Nenhum merge automático de dados históricos (não havia nenhum caso
  ambíguo nos 30 registros reais — auditado, documentado acima).
- Nenhuma reatribuição automática de `publication_id` no PATCH (só o
  CREATE resolve/reusa identidade).

## Atualização — LIB-004A: `reusePublicationId` e aliases

Duas adições à identidade/dedup, ambas ainda sem merge fuzzy por título:

- **`reusePublicationId`** — quarta e mais alta prioridade de resolução em
  `buildCreateLibraryEntryStatements`, acima de Edition/Work ID externo e de
  ISBN. Usado quando o usuário seleciona explicitamente um resultado do
  catálogo interno (`origin: INTERNAL`) na busca — o ID é sempre revalidado
  contra `publications` no servidor (nunca confiado cegamente); se
  inexistente/inválido, o pipeline simplesmente ignora e segue para a
  próxima prioridade (Edition/Work/ISBN), nunca quebra o create.
- **`publication_aliases`** (migration `0019`, aditiva) — títulos
  alternativos/localizados de uma Publication, usados só para a BUSCA
  encontrar (nunca para decidir dedup de identidade no CREATE — isso
  continua sendo só ISBN/external ID/`reusePublicationId`). Só aliases
  `confirmed=1` entram na busca. Ver `docs/library/METADATA_PROVIDERS.md`.

Ver também `docs/library/METADATA_PROVIDERS.md` para o pipeline completo de
busca (catálogo interno + Open Library + import por URL) introduzido no
LIB-004A.

# Worlds V2.1

World representa cenário/ambientação e não um RPG. O RPG padrão é opcional. Entidades podem ser criadas diretamente no World ou permanecer globais no Vault.

## Acesso

World `PRIVATE` é visível apenas ao owner. World `GROUP` exige vínculo explícito em `world_members`; participar de campanha ou grupo de jogo não concede acesso automático ao World inteiro. Viewers apenas leem. O owner gerencia membros, edita, arquiva, restaura e exclui quando não existem entidades.

## Dashboard

O detalhe apresenta contagens reais por tipo e entidades ativas atualizadas recentemente, sempre depois da autorização. Arquivar o World não arquiva nem apaga entidades. O owner continua acessando o World arquivado e pode restaurá-lo.

## Contexto ativo

Cada conta pode escolher um World ativo. A preferência só é aceita quando o usuário pode visualizar o World e é descartada na leitura se o acesso for removido ou o World estiver arquivado. Sidebar, Vault, Wiki, Diário, campanhas e Portal usam esse contexto sem mover ou copiar conteúdo.

## Wiki e Portal

A Wiki organiza `vault_entities` existentes em pastas e tags e acrescenta aliases. Esses metadados nunca alteram a visibilidade. O Portal é a mesma leitura autorizada apresentada em modo somente leitura; não existe tabela paralela de conteúdo público.

Backlinks são derivados de menções `[[nome ou alias]]` nas descrições. Não representam `entity_relations` e não alimentam grafo.

## Diário e convites

O Diário pertence ao owner do World e contém páginas/pastas privadas. Não há opção implícita de publicação na V2.1.

Convites só podem ser criados para Worlds com visibilidade `GROUP`. O código aleatório é mostrado uma vez, o D1 guarda apenas seu hash e o aceite cria membership `VIEWER`. Expiração, limite de usos e revogação são validados no servidor.

## Relações, Graph e Genealogia V2.2

Relações conectam entidades do mesmo World sem copiá-las. A lista, o grafo e a genealogia leem `entity_relations`; backlinks editoriais continuam independentes. O grafo oferece pan, zoom, fit view, minimapa, busca, filtros, entidades desconectadas e destaque de vizinhança. A genealogia projeta relações familiares da mesma tabela.

O narrador enxerga a verdade autorizada; jogadores recebem apenas nós e arestas permitidos pelo backend. A diferença não cria um segundo grafo físico.

## Timeline e Calendar

Timeline ordena entidades EVENT por uma chave histórica independente do relógio real. Eras, data textual e precisão permitem representar cronologias incompletas ou aproximadas. Um World pode definir meses, dias da semana, ciclos e feriados próprios; nenhum calendário terrestre é presumido. Datas reais das sessões continuam em `campaign_sessions` e não são convertidas.

Entidades relacionadas aparecem somente quando existe `entity_relations` explícita e autorizada. O sistema não infere relações por NLP ou IA.

Maps, uploads, fichas, VTT, realtime e IA continuam reservados para versões futuras.

# Worlds V2.0

World representa cenário/ambientação e não um RPG. O RPG padrão é opcional. Entidades podem ser criadas diretamente no World ou permanecer globais no Vault.

## Acesso

World `PRIVATE` é visível apenas ao owner. World `GROUP` exige vínculo explícito em `world_members`; participar de campanha ou grupo de jogo não concede acesso automático ao World inteiro. Viewers apenas leem. O owner gerencia membros, edita, arquiva, restaura e exclui quando não existem entidades.

## Dashboard

O detalhe apresenta contagens reais por tipo e entidades ativas atualizadas recentemente, sempre depois da autorização. Arquivar o World não arquiva nem apaga entidades. O owner continua acessando o World arquivado e pode restaurá-lo.

Maps, Relationship Graph e Timeline não aparecem na interface V2.0 e continuam reservados para versões futuras.

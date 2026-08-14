# RPG MANAGER — UX INVARIANTS

Invariantes de produto que devem ser preservadas em todas as versões.
Testes automatizados devem validar essas decisões.

## Navegação global

1. **Biblioteca** possui entrada global na sidebar.
2. **Vault** possui entrada global na sidebar.
3. **Grupos** possui entrada global na sidebar.
4. **Campanhas** possui entrada global na sidebar.
5. **Mundos** possui entrada global na sidebar.

## Independência de World

6. **Vault** funciona sem World ativo.
7. **Campanhas** funciona sem World ativo.
8. **World é opcional** — o usuário pode trabalhar normalmente sem selecionar um World.
9. **Active World é contexto, não autorização** — o backend permanece responsável pelas permissões.

## Modelo de domínio

10. **Adventure não é Campaign** — são entidades distintas no Vault e no domínio.
11. **Campaign não é World** — campanhas são globais, não contextuais a um World.

## Permissões e visibilidade

12. **GM_ONLY nunca aparece ao Player** — links e conteúdo marcados como GM_ONLY devem ser ocultados para jogadores.
13. **A ausência de um link no frontend não substitui autorização backend** — o servidor sempre valida permissões.

## Plataformas

14. **Mobile oferece acesso às mesmas áreas principais do desktop** — Campanhas, Vault, Biblioteca, Grupos e Mundos devem estar acessíveis no drawer/menu mobile.
15. **Light/Dark não alteram disponibilidade funcional** — a troca de tema não deve esconder ou revelar funcionalidades.

## Arquitetura

16. O sistema é **VAULT-FIRST + WORLD-AWARE**, não WORLD-FIRST.
17. Links globais na sidebar permanecem visíveis independente do World ativo.
18. Módulos contextuais do World (Wiki, Diário, Relações, etc.) só aparecem quando um World está ativo.

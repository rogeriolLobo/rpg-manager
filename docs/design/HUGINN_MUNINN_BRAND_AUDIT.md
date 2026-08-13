# Auditoria visual — Huginn & Muninn

Data da auditoria: 13 de agosto de 2026

Fonte principal: [site oficial da Huginn & Muninn](https://www.huginnemuninn.com.br/)

## Evidências observadas

A página oficial foi inspecionada visualmente e por estilos computados no navegador. A identidade atual usa uma atmosfera escura, contraste alto, vermelho como acento e imagens editoriais de RPG como protagonistas.

| Evidência | Valor observado | Uso no site oficial |
|---|---:|---|
| Vermelho da marca | `#cc3333` | acentos, bordas de navegação, estados de interação e sombras coloridas |
| Vinho escuro | `#330000` | fundo principal |
| Vinho profundo | `#160000` | gradações e profundidade |
| Preto | `#000000` | superfícies e cabeçalho translúcido |
| Cinza | `#919fa4` | texto secundário |
| Branco | `#ffffff` | texto principal sobre fundos escuros |

O ativo visual oficial encontrado no próprio site contém dois corvos, uma árvore circular e o nome “Huginn & Muninn”. Ele foi auditado, mas não será redesenhado, recortado nem recolorido. Como não existe uma variante local versionada e licenciada no repositório, esta entrega usa o nome da editora em texto e os elementos cromáticos comprovados. Um ativo oficial aprovado pode ser incorporado posteriormente sem mudar os tokens.

## Tipografia observada

O site oficial usa `Segoe UI`, `system-ui` e fallbacks de sistema, com títulos pesados. O RPG Manager já possui uma voz editorial serifada nos títulos. A decisão é:

- interface e textos longos: `system-ui`, com Segoe UI quando disponível;
- títulos: Georgia e serifas de sistema;
- nenhuma fonte remota, paga ou sem licença será adicionada.

## Cores selecionadas

### Cores de marca

- `#cc3333`: vermelho oficial, preservado como acento e como primário no tema escuro;
- `#330000` e `#160000`: evidência da profundidade vinho da marca; servem de origem para os fundos escuros, não como cópia literal em todas as superfícies;
- `#919fa4`: evidência de texto secundário no material oficial, mantida apenas como referência de neutralidade.

### Adaptações de interface

- `#7d2029`: primário do tema claro. É uma adaptação mais escura do vermelho para alcançar contraste AA com texto creme;
- cremes e marrons quentes: preservam a biblioteca editorial já reconhecível no RPG Manager;
- fundos escuros `#160d0f`, `#241719` e `#2d1d20`: derivam do vinho profundo sem usar preto puro.

Essas adaptações não são declaradas como cores oficiais da marca.

## Cores descartadas

- presets genéricos do WordPress e WooCommerce, como roxo `#720eec`, azul `#2ea2cc` e verde `#007518`: pertencem à plataforma, não à identidade editorial;
- preto e branco puros como base universal: contraste excessivamente duro e aparência de painel administrativo;
- verde neon, azul-marinho e estética cyberpunk do WorldCraft: referência funcional, não visual;
- dourado antigo do RPG Manager como primário: não há evidência suficiente para chamá-lo de cor oficial. Permanece apenas como suporte editorial discreto.

## Tradução para o RPG Manager

O tema claro mantém papel, creme, vinho e tipografia editorial. O tema escuro representa uma “biblioteca da Huginn & Muninn à noite”: fundos vinho quase pretos, papel envelhecido no texto, superfícies graduais e vermelho oficial como acento. Estados de sucesso, alerta, erro e informação são cores semânticas de UI e não cores de marca.

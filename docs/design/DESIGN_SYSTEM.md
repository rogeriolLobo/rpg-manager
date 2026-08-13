# Design system do RPG Manager

## Marca e direção

O RPG Manager combina a identidade sombria da Huginn & Muninn com a metáfora de biblioteca, arquivo do narrador e caderno de campanha. WorldCraft não é referência estética.

## Arquitetura de tema

- `tokens.css`: tokens semânticos para temas claro e escuro;
- `theme.ts`: validação, resolução, leitura e gravação da preferência;
- `ThemeProvider.tsx`: reconciliação com a conta e reação ao sistema operacional;
- `/theme-bootstrap.js`: aplica o tema antes do React, sem script inline e sem relaxar a CSP;
- `user_preferences.theme`: preferência autenticada `LIGHT`, `DARK` ou `SYSTEM`;
- `localStorage['rpg-manager-theme']`: cache visual não sensível e preferência antes do login.

### Precedência

1. Antes da autenticação, usa-se o valor local válido; ausência ou valor inválido significa `SYSTEM`.
2. Depois da autenticação, a preferência da conta prevalece e atualiza o cache local.
3. Alterações feitas em Configurações são aplicadas imediatamente, gravadas localmente e persistidas na conta.
4. Em `SYSTEM`, mudanças de `prefers-color-scheme` são aplicadas em tempo real.

## Tokens

Os componentes consomem nomes semânticos: `--background`, `--surface`, `--text-primary`, `--border`, `--brand-primary`, `--focus-ring`, `--success`, `--danger` e equivalentes. `--brand-red` identifica uma cor comprovada da marca; cores de status são suporte de interface.

## Temas

### Claro

- fundo creme `#f6efe3`;
- superfície papel `#fffaf0`;
- texto `#2b2020`;
- primário adaptado `#7d2029`;
- acento oficial `#cc3333`.

### Escuro

- fundo vinho quase preto `#160d0f`;
- superfície `#241719`;
- superfície elevada `#2d1d20`;
- texto creme `#f5eadb`;
- primário oficial `#cc3333`.

## Tipografia

- display: Georgia e serifas de sistema;
- interface: Segoe UI e `system-ui`;
- máximo de duas famílias e nenhuma dependência externa.

## Componentes

- botões primários usam `brand-primary` e `text-on-brand`;
- inputs usam superfície própria, borda e foco sem depender do tema nativo;
- cards usam `surface`, `border` e sombra baixa;
- sidebar usa tokens próprios, com estado ativo marcado por fundo, barra lateral e peso;
- placeholders de capa usam gradação editorial, ícone, categoria e iniciais do título;
- badges e mensagens usam tokens semânticos, não apenas a cor da marca.

## Espaçamento, bordas e sombras

O sistema preserva a escala existente em `rem`, raios entre `0.5rem` e `1rem` e sombras suaves. A profundidade deve vir primeiro da diferença entre fundo, superfície e borda.

## Foco e movimento

O foco usa outline de 3 px com offset de 2 px em ambos os temas. Transições de cor e borda duram 180 ms; `prefers-reduced-motion: reduce` remove animações e transições relevantes.

## Controles nativos

`color-scheme` acompanha `data-theme`, cobrindo inputs, selects, checkboxes, barras de rolagem e seletores de data.

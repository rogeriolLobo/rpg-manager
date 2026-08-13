# Acessibilidade das cores

Objetivo: WCAG 2.2 AA. Os valores abaixo usam contraste relativo sRGB. Texto normal precisa de pelo menos 4,5:1; componentes e foco precisam de pelo menos 3:1.

## Tema claro

| Combinação | Contraste |
|---|---:|
| `background #f6efe3` / `text-primary #2b2020` | 13,81:1 |
| `surface #fffaf0` / `text-primary #2b2020` | 15,17:1 |
| `surface #fffaf0` / `text-secondary #544743` | 8,56:1 |
| `background #f6efe3` / `text-muted #6b5b55` | 5,65:1 |
| `brand-primary #7d2029` / `text-on-brand #fff8ed` | 9,43:1 |
| `background #f6efe3` / `link #7d2029` | 8,71:1 |
| `input-background #fffdf8` / `text-primary #2b2020` | 15,53:1 |
| `danger-background #f8e0dc` / `danger #922f32` | 6,24:1 |

## Tema escuro

| Combinação | Contraste |
|---|---:|
| `background #160d0f` / `text-primary #f5eadb` | 16,09:1 |
| `surface #241719` / `text-primary #f5eadb` | 14,59:1 |
| `surface #241719` / `text-secondary #d4c2b3` | 10,04:1 |
| `surface #241719` / `text-muted #b6a399` | 7,17:1 |
| `brand-primary #cc3333` / `text-on-brand #fff8ed` | 4,87:1 |
| `background #160d0f` / `link #f28b8b` | 8,05:1 |
| `input-background #1d1214` / `text-primary #f5eadb` | 15,38:1 |
| `danger-background #3e1b1d` / `danger #ffaaa4` | 8,36:1 |

## Regras de uso

- o vermelho oficial `#cc3333` com branco alcança 5,14:1, mas não deve substituir as cores semânticas;
- texto muted não deve ser reduzido por opacidade adicional;
- seleção, erro e sucesso devem combinar cor com texto, ícone, borda ou rótulo;
- estados disabled preservam legibilidade e também usam cursor/atributo nativo;
- screenshots desktop e mobile devem verificar foco, controles nativos e imagens nos dois temas.

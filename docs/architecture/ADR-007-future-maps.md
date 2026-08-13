# ADR-007 — Maps futuros

Status: proposto; sem upload ou UI de mapa.

## Modelo

- `WorldMap`: World, nome, viewport lógico, objeto de imagem opcional e mapa pai opcional;
- `MapPin`: coordenadas no viewport, rótulo e vínculo opcional com Entity ou mapa filho;
- mapa filho permite navegação continente → região → local sem inferir hierarquia de Location;
- coordenadas são relativas ao viewport original e independem do tamanho renderizado.

## Segurança e integridade

Leitura herda autorização do World e, quando o pin aponta para Entity, exige autorização dessa Entity antes de serializar o vínculo. Owner é o único editor inicial. Cross-world, ciclos de mapas e coordenadas fora do viewport devem ser rejeitados.

## Dependências

Metadata relacional pode existir em D1, mas a experiência útil depende de imagem em armazenamento binário. Nenhuma migration ou upload será criado antes da decisão do ADR-006.

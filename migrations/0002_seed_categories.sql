INSERT INTO categories (id, name, sort_order) VALUES
  ('fantasia', 'Fantasia', 10),
  ('ficcao-cientifica', 'Ficção Científica', 20),
  ('horror', 'Horror', 30),
  ('pos-apocaliptico', 'Pós-Apocalíptico', 40),
  ('moderno', 'Moderno', 50),
  ('alternativo', 'Alternativo', 60),
  ('universal', 'Universal', 70);

INSERT INTO subgenres (id, category_id, name) VALUES
  ('alta-fantasia','fantasia','Alta Fantasia'),
  ('espada-feiticaria','fantasia','Espada e Feitiçaria'),
  ('fantasia-sombria','fantasia','Fantasia Sombria (Grimdark)'),
  ('fantasia-epica','fantasia','Fantasia Épica'),
  ('fantasia-urbana','fantasia','Fantasia Urbana'),
  ('fantasia-historica','fantasia','Fantasia Histórica'),
  ('hard-sci-fi','ficcao-cientifica','Ficção Científica (Hard Sci-Fi)'),
  ('space-opera','ficcao-cientifica','Space Opera'),
  ('cyberpunk','ficcao-cientifica','Cyberpunk'),
  ('mecha','ficcao-cientifica','Mecha'),
  ('horror-cosmico','horror','Horror Cósmico'),
  ('horror-pessoal','horror','Horror Pessoal'),
  ('survival-horror','horror','Survival Horror'),
  ('pos-apocaliptico-geral','pos-apocaliptico','Pós-Apocalíptico Geral'),
  ('retro-futurista','pos-apocaliptico','Retrô-Futurista'),
  ('acao-espionagem','moderno','Ação e Espionagem'),
  ('investigacao-misterio','moderno','Investigação e Mistério'),
  ('weird-west','alternativo','Faroeste Fantástico (Weird West)'),
  ('cozy','alternativo','Viagem e Aconchego (Cozy / Slice of Life)'),
  ('super-herois','alternativo','Super-Heróis'),
  ('generico-universal','universal','Genérico / Universal');


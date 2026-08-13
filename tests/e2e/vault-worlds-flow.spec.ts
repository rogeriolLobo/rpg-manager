import { expect, test } from '@playwright/test';

test('fluxo V2 de World, Vault, Adventure e campanha', async ({page})=>{
  const openNavigation=async()=>{if((page.viewportSize()?.width??1000)<=850){await page.getByRole('button',{name:'Abrir menu'}).click();await expect(page.locator('.sidebar')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');}};
  const navigateFromMenu=async(name:string)=>{await openNavigation();await page.getByRole('link',{name,exact:true}).click();};
  const email=`vault-e2e-${Date.now()}-${test.info().project.name}@example.com`;
  const password='uma senha longa para vault e2e 2026';

  await page.goto('/register');
  await page.getByLabel('Como quer ser chamado?').fill('Narrador Vault');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha mínimo de 12 caracteres').fill(password);
  await page.getByLabel('Confirmar senha').fill(password);
  await page.getByRole('button',{name:'Criar conta'}).click();
  await page.getByRole('link',{name:'Já guardei, continuar'}).click();

  await navigateFromMenu('Biblioteca');
  await page.getByRole('link',{name:'Novo RPG'}).click();
  await page.getByLabel('Título').fill('Sistema de Aldea');
  await page.getByLabel('Categoria').selectOption('fantasia');
  await page.getByLabel('Subgênero').selectOption('alta-fantasia');
  await page.getByRole('button',{name:'Salvar RPG'}).click();
  await expect(page.getByRole('heading',{name:'Sistema de Aldea'})).toBeVisible();

  await navigateFromMenu('Mundos');
  await page.getByRole('link',{name:'Novo World'}).click();
  await page.getByLabel('Nome').fill('Aldea');
  await page.getByLabel('RPG padrão').selectOption({label:'Sistema de Aldea'});
  await page.getByLabel('Descrição').fill('Um mundo de intrigas e segredos.');
  await page.getByRole('button',{name:'Salvar World'}).click();
  await expect(page.getByRole('heading',{name:'Aldea'})).toBeVisible();

  await page.getByRole('link',{name:'Adicionar entidade'}).click();
  await expect(page.getByLabel('World').locator('option:checked')).toHaveText('Aldea');
  const npcName=page.getByLabel('Nome');
  await npcName.pressSequentially('Lucien');
  await expect(npcName).toHaveValue('Lucien');
  await page.getByLabel('Resumo').fill('Conselheiro misterioso.');
  await expect(npcName).toHaveValue('Lucien');
  await page.getByLabel('Visibilidade').selectOption('GM_ONLY');
  await expect(npcName).toHaveValue('Lucien');
  await page.getByRole('button',{name:'Salvar entidade'}).click();
  await expect(page.getByRole('heading',{name:'Lucien'})).toBeVisible();

  await navigateFromMenu('Vault');
  await page.getByRole('link',{name:'Nova entidade'}).click();
  await page.getByLabel('Tipo').selectOption('LOCATION');
  await page.getByLabel('Nome').fill('Taverna do Corvo');
  await page.getByLabel('World').selectOption({label:'Aldea'});
  await page.getByRole('button',{name:'Salvar entidade'}).click();
  await expect(page.getByRole('heading',{name:'Taverna do Corvo'})).toBeVisible();

  await navigateFromMenu('Vault');
  await page.getByRole('link',{name:'Nova entidade'}).click();
  await page.getByLabel('Tipo').selectOption('ADVENTURE');
  await page.getByLabel('Nome').fill('A Noite do Corvo');
  await page.getByLabel('World').selectOption({label:'Aldea'});
  await page.getByLabel('Formato').selectOption('ONE_SHOT');
  await page.getByLabel('Sessões recomendadas').fill('1');
  await page.getByRole('button',{name:'Salvar entidade'}).click();
  await expect(page.getByRole('heading',{name:'A Noite do Corvo'})).toBeVisible();

  await navigateFromMenu('Mundos');
  await page.getByRole('link',{name:/Aldea/u}).click();
  await page.getByRole('link',{name:/Ver 1 NPC no Vault/u}).click();
  await expect(page).toHaveURL(/worldId=.*type=NPC/u);
  await expect(page.getByRole('link',{name:/Lucien/u})).toBeVisible();

  await navigateFromMenu('Campanhas');
  await page.getByRole('link',{name:'Nova campanha'}).click();
  await page.getByLabel('RPG').selectOption({label:'Sistema de Aldea'});
  await page.getByLabel('Nome da campanha').fill('Crônicas de Aldea');
  await page.getByLabel('Adventure principal').selectOption({label:'A Noite do Corvo'});
  await page.getByRole('button',{name:'Salvar campanha'}).click();
  await expect(page.getByRole('heading',{name:'Crônicas de Aldea'})).toBeVisible();
  await expect(page.getByText('A Noite do Corvo').first()).toBeVisible();

  await navigateFromMenu('Vault');
  await page.getByLabel('Buscar no Vault').fill('Lucien');
  await page.getByRole('link',{name:/Lucien/u}).click();
  await page.getByLabel('Vincular campanha').selectOption({label:'Crônicas de Aldea'});
  await page.getByRole('button',{name:'Vincular',exact:true}).click();
  await page.getByRole('link',{name:'Crônicas de Aldea'}).click();
  await expect(page.getByText('Lucien').first()).toBeVisible();

  await page.getByRole('link',{name:'Lucien'}).click();
  await page.getByRole('button',{name:'Arquivar',exact:true}).click();
  await expect(page.getByText('Esta entidade está arquivada')).toBeVisible();
  await navigateFromMenu('Vault');
  await page.getByLabel('Arquivo').selectOption('archived');
  await expect(page.getByRole('link',{name:/Lucien/u})).toBeVisible();
  await page.getByRole('link',{name:/Lucien/u}).click();
  await page.getByRole('button',{name:'Restaurar',exact:true}).click();
  await expect(page.getByText('Esta entidade está arquivada')).toHaveCount(0);

  const csrfCookie=(await page.context().cookies()).find((cookie)=>cookie.name==='rpg_csrf');
  expect(csrfCookie).toBeDefined();
  for(let index=1;index<=12;index+=1){
    const response=await page.request.post('/api/v1/worlds',{headers:{'X-CSRF-Token':decodeURIComponent(csrfCookie!.value),Origin:'http://127.0.0.1:5173'},data:{name:`World paginado ${String(index).padStart(2,'0')}`,description:'',defaultRpgId:null,visibility:'PRIVATE'}});
    expect(response.ok()).toBeTruthy();
  }
  await navigateFromMenu('Mundos');
  await expect(page.getByRole('navigation',{name:'Paginação de Worlds'})).toBeVisible();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await page.getByRole('button',{name:'Próxima'}).click();
  await expect(page).toHaveURL(/page=2/u);
  await expect(page.getByRole('link',{name:/Aldea/u})).toBeVisible();

  await openNavigation();
  await page.getByRole('button',{name:'Sair'}).click();
  await expect(page).toHaveURL(/\/login$/u);
});

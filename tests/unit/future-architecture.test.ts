import { describe,expect,it } from 'vitest';
import { validateSheet, type SheetTemplate } from '../../src/domain/sheets';
import { isValidMapPoint } from '../../src/domain/future/maps';

describe('future architecture contracts',()=>{
  it('validates map coordinates independently from an image provider',()=>{
    expect(isValidMapPoint({x:320,y:180},{width:640,height:360})).toBe(true);
    expect(isValidMapPoint({x:-1,y:180},{width:640,height:360})).toBe(false);
  });

  it('validates a fictional and system-neutral sheet template',()=>{
    const template:SheetTemplate={id:'fictional-sheet',name:'Ficha fictícia do projeto',version:1,fields:[{key:'conceito',label:'Conceito',type:'TEXT',required:true},{key:'recursos',label:'Recursos',type:'NUMBER',required:true},{key:'ativo',label:'Ativo',type:'BOOLEAN',required:false},{key:'postura',label:'Postura',type:'CHOICE',required:true,options:['CAUTELOSA','OUSADA']}]};
    expect(validateSheet(template,{conceito:'Cartógrafa',recursos:3,ativo:true,postura:'OUSADA'})).toEqual({valid:true,errors:{}});
    expect(validateSheet(template,{conceito:'',recursos:'3',postura:'DESCONHECIDA'})).toEqual({valid:false,errors:{conceito:'Campo obrigatório.',recursos:'Informe um número.',postura:'Opção inválida.'}});
  });
});

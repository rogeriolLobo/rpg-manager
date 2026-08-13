import { describe, expect, it } from 'vitest';
import { calculateRpgNextAction, calculateRpgReadiness, calculateRpgRecommendationScore, compareRecommendations, type RecommendationCandidate } from '../../src/domain/rpg/recommendation';

const base: RecommendationCandidate = { title:'Base',wantsToPlay:false,priority:'NONE',readingStatus:'NOT_STARTED',hasPlayGroup:false,hasPlayed:false,tableStatus:'IDEA' };
describe('calculateRpgRecommendationScore',()=>{
  it('reproduz os pesos da planilha',()=>{expect(calculateRpgRecommendationScore(base)).toBe(20);expect(calculateRpgRecommendationScore({...base,wantsToPlay:true,priority:'HIGH',readingStatus:'READ',hasPlayGroup:true,tableStatus:'PLAYING'})).toBe(235);expect(calculateRpgRecommendationScore({...base,hasPlayed:true})).toBe(-20);});
  it('aplica pesos de prioridade e mesa',()=>{expect(calculateRpgRecommendationScore({...base,priority:'LOW',tableStatus:'PREPARING'})).toBe(45);expect(calculateRpgRecommendationScore({...base,priority:'MEDIUM',tableStatus:'SCHEDULED'})).toBe(65);});
  it('desempata na ordem funcional',()=>{const candidates=[{...base,title:'Zulu'},{...base,title:'Alpha',hasPlayGroup:true},{...base,title:'Beta',readingStatus:'READ' as const},{...base,title:'Gama',priority:'HIGH' as const},{...base,title:'Delta',wantsToPlay:true}];expect(candidates.sort(compareRecommendations).map(x=>x.title)).toEqual(['Delta','Gama','Beta','Alpha','Zulu']);});
  it.each([
    [base,'Avaliar interesse','Marcar Quero jogar? se interessar'],
    [{...base,hasPlayGroup:true},'Grupo disponível; avaliar interesse','Marcar Quero jogar? se interessar'],
    [{...base,readingStatus:'READ'},'Regras lidas; avaliar interesse','Marcar Quero jogar? se interessar'],
    [{...base,readingStatus:'READ',hasPlayGroup:true},'Pronto, se houver interesse','Marcar Quero jogar? se interessar'],
    [{...base,wantsToPlay:true},'Ler e definir grupo','Priorizar leitura'],
    [{...base,wantsToPlay:true,hasPlayGroup:true},'Ler antes de jogar','Priorizar leitura'],
    [{...base,wantsToPlay:true,readingStatus:'READ'},'Definir grupo','Convidar jogadores'],
    [{...base,wantsToPlay:true,readingStatus:'READ',hasPlayGroup:true},'Pronto para marcar','Marcar a mesa'],
    [{...base,tableStatus:'PREPARING'},'Preparando','Fechar data e sessão zero'],
    [{...base,tableStatus:'SCHEDULED'},'Já agendado','Preparar próxima sessão'],
    [{...base,tableStatus:'PLAYING'},'Em andamento','Continuar campanha'],
  ] as Array<[RecommendationCandidate,string,string]>)('explica prontidão e próxima ação',(candidate,readiness,action)=>{expect(calculateRpgReadiness(candidate)).toBe(readiness);expect(calculateRpgNextAction(candidate)).toBe(action);});
});

import { describe, expect, it } from 'vitest';
import { calculateRpgNextAction, calculateRpgReadiness, calculateRpgRecommendationScore, compareRecommendations, type RecommendationCandidate } from '../../src/domain/rpg/recommendation';

const base: RecommendationCandidate = { title:'Base',wantsToPlay:false,priority:'NONE',readingStatus:'NOT_STARTED',hasPlayGroup:false,hasPlayed:false,tableStatus:'IDEA' };
describe('calculateRpgRecommendationScore',()=>{
  it('reproduz os pesos da planilha',()=>{expect(calculateRpgRecommendationScore(base)).toBe(20);expect(calculateRpgRecommendationScore({...base,wantsToPlay:true,priority:'HIGH',readingStatus:'READ',hasPlayGroup:true,tableStatus:'PLAYING'})).toBe(235);expect(calculateRpgRecommendationScore({...base,hasPlayed:true})).toBe(-20);});
  it('aplica pesos de prioridade e mesa',()=>{expect(calculateRpgRecommendationScore({...base,priority:'LOW',tableStatus:'PREPARING'})).toBe(45);expect(calculateRpgRecommendationScore({...base,priority:'MEDIUM',tableStatus:'SCHEDULED'})).toBe(65);});
  it('desempata na ordem funcional',()=>{const candidates=[{...base,title:'Zulu'},{...base,title:'Alpha',hasPlayGroup:true},{...base,title:'Beta',readingStatus:'READ' as const},{...base,title:'Gama',priority:'HIGH' as const},{...base,title:'Delta',wantsToPlay:true}];expect(candidates.sort(compareRecommendations).map(x=>x.title)).toEqual(['Delta','Gama','Beta','Alpha','Zulu']);});
  it.each([
    [base,'Avaliar interesse','Marcar Quero jogar? se interessar'],
    [{...base,wantsToPlay:true},'Ler antes de jogar','Priorizar leitura'],
    [{...base,wantsToPlay:true,readingStatus:'READ'},'Definir grupo','Convidar jogadores'],
    [{...base,wantsToPlay:true,readingStatus:'READ',hasPlayGroup:true},'Preparar mesa','Iniciar preparação'],
    [{...base,wantsToPlay:true,readingStatus:'READ',hasPlayGroup:true,tableStatus:'PREPARING'},'Pronto para jogar','Agendar mesa'],
    [{...base,wantsToPlay:true,readingStatus:'READ',hasPlayGroup:true,tableStatus:'SCHEDULED'},'Pronto para jogar','Acompanhar mesa'],
  ] as Array<[RecommendationCandidate,string,string]>)('explica prontidão e próxima ação',(candidate,readiness,action)=>{expect(calculateRpgReadiness(candidate)).toBe(readiness);expect(calculateRpgNextAction(candidate)).toBe(action);});
});

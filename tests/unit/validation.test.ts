import { describe, expect, it } from 'vitest';
import { registerSchema, rpgInputSchema } from '../../src/shared/validation/schemas';
describe('validação de entrada',()=>{it('rejeita senha curta e campo arbitrário',()=>{expect(registerSchema.safeParse({email:'a@example.com',displayName:'A',password:'curta'}).success).toBe(false);expect(registerSchema.safeParse({email:'a@example.com',displayName:'A',password:'uma senha bem longa',admin:true}).success).toBe(false);});it('rejeita enum e notas fora do contrato',()=>{expect(rpgInputSchema.safeParse({title:'Teste',readingStatus:'HACKED',hasPlayed:false,wantsToPlay:false,priority:'NONE',tableStatus:'IDEA',notes:''}).success).toBe(false);});});


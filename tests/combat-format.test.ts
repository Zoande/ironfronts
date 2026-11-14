import {describe,expect,it} from 'vitest';
import {formatDamageRate} from '../src/ui/combat-format';
describe('combat profile rates',()=>{
 it.each([[0,'0'],[3.25,'3.3'],[342,'342'],[1200,'1.2K'],[12500,'13K'],[9500000,'9.5M'],[999950,'1M'],[999.5,'1K'],[NaN,'--']])('formats %s readably', (value,display)=>expect(formatDamageRate(Number(value))).toBe(display));
});

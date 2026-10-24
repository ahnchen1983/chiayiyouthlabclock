import {describe,it,expect} from 'vitest';
import {getMakeupAttachmentRuntime,ATTACHMENT_TECH_LIMITS} from '../netlify/functions/utils/makeupAttachmentRuntime';
describe('unmocked B4b production boundary',()=>{
 it('has no production adapter, approved policy, credentials, URL or dummy scanner',()=>{
  expect(getMakeupAttachmentRuntime()).toEqual({mode:'disabled',policy:null});
  expect(ATTACHMENT_TECH_LIMITS).toEqual({bytes:2097152,files:5,grantSeconds:60});
 });
});

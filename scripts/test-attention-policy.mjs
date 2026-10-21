import assert from 'node:assert/strict';
import {observationDelta,ATTENTION_POLL_SECONDS} from '../src/services/attentionPolicy.ts';
assert.equal(ATTENTION_POLL_SECONDS,15);
assert.equal(observationDelta(1000,false),1);
assert.equal(observationDelta(1000,true),0);
assert.equal(observationDelta(600000,false),2);
assert.equal(observationDelta(-10,false),0);
console.log(JSON.stringify({status:'passed',checks:5,scope:'attention transport guards; decision policy tested in Teaching Agent'}));

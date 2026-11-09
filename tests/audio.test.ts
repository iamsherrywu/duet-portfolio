import test from 'node:test';
import assert from 'node:assert/strict';
import {audioMime,validateAudioHeader} from '../src/lib/audio';
test('audio accepts recognized containers and rejects mismatched file data, huge clips and unsupported types',()=>{
 assert.equal(audioMime('audio/mp4;codecs=mp4a.40.2'),'audio/mp4');
 assert.equal(audioMime('image/png'),null);
 assert.equal(validateAudioHeader(new Uint8Array([0,0,0,16,102,116,121,112,77,52,65,32,0,0,0,0]),'audio/mp4'),true);
 assert.equal(validateAudioHeader(new Uint8Array([26,69,223,163,0,0,0,0]),'audio/webm'),true);
 assert.equal(validateAudioHeader(new Uint8Array([79,103,103,83,0,0,0,0]),'audio/ogg'),true);
 assert.equal(validateAudioHeader(new Uint8Array([137,80,78,71]),'audio/mp4'),false);
 assert.equal(validateAudioHeader(new Uint8Array(4*1024*1024+1),'audio/mp4'),false);
});

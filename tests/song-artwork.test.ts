import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectArtwork} from '../src/lib/server/song-artwork';
const row={trackName:'Eternal Sunshine',artistName:'Ariana Grande',collectionName:'eternal sunshine',artworkUrl100:'https://is1-ssl.mzstatic.com/a.jpg'};
test('cover match requires title, artist and specified album',()=>{
 assert.equal(selectArtwork([row],'eternal sunshine','Ariana Grande'),row.artworkUrl100);
 assert.equal(selectArtwork([row],'eternal sunshine','Other'),null);
 assert.equal(selectArtwork([row],'eternal sunshine','Ariana Grande','Live'),null);
 assert.equal(selectArtwork([{...row,artworkUrl100:'https://example.com/a.jpg'}],row.trackName,row.artistName),null);
});

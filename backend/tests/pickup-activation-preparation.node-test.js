import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyInstalledPickupClient} from '../src/verify-pickup-installed-client.js';
test('installed-client gate refuses unchanged historical client instead of claiming candidate activation',()=>{
 assert.throws(()=>verifyInstalledPickupClient(),/Installed Pickup client integrity refused/);
});

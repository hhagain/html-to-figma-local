import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeCaptureAddress } from '../dist/lib/capture-address.js';
import { safeLocalRelative, validateCaptureURL, resolveStateURL } from '../scripts/capture-source.mjs';
const { nativeCommand, trustedOrigin } = createRequire(import.meta.url)('../desktop/windows/policy.cjs');

test('Windows drive paths preserve spaces, Unicode and dynamic route suffixes', () => {
  const expected='file:///C:/Design%20Project/%E9%A1%B5%E9%9D%A2.html?demo=1#/dashboard';
  for(const value of [String.raw`C:\Design Project\页面.html?demo=1#/dashboard`,String.raw`"C:\Design%20Project\页面.html?demo=1#/dashboard"`,'c:/Design Project/页面.html?demo=1#/dashboard',expected]) assert.equal(normalizeCaptureAddress(value),expected);
  for(const value of [String.raw`C:\a\x.html:stream`,String.raw`C:\a%5cb\x.html`,String.raw`\\server\share\index.html`,String.raw`\\?\C:\index.html`]) assert.throws(()=>normalizeCaptureAddress(value));
  if(process.platform==='win32') {
    assert.equal(validateCaptureURL(String.raw`C:\Design Project\index.html#/a`).href,'file:///C:/Design%20Project/index.html#/a');
    assert.equal(resolveStateURL(String.raw`C:\Design Project\nested\detail.html`,'file:///C:/Design%20Project/index.html'),'file:///C:/Design%20Project/nested/detail.html');
    assert.throws(()=>resolveStateURL(String.raw`D:\secret\index.html`,'file:///C:/Design%20Project/index.html'));
    assert.throws(()=>validateCaptureURL('file:///C:/demo/file:stream.html'));
  }
});

test('Windows filesystem separators are allowed only after URL mapping, with hidden and device files blocked', () => {
  const options={windows:true,filesystem:true};
  assert.equal(safeLocalRelative(String.raw`assets\logo.png`,options),true);
  for(const input of [String.raw`..\secret.html`,String.raw`assets\.private\secret.html`,String.raw`assets\con.html`,String.raw`assets\photo.png:stream`,String.raw`assets\trailing.\x.html`]) assert.equal(safeLocalRelative(input,options),false,input);
  assert.equal(safeLocalRelative(String.raw`assets\logo.png`,{windows:true}),false);
  assert.equal(safeLocalRelative('assets/logo.png',{windows:true}),true);
});

test('Windows native commands require the trusted main frame and exact pending pairing request', () => {
  const context={url:'http://127.0.0.1:3847/desktop',serviceURL:'http://127.0.0.1:3847',mainFrame:true,pendingPairIDs:new Set(['pending-id'])};
  assert.deepEqual(nativeCommand({action:'pair-approve',id:'pending-id',command:'ignored'},context),{action:'pair-approve',id:'pending-id'});
  for(const changed of [{mainFrame:false},{url:'http://127.0.0.1:3848/desktop'},{url:'https://example.com/desktop'},{url:'http://127.0.0.1:3847/source/demo.html'},{url:'http://127.0.0.1:3847/'}]) assert.equal(nativeCommand({action:'pair-approve',id:'pending-id'},{...context,...changed}),null);
  assert.equal(nativeCommand({action:'pair-approve',id:'unknown'},context),null);
  assert.equal(nativeCommand({action:'execute'},context),null);
  assert.equal(trustedOrigin('http://127.0.0.1.evil/desktop',context.serviceURL),false);
  assert.deepEqual(nativeCommand({action:'show-plugin'},context),{action:'show-plugin'});
});

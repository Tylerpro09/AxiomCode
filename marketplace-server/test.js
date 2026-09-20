const test=require('node:test');
const assert=require('node:assert/strict');
const {parseRepoUrl,validateManifest,compareVersions}=require('./server');

test('parse GitHub repository URL',()=>{
  assert.deepEqual(parseRepoUrl('https://github.com/user/repo.git'),{owner:'user',repo:'repo',url:'https://github.com/user/repo'});
  assert.throws(()=>parseRepoUrl('https://example.com/user/repo'));
});
test('validate manifest',()=>{
  const m=validateManifest({id:'demo.ext',name:'Demo',version:'1.2.3',keywords:['x']});
  assert.equal(m.id,'demo.ext');
  assert.throws(()=>validateManifest({id:'../bad',name:'Bad',version:'1'}));
});
test('compare versions',()=>{
  assert.equal(compareVersions('1.2.0','1.1.9'),1);
  assert.equal(compareVersions('1.0.0','1.0.0'),0);
  assert.equal(compareVersions('1.0.0-beta','1.0.0'),-1);
});
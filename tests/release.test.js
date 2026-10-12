import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('再公開用の版番号・必須ファイル・追加コンテンツのハッシュが現行ファイルと一致する',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/prepare-release.mjs',import.meta.url)),'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/公開版と内容ハッシュが一致/);
});

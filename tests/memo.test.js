import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemo,MEMO_KEY} from '../memo.js';
function storage() {const map=new Map(); return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}
test('長文・改行を含むメモを保持し、閉じて開いても消さない',()=>{
  const memo=createMemo(storage()),text='必要保障額 = 5000 - 2500 - 800\n'.repeat(200);
  memo.setText(text); memo.setOpen(true); memo.setOpen(false); memo.setOpen(true);
  assert.equal(memo.text,text); assert.equal(memo.open,true);
});
test('同じタブの再読込でメモと開閉状態を復元、別のタブの保存領域へは共有しない',()=>{
  const same=storage(),memo=createMemo(same);
  memo.setText('3000 + 600 × 3 = 4800万円'); memo.setOpen(true);
  const restored=createMemo(same); assert.equal(restored.text,memo.text); assert.equal(restored.open,true);
  assert.equal(createMemo(storage()).text,'');
  assert.equal(same.getItem('fp2-trainer:v1'),null); // 学習履歴のキーに書き込まない。
});
test('保存領域が使えない、読出し・書込みが失敗する場合も画面内のメモを失わない',()=>{
  const failing={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('full');}};
  for(const target of [undefined,failing,{getItem:()=>null,setItem:()=>{throw Error('full');}}]) {
    const memo=createMemo(target); memo.setText('途中の計算'); memo.setOpen(true);
    assert.equal(memo.text,'途中の計算'); assert.equal(memo.open,true); assert.equal(memo.available,false);
  }
});
test('破損したメモや誤った型を読み込んでも起動を妨げない',()=>{
  for(const raw of ['{broken','null','{"text":1,"open":true}','{"text":"x","open":"yes"}']) {
    const target=storage(); target.setItem(MEMO_KEY,raw); const memo=createMemo(target);
    assert.equal(memo.text,''); assert.equal(memo.open,false); memo.setText('新しいメモ'); assert.equal(memo.text,'新しいメモ');
  }
});

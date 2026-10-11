import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, STORAGE_KEY, validateBank, validateHistory, emptyHistory, poolFor, shuffle, aggregate, isCorrect, createSession, submitAnswer, nextQuestion, finishSession, expired, saveState, loadState, exportBackup, importBackup } from '../core.js';

const bank = validateBank(JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8')));
const smallBank = { ...bank, questions: bank.questions.filter(q => /-00[12]$/.test(q.id)) };
const clone = value => JSON.parse(JSON.stringify(value));
const startTime = Date.parse('2026-10-11T06:00:00.000Z');
const config = (mode = 'random', count = 10, fieldIds = [], unitId = '') => ({ mode, count, fieldIds, unitId });
function oneSession(h, mode, correct = true, qid = 'life-001') {
  const b = { ...bank, questions: bank.questions.filter(q => q.id === qid) };
  const s = createSession(b, h, config(mode), startTime, () => .42);
  // テストでは同じ時刻で作るため、一意なセッションIDを付ける。
  s.id += `-${h.records[qid]?.attempts || 0}`;
  const q = s.questions[0];
  submitAnswer(h, s, correct ? q.correctChoiceId : q.choices.find(c => c.id !== q.correctChoiceId).id, startTime + 1000);
  finishSession(h, s, startTime + 2000);
  return s;
}
function memoryStorage() {
  const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}

test('300問・6分野各50問、4択、全解説、基準日・参照先がそろっている', () => {
  assert.equal(bank.questions.length, 300);
  bank.fields.forEach(f => assert.equal(bank.questions.filter(q => q.fieldId === f.id).length, 50));
  assert.equal(bank.questions.filter(q => q.needsReview).length, 6);
  bank.questions.forEach(q => {
    assert.equal(q.choices.length, 4);
    q.choices.forEach(c => assert.ok(c.explanation.length > 10));
    assert.equal(q.lastVerified, '2026-10-11');
  });
});
test('問題の重複ID・不明小単元・解説欠落・不正基準日を拒否', () => {
  for (const mutate of [b => b.questions.push(b.questions[0]), b => b.questions[0].unitId = 'bad', b => b.questions[0].choices[1].explanation = '', b => b.questions[0].basisDate = '2026-02-30', b => b.taxonomySource = null]) {
    const b = clone(bank); mutate(b); assert.throws(() => validateBank(b));
  }
});
test('Fisher-Yatesシャッフルは入力を変更せず、要素を保持して順序を変える', () => {
  const input = [1, 2, 3, 4]; const s = shuffle(input, () => 0);
  assert.deepEqual(input, [1, 2, 3, 4]); assert.notDeepEqual(s, input); assert.deepEqual([...s].sort(), input);
});
test('同一セッション内で重複出題せず、セッション間では再出題できる', () => {
  const h = emptyHistory(); const s = createSession(bank, h, config(), startTime, () => .3);
  assert.equal(new Set(s.questions.map(q => q.id)).size, 10);
  const other = createSession(bank, h, config(), startTime + 1, () => .3);
  assert.deepEqual(s.questions.map(q => q.id), other.questions.map(q => q.id));
});
test('全300問のシャッフル後も、全選択肢の正誤・解説対応が正しい', () => {
  for (const q of bank.questions) {
    const shuffled = shuffle(q.choices, () => .1);
    for (const c of shuffled) { assert.equal(isCorrect(q, c.id), q.correctChoiceId === c.id); assert.equal(c.explanation, q.choices.find(original => original.id === c.id).explanation); }
    assert.throws(() => isCorrect(q, 'not-a-choice'));
  }
});
test('1分野・複数分野・小単元の抽出が正しい', () => {
  const h = emptyHistory();
  assert.equal(poolFor(bank, h, config('field', 10, ['life'])).length, 50);
  assert.equal(poolFor(bank, h, config('field', 10, ['life', 'tax'])).length, 100);
  assert.equal(poolFor(bank, h, config('unit', 10, [], 'life-pension'))[0].id, 'life-001');
  assert.equal(poolFor(bank, h, config('field', 10, [])).length, 0);
});
test('少数の問題集では20問・60問指定の不足を全12問出題、空条件は拒否', () => {
  for (const count of [20, 60]) assert.equal(createSession(smallBank, emptyHistory(), config('random', count)).questions.length, 12);
  assert.throws(() => createSession(bank, emptyHistory(), config('field')));
  assert.throws(() => createSession(bank, emptyHistory(), config('review')));
});
test('要確認の問題は出題から外れる', () => {
  const b = clone(bank); b.questions[0].needsReview = true;
  assert.equal(poolFor(b, emptyHistory(), config()).length, poolFor(bank, emptyHistory(), config()).length-1);
});
test('60問模試は120分、12問模試は24分、不足する問題集では60問模試を拒否', () => {
  assert.throws(() => createSession(smallBank, emptyHistory(), config('mock', 60)));
  const full = createSession(bank, emptyHistory(), config('mock', 60), startTime);
  assert.equal(full.questions.length, 60);
  assert.equal(full.deadline - startTime, 120 * 60 * 1000);
  const s = createSession(bank, emptyHistory(), config('mock', 12), startTime);
  assert.equal(s.deadline - startTime, 24 * 60 * 1000);
});
test('二重回答を無視し、確定後の回答は変更できない', () => {
  const h = emptyHistory(), s = createSession(bank, h, config(), startTime), q = s.questions[0];
  assert.ok(submitAnswer(h, s, q.correctChoiceId, startTime));
  assert.equal(submitAnswer(h, s, q.choices.find(c => c.id !== q.correctChoiceId).id, startTime), false);
  assert.equal(h.records[q.id].attempts, 1); assert.equal(h.records[q.id].correct, 1); assert.equal(s.answers[q.id].choiceId, q.correctChoiceId);
});
test('未回答のまま進めず、回答後は次の問題の選択をクリア', () => {
  const h = emptyHistory(), s = createSession(bank, h, config(), startTime);
  assert.equal(nextQuestion(s), false); submitAnswer(h, s, s.questions[0].correctChoiceId, startTime);
  assert.ok(nextQuestion(s)); assert.equal(s.index, 1); assert.equal(s.selected, null); assert.equal(nextQuestion(s), false);
});
test('正答率は回答件数ベース、学習進捗は問題数ベース、ゼロ回答はnull', () => {
  const h = emptyHistory(); assert.equal(aggregate(bank.questions, h).accuracy, null);
  oneSession(h, 'random', true); oneSession(h, 'random', false);
  const a = aggregate(bank.questions, h);
  assert.equal(a.attempts, 2); assert.equal(a.accuracy, 50); assert.equal(a.learned, 1); assert.ok(Math.abs(a.progress - 100 / 300) < 1e-10);
  assert.equal(aggregate(bank.questions.filter(q => q.fieldId === 'life'), h).accuracy, 50);
  assert.equal(aggregate(bank.questions.filter(q => q.unitId === 'life-pension'), h).accuracy, 50);
});
test('不正解を復習待ちに登録し、通常正解では克服しない', () => {
  const h = emptyHistory(); oneSession(h, 'random', false); oneSession(h, 'random', true);
  assert.equal(h.records['life-001'].reviewPending, true); assert.equal(h.records['life-001'].reviewStreak, 0);
  assert.equal(poolFor(bank, h, config('review')).length, 1);
});
test('復習の2回連続正解で克服し、その後の不正解で再登録', () => {
  const h = emptyHistory(); oneSession(h, 'random', false); oneSession(h, 'review', true);
  assert.equal(h.records['life-001'].reviewStreak, 1); assert.ok(h.records['life-001'].reviewPending);
  oneSession(h, 'review', true); assert.equal(h.records['life-001'].reviewPending, false); assert.equal(h.records['life-001'].mastered, true);
  assert.equal(poolFor(bank, h, config('review')).length, 0);
  oneSession(h, 'random', false); assert.ok(h.records['life-001'].reviewPending); assert.equal(h.records['life-001'].mastered, false); assert.equal(h.records['life-001'].reviewStreak, 0);
});
test('連続正解の途中の不正解は連続回数を0に戻す', () => {
  const h = emptyHistory(); oneSession(h, 'random', false); oneSession(h, 'review', true); oneSession(h, 'review', false);
  assert.equal(h.records['life-001'].reviewStreak, 0); oneSession(h, 'review', true); assert.ok(h.records['life-001'].reviewPending);
  validateHistory(h);
});
test('模試回答は終了まで累計に加算せず、終了・採点は一度だけ', () => {
  const h = emptyHistory(), s = createSession(bank, h, config('mock', 12), startTime);
  submitAnswer(h, s, s.questions[0].correctChoiceId, startTime + 1000);
  assert.equal(aggregate(bank.questions, h).attempts, 0);
  const result = finishSession(h, s, startTime + 2000); assert.equal(result.answered, 1); assert.equal(result.total, 12);
  assert.equal(aggregate(bank.questions, h).attempts, 1); assert.equal(finishSession(h, s), false); assert.equal(aggregate(bank.questions, h).attempts, 1);
});
test('制限時間は絶対時刻で判定し、期限後の回答を拒否する', () => {
  const h = emptyHistory(), s = createSession(bank, h, config('mock', 12), startTime);
  assert.equal(expired(s, s.deadline - 1), false); assert.equal(expired(s, s.deadline), true);
  assert.throws(() => submitAnswer(h, s, s.questions[0].correctChoiceId, s.deadline)); assert.equal(Object.keys(s.answers).length, 0);
});
test('再起動後も累計履歴・選択肢順・確定回答が維持され、二重記録しない', () => {
  const storage = memoryStorage(), h = emptyHistory(), s = createSession(bank, h, config(), startTime);
  submitAnswer(h, s, s.questions[0].correctChoiceId, startTime); saveState(storage, h, s);
  const restored = loadState(storage, bank); assert.deepEqual(restored.history, h); assert.deepEqual(restored.active, s);
  assert.equal(submitAnswer(restored.history, restored.active, s.questions[0].correctChoiceId, startTime), false);
});
test('JSONバックアップが完全に復元でき、未知の問題IDも保持する', () => {
  const h = emptyHistory(); oneSession(h, 'random', false);
  h.records['future-999'] = { ...h.records['life-001'] };
  const restored = importBackup(JSON.stringify(exportBackup(h, bank.dataVersion)));
  assert.deepEqual(restored, h); assert.equal(aggregate(bank.questions, restored).attempts, 1);
});
test('不正JSON・将来バージョン・負数・件数矛盾・復習矛盾・危険IDを拒否し元履歴を保持', () => {
  const h = emptyHistory(); oneSession(h, 'random', false); const before = clone(h);
  const mutations = [
    p => p.schemaVersion = 2, p => p.history.records['life-001'].correct = -1,
    p => p.history.records['life-001'].attempts = 99,
    p => p.history.records['life-001'].reviewPending = false,
    p => p.history.records['life-001'].reviewStreak = 3,
    p => p.history.records['life-001'].lastAnsweredAt = 'invalid',
    p => Object.defineProperty(p.history.records, '__proto__', { value: p.history.records['life-001'], enumerable: true })
  ];
  for (const mutate of mutations) { const p = exportBackup(h, bank.dataVersion); mutate(p); assert.throws(() => importBackup(JSON.stringify(p))); }
  assert.throws(() => importBackup('not json')); assert.deepEqual(h, before);
});
test('問題追加・問題文変更後も既存IDの履歴と途中の問題スナップショットを保持', () => {
  const h = emptyHistory(), s = createSession(bank, h, config(), startTime); submitAnswer(h, s, s.questions[0].correctChoiceId, startTime);
  const b = clone(bank); b.questions[0].prompt = '更新した問題文'; b.questions.push({ ...clone(bank.questions[0]), id: 'life-future-test' }); validateBank(b);
  const storage = memoryStorage(); saveState(storage, h, s); const restored = loadState(storage, b);
  assert.deepEqual(restored.history, h); assert.deepEqual(restored.active.questions, s.questions);
  assert.equal(aggregate(b.questions, h).total, 301);
});
test('途中の演習が壊れていても有効な累計履歴は復元する', () => {
  const h = emptyHistory(), s = createSession(bank, h, config(), startTime), q = s.questions[0], storage = memoryStorage();
  submitAnswer(h, s, q.correctChoiceId, startTime);
  const invalid = [{ bad: true }, { ...clone(s), index: 99 }, { ...clone(s), selected: q.choices.find(c => c.id !== q.correctChoiceId).id }, { ...clone(s), orders: {} }];
  for (const active of invalid) {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: VERSION, history: h, active }));
    const restored = loadState(storage, bank); assert.deepEqual(restored.history, h); assert.equal(restored.active, null); assert.ok(restored.warning);
  }
});
test('破損した保存履歴は投げて停止し、保存領域の元データに触れない', () => {
  const storage = memoryStorage(); storage.setItem(STORAGE_KEY, '{broken'); assert.throws(() => loadState(storage, bank)); assert.equal(storage.getItem(STORAGE_KEY), '{broken');
});
test('演習履歴は50件に制限し、累計記録は保持する', () => {
  const h = emptyHistory(); for (let i = 0; i < 55; i++) oneSession(h, 'random', true);
  assert.equal(h.sessions.length, 50); assert.equal(h.records['life-001'].attempts, 55); validateHistory(h);
});

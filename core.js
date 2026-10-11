// DOM に依存しない学習ロジック。問題・選択肢は常に ID で扱う。
import { gradeConfig } from './grades.js';
export const VERSION = 1;
export const STORAGE_KEY = 'fp2-trainer:v1';
const MODES = ['random', 'field', 'unit', 'review', 'mock'];
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const objectOK = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOK = value => typeof value === 'string' && value.trim().length > 0;
const intOK = value => Number.isSafeInteger(value) && value >= 0;
const dateOK = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function uniqueIDs(items) { return items.every(item => idOK(item.id)) && new Set(items.map(item => item.id)).size === items.length; }
const dayOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && dateOK(value) && new Date(value).toISOString().slice(0, 10) === value;

export function validateBank(bank) {
  requireThat(objectOK(bank) && bank.schemaVersion === VERSION, '問題データのバージョンが対応していません。');
  requireThat(textOK(bank.dataVersion), '問題データの版がありません。');
  gradeConfig(bank.grade ?? '2');
  requireThat(objectOK(bank.taxonomySource) && textOK(bank.taxonomySource.title) && typeof bank.taxonomySource.url === 'string' && /^https:\/\//.test(bank.taxonomySource.url), '試験範囲の参照資料が不正です。');
  requireThat(Array.isArray(bank.fields) && bank.fields.length === 6 && uniqueIDs(bank.fields), '6分野の定義を確認してください。');
  const units = new Set();
  bank.fields.forEach(field => {
    requireThat(textOK(field.name) && Array.isArray(field.units) && uniqueIDs(field.units), '小単元の定義が不正です。');
    field.units.forEach(unit => {
      requireThat(textOK(unit.name) && !units.has(unit.id), '小単元IDは全分野で一意にしてください。');
      units.add(unit.id);
    });
  });
  requireThat(Array.isArray(bank.questions) && bank.questions.length > 0 && uniqueIDs(bank.questions), '問題IDが重複しているか、問題がありません。');
  bank.questions.forEach(q => {
    const field = bank.fields.find(f => f.id === q.fieldId);
    requireThat(field && field.units.some(u => u.id === q.unitId), `${q.id}: 分野・小単元が不正です。`);
    requireThat(textOK(q.prompt) && ['基礎', '標準', '応用'].includes(q.difficulty), `${q.id}: 問題文・難易度が不正です。`);
    const choiceCount = String(bank.grade) === '3' ? ({ 'true-false': 2, 'three-choice': 3 })[q.format] : 4;
    requireThat(choiceCount && Array.isArray(q.choices) && q.choices.length === choiceCount && uniqueIDs(q.choices), `${q.id}: 出題形式と選択肢の件数を確認してください。`);
    if (q.format === 'true-false') requireThat(q.choices[0].id === 'true' && q.choices[1].id === 'false', `${q.id}: ○・×の順序を確認してください。`);
    requireThat(q.choices.some(c => c.id === q.correctChoiceId) && textOK(q.correctReason), `${q.id}: 正解情報が不正です。`);
    q.choices.forEach(c => requireThat(textOK(c.text) && textOK(c.explanation), `${q.id}: 全選択肢に解説が必要です。`));
    requireThat(Array.isArray(q.sources) && q.sources.length > 0 && q.sources.every(s => textOK(s.title) && /^https:\/\//.test(s.url)), `${q.id}: 参照資料が不正です。`);
    requireThat(dayOK(q.basisDate) && dayOK(q.lastVerified) && typeof q.needsReview === 'boolean', `${q.id}: 基準日・確認日・要確認フラグが不正です。`);
  });
  return bank;
}

export function emptyHistory() { return { schemaVersion: VERSION, records: {}, sessions: [] }; }
export function emptyRecord() {
  return { attempts: 0, correct: 0, incorrect: 0, lastAnsweredAt: null, lastCorrect: null, reviewPending: false, reviewStreak: 0, mastered: false };
}

export function validateHistory(value) {
  requireThat(objectOK(value) && value.schemaVersion === VERSION && objectOK(value.records) && Array.isArray(value.sessions), '学習履歴の形式またはバージョンが不正です。');
  requireThat(Object.keys(value.records).length <= 100000 && value.sessions.length <= 50, '履歴の件数が上限を超えています。');
  const clean = emptyHistory();
  for (const [id, r] of Object.entries(value.records)) {
    requireThat(idOK(id) && objectOK(r), '問題IDまたは履歴が不正です。');
    requireThat(intOK(r.attempts) && intOK(r.correct) && intOK(r.incorrect) && r.attempts === r.correct + r.incorrect, `${id}: 回答件数に矛盾があります。`);
    requireThat(typeof r.reviewPending === 'boolean' && typeof r.mastered === 'boolean' && intOK(r.reviewStreak) && r.reviewStreak <= 2, `${id}: 復習情報が不正です。`);
    requireThat(!(r.reviewPending && r.mastered) && (!r.mastered || r.reviewStreak === 2) && (!r.reviewPending || r.reviewStreak < 2), `${id}: 克服状態に矛盾があります。`);
    requireThat(r.attempts ? dateOK(r.lastAnsweredAt) && typeof r.lastCorrect === 'boolean' : r.lastAnsweredAt === null && r.lastCorrect === null, `${id}: 最終回答情報が不正です。`);
    requireThat(r.attempts > 0 || (!r.reviewPending && !r.mastered && r.reviewStreak === 0), `${id}: 未回答の復習状態が不正です。`);
    requireThat(r.incorrect > 0 || (!r.reviewPending && !r.mastered && r.reviewStreak === 0), `${id}: 不正解のない復習状態が不正です。`);
    requireThat(r.lastCorrect !== false || (r.reviewPending && r.reviewStreak === 0), `${id}: 最終不正解の復習状態が不正です。`);
    requireThat(r.lastCorrect !== true || r.correct > 0, `${id}: 最終正解と正解件数に矛盾があります。`);
    clean.records[id] = { ...emptyRecord(), attempts: r.attempts, correct: r.correct, incorrect: r.incorrect, lastAnsweredAt: r.lastAnsweredAt, lastCorrect: r.lastCorrect, reviewPending: r.reviewPending, reviewStreak: r.reviewStreak, mastered: r.mastered };
  }
  const sessionIDs = new Set();
  clean.sessions = value.sessions.map(s => {
    requireThat(objectOK(s) && idOK(s.id) && !sessionIDs.has(s.id) && MODES.includes(s.mode) && dateOK(s.startedAt) && dateOK(s.endedAt), '演習履歴が不正です。');
    sessionIDs.add(s.id);
    requireThat(intOK(s.total) && s.total > 0 && intOK(s.answered) && intOK(s.correct) && s.correct <= s.answered && s.answered <= s.total, '演習結果の件数が不正です。');
    return { id: s.id, mode: s.mode, total: s.total, answered: s.answered, correct: s.correct, startedAt: s.startedAt, endedAt: s.endedAt };
  });
  return clean;
}

export function exportBackup(history, dataVersion, now = new Date().toISOString(), grade = '2') {
  return { app: gradeConfig(grade).backupApp, schemaVersion: VERSION, exportedAt: now, dataVersion, history: validateHistory(history) };
}
export function importBackup(text, grade = '2') {
  requireThat(typeof text === 'string' && text.length <= 20 * 1024 * 1024, 'バックアップは20MB以下にしてください。');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSONファイルとして読み込めませんでした。'); }
  requireThat(objectOK(parsed) && parsed.app === gradeConfig(grade).backupApp && parsed.schemaVersion === VERSION && dateOK(parsed.exportedAt), '選択中の級のバックアップではありません。級を切り替えてから読み込んでください。');
  return validateHistory(parsed.history);
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function poolFor(bank, history, settings) {
  return bank.questions.filter(q => !q.needsReview && (
    settings.mode === 'field' ? settings.fieldIds.includes(q.fieldId) :
    settings.mode === 'unit' ? q.unitId === settings.unitId :
    settings.mode === 'review' ? history.records[q.id]?.reviewPending : true
  ));
}
export function isCorrect(question, choiceId) {
  requireThat(question.choices.some(c => c.id === choiceId), '選択肢IDが見つかりません。');
  return question.correctChoiceId === choiceId;
}
function recordAnswer(history, q, choiceId, mode, answeredAt) {
  const correct = isCorrect(q, choiceId);
  const r = { ...emptyRecord(), ...history.records[q.id] };
  r.attempts++; r[correct ? 'correct' : 'incorrect']++;
  r.lastAnsweredAt = answeredAt; r.lastCorrect = correct;
  if (!correct) { r.reviewPending = true; r.reviewStreak = 0; r.mastered = false; }
  else if (mode === 'review' && r.reviewPending) {
    r.reviewStreak++;
    if (r.reviewStreak >= 2) { r.reviewPending = false; r.mastered = true; }
  }
  history.records[q.id] = r;
}
export function aggregate(questions, history) {
  let attempts = 0, correct = 0, learned = 0, pending = 0, mastered = 0;
  for (const q of questions) {
    const r = history.records[q.id];
    if (!r) continue;
    attempts += r.attempts; correct += r.correct;
    learned += r.attempts > 0 ? 1 : 0;
    pending += r.reviewPending ? 1 : 0; mastered += r.mastered ? 1 : 0;
  }
  return { attempts, correct, incorrect: attempts - correct, learned, pending, mastered, total: questions.length, accuracy: attempts ? correct / attempts * 100 : null, progress: questions.length ? learned / questions.length * 100 : 0 };
}
export function createSession(bank, history, settings, now = Date.now(), random = Math.random) {
  requireThat(MODES.includes(settings.mode), '出題モードが不正です。');
  requireThat([10, 20, 60, 12].includes(settings.count), '出題数が不正です。');
  const pool = poolFor(bank, history, settings);
  requireThat(pool.length > 0, '条件に合う問題がありません。別の条件を選んでください。');
  if (settings.mode === 'mock') requireThat(pool.length >= settings.count, '模試に必要な問題数がありません。');
  let selected = shuffle(pool, random).slice(0, settings.count);
  if (settings.mode === 'mock' && String(bank.grade) === '3') {
    // 60問は各分野○×5問・3択5問。お試し12問も各分野各形式1問。
    const perField = settings.count === 60 ? 5 : 1;
    requireThat([60, 12].includes(settings.count), '3級模試は60問または12問を選んでください。');
    selected = ['true-false', 'three-choice'].flatMap(format => bank.fields.flatMap(field => {
      const candidates = pool.filter(q => q.fieldId === field.id && q.format === format);
      requireThat(candidates.length >= perField, '3級模試の各分野・各形式に必要な問題数が不足しています。');
      return shuffle(candidates, random).slice(0, perField);
    }));
  }
  const questions = selected.map(q => JSON.parse(JSON.stringify(q)));
  return {
    id: `s-${now}-${Math.floor(random() * 1e9)}`, mode: settings.mode,
    dataVersion: bank.dataVersion, questions,
    orders: Object.fromEntries(questions.map(q => [q.id, q.format === 'true-false' ? q.choices.map(c => c.id) : shuffle(q.choices.map(c => c.id), random)])),
    answers: {}, index: 0, selected: null, startedAt: new Date(now).toISOString(),
    deadline: settings.mode === 'mock' ? now + settings.count * gradeConfig(bank.grade ?? '2').minutesPerQuestion * 60000 : null
  };
}
export function expired(session, now = Date.now()) { return session.mode === 'mock' && now >= session.deadline; }
export function submitAnswer(history, session, choiceId, now = Date.now()) {
  requireThat(!expired(session, now), '制限時間が終了しました。');
  const q = session.questions[session.index];
  if (Object.hasOwn(session.answers, q.id)) return false;
  isCorrect(q, choiceId);
  const answer = { choiceId, answeredAt: new Date(now).toISOString() };
  session.answers[q.id] = answer;
  session.selected = choiceId;
  if (session.mode !== 'mock') recordAnswer(history, q, choiceId, session.mode, answer.answeredAt);
  return true;
}
export function nextQuestion(session) {
  if (!session.answers[session.questions[session.index].id]) return false;
  if (session.index >= session.questions.length - 1) return false;
  session.index++; session.selected = null; return true;
}
export function finishSession(history, session, now = Date.now()) {
  if (history.sessions.some(s => s.id === session.id)) return false;
  if (session.mode === 'mock') {
    for (const q of session.questions) {
      const a = session.answers[q.id];
      if (a) recordAnswer(history, q, a.choiceId, session.mode, a.answeredAt);
    }
  }
  const answered = Object.keys(session.answers).length;
  const correct = session.questions.filter(q => session.answers[q.id]?.choiceId === q.correctChoiceId).length;
  const result = { id: session.id, mode: session.mode, total: session.questions.length, answered, correct, startedAt: session.startedAt, endedAt: new Date(now).toISOString() };
  history.sessions.unshift(result); history.sessions = history.sessions.slice(0, 50);
  return result;
}

export function validateActive(session, bank) {
  if (session === null) return null;
  requireThat(objectOK(session) && idOK(session.id) && MODES.includes(session.mode) && dateOK(session.startedAt) && textOK(session.dataVersion), '途中の演習データが不正です。');
  // 開始時の問題スナップショットを保持し、更新中も判定・解説を変えない。
  validateBank({ ...bank, questions: session.questions });
  requireThat(session.questions.length <= 60 && intOK(session.index) && session.index < session.questions.length && objectOK(session.orders) && objectOK(session.answers), '演習の進捗が不正です。');
  requireThat(session.mode === 'mock' ? Number.isSafeInteger(session.deadline) && session.deadline > Date.parse(session.startedAt) : session.deadline === null, '模試の制限時間が不正です。');
  const ids = new Set(session.questions.map(q => q.id));
  requireThat(Object.keys(session.answers).every(id => ids.has(id)), '演習内にない回答があります。');
  session.questions.forEach((q, i) => {
    const order = session.orders[q.id];
    requireThat(Array.isArray(order) && order.length === q.choices.length && new Set(order).size === q.choices.length && order.every(id => q.choices.some(c => c.id === id)), '選択肢の順序が不正です。');
    if (q.format === 'true-false') requireThat(order[0] === 'true' && order[1] === 'false', '○・×の順序が不正です。');
    const a = session.answers[q.id];
    requireThat(i >= session.index || !!a, '未回答の問題を飛ばしています。');
    requireThat(i <= session.index || !a, '進捗より先の回答があります。');
    if (a) requireThat(objectOK(a) && q.choices.some(c => c.id === a.choiceId) && dateOK(a.answeredAt), '保存された回答が不正です。');
  });
  const current = session.questions[session.index];
  requireThat(session.selected === null || current.choices.some(c => c.id === session.selected), '保存された選択肢が不正です。');
  requireThat(!session.answers[current.id] || session.selected === session.answers[current.id].choiceId, '確定した回答と選択状態に矛盾があります。');
  return session;
}

export function loadState(storage, bank) {
  const text = storage.getItem(gradeConfig(bank.grade ?? '2').storageKey);
  if (!text) return { history: emptyHistory(), active: null };
  const state = JSON.parse(text);
  requireThat(objectOK(state) && state.schemaVersion === VERSION, '保存形式が対応していません。');
  const history = validateHistory(state.history);
  try {
    const active = validateActive(state.active, bank);
    if (active) {
      const byId = new Map(bank.questions.map(q => [q.id, q]));
      const excluded = active.questions.some(q => byId.get(q.id)?.needsReview);
      const revised = active.dataVersion !== bank.dataVersion && bank.lawBasisDate && active.questions.some(q => {
        const current = byId.get(q.id);
        return current && JSON.stringify([q.prompt, q.choices, q.correctChoiceId, q.correctReason]) !== JSON.stringify([current.prompt, current.choices, current.correctChoiceId, current.correctReason]);
      });
      if (excluded || revised) return { history, active: null, warning: '問題の検証・校正により、途中の演習に修正済みまたは要確認の問題が含まれています。最新の問題で演習を始め直してください。累計の学習履歴は保持しています。模試の未採点回答は累計に含まれません。' };
    }
    return { history, active };
  }
  catch { return { history, active: null, warning: '途中の演習データを再開できませんでした。累計の学習履歴は保持しています。模試の未採点回答は累計に含まれません。' }; }
}
export function saveState(storage, history, active, grade = '2') {
  storage.setItem(gradeConfig(grade).storageKey, JSON.stringify({ schemaVersion: VERSION, history, active }));
}

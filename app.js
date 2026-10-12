import { VERSION, validateBank, emptyHistory, loadState, saveState, exportBackup, importBackup, poolFor, aggregate, createSession, submitAnswer, nextQuestion, finishSession, expired } from './core.js';
import { createMemo } from './memo.js';
import { GRADES, GRADE_PREFERENCE_KEY, gradeConfig, readGrade } from './grades.js';
import { validatePastBank, createPastUI } from './past.js';

let pastUI = null;

const main = document.querySelector('#main');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#confirm-dialog');
const memoPanel = document.querySelector('#memo-panel');
const memoInput = document.querySelector('#answer-memo');
let memoStorage;
try { memoStorage = window.sessionStorage; } catch { /* メモはメモリで保持する。 */ }
const memo = createMemo(memoStorage);
memoInput.value = memo.text;
function syncMemo() {
  const button = main.querySelector('[data-action="memo"]');
  memoPanel.hidden = !button || !memo.open;
  document.body.classList.toggle('memo-open', !memoPanel.hidden);
  button?.setAttribute('aria-expanded', String(memo.open));
}
// iPhoneのソフトウェアキーボード表示中も、見える範囲を上下の窓に配分する。
function fitStudyViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--study-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
  document.documentElement.style.setProperty('--study-viewport-top', `${viewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener('resize', fitStudyViewport);
window.visualViewport?.addEventListener('scroll', fitStudyViewport);
window.addEventListener('resize', fitStudyViewport);
fitStudyViewport();
memoInput.addEventListener('input', () => { memo.setText(memoInput.value); syncMemo(); });
document.querySelector('#memo-close').addEventListener('click', () => {
  memo.setOpen(false); syncMemo(); main.querySelector('[data-action="memo"]')?.focus();
});
memoPanel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); document.querySelector('#memo-close').click(); }
});
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); main.focus(); });
const modeNames = { random: '全分野ランダム', field: '分野別演習', unit: '小単元別演習', review: '間違い直し', mock: '模擬試験' };
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  book: '<path d="M12 5c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1z"/><path d="M12 5v15"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  repeat: '<path d="M19 8a8 8 0 0 0-13-2L3 9m0-5v5h5M5 16a8 8 0 0 0 13 2l3-3m0 5v-5h-5"/>',
  life: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M9 15l3 3 3-3"/>',
  risk: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  finance: '<path d="M3 20V4m0 16h18M7 15l5-5 4 2 5-7M17 5h4v4"/>',
  tax: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2m4 0h2M8 16h2m4 0h2"/>',
  estate: '<path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7"/>',
  inheritance: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v6H5v3m7-3h7v3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.book}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const percent = n => n === null ? '未学習' : `${Math.round(n)}%`;
const dateLabel = date => new Date(date).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
let bank, history = emptyHistory(), active = null, resultSession = null, settings = { mode: 'random', count: 10, fieldIds: [], unitId: '' };
let grade = '2', banks = {};
const unsavedGrades = new Map();
let storage, protectedStorage = false, storageFailed = false, waitingWorker = null, conflictingTab = false;

function showNotice(message, error = false) {
  notice.textContent = message;
  const close = document.createElement('button'); close.className = 'text-button'; close.textContent = '閉じる'; close.setAttribute('aria-label', '通知を閉じる'); close.addEventListener('click', () => { notice.hidden = true; }); notice.append(close);
  notice.hidden = false; notice.classList.toggle('error', error);
}
function persist() {
  if (protectedStorage || conflictingTab) return false;
  try { saveState(storage, history, active, grade); unsavedGrades.delete(grade); storageFailed = false; return true; }
  catch { unsavedGrades.set(grade,{history,active}); storageFailed = true; showNotice('履歴を端末に保存できません。今回の学習は画面を閉じると失われる可能性があります。「データ・設定」でバックアップを保存してください。', true); return false; }
}
function canMutate() {
  if (conflictingTab) { showNotice('別のタブで履歴が更新されました。記録の上書きを防ぐため、この画面を再読み込みしてください。', true); return false; }
  if (protectedStorage) { showNotice('保存データを読み込めませんでした。元データを保護しています。「データ・設定」から元データの保存・復元・初期化を行ってください。', true); return false; }
  return true;
}
function pageHead(eyebrow, title, subtitle) {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><span class="date-chip">${new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}</span></div>`;
}
function metric(label, value, unit, foot, empty = false) { return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-number${empty ? ' empty' : ''}">${value}<small>${unit}</small></div><div class="metric-foot">${foot}</div></div>`; }
function metrics() {
  const a = aggregate(bank.questions, history);
  return `<div class="metric-grid">${metric('累計正答率', a.accuracy === null ? '未学習' : Math.round(a.accuracy), a.accuracy === null ? '' : '%', `${a.correct} 正解 / ${a.attempts} 回答`, a.accuracy === null)}${metric('学習済み問題', a.learned, `/ ${a.total} 問`, `学習進捗 ${Math.round(a.progress)}%`)}${metric('復習待ち', a.pending, '問', '復習で2回連続正解すると克服')}</div>`;
}
function subjectCards() {
  return bank.fields.map((f, i) => {
    const a = aggregate(bank.questions.filter(q => q.fieldId === f.id), history);
    return `<button class="subject-card" data-action="field" data-id="${esc(f.id)}" aria-label="${esc(f.name)}の演習設定"><div class="subject-top"><span class="subject-icon">${icon(f.id)}</span><div><span class="subject-index">分野 ${String(i + 1).padStart(2, '0')}</span><h3>${esc(f.shortName || f.name)}</h3></div></div><div class="subject-data"><strong>${percent(a.accuracy)}</strong><span>累計正答率</span></div><div class="progress" role="progressbar" aria-label="${esc(f.name)}の学習進捗" aria-valuenow="${Math.round(a.progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${a.progress}%"></span></div><div class="subject-foot"><span>学習済み ${a.learned} / ${a.total} 問</span><span>${Math.round(a.progress)}%</span></div></button>`;
  }).join('');
}
function homeView() {
  const a = aggregate(bank.questions, history), last = history.sessions[0];
  const mockCount = poolFor(bank, history, { mode: 'mock' }).length >= 60 ? 60 : 12;
  return `${pageHead('毎日の学びを、合格につなげる', '一日、一問から。', 'まずは一問。6分野の基礎を身につけて、苦手を得意に変えていきましょう。')}
    ${active ? `<div class="bottom-panel resume"><div><h3>途中の${modeNames[active.mode]}があります</h3><p>${Object.keys(active.answers).length} / ${active.questions.length} 問を回答済み${active.mode === 'mock' ? ' · 制限時間は離席中も進みます' : ''}</p></div><button class="button primary" data-action="resume">続きから再開 ${icon('arrow')}</button></div>` : ''}
    ${metrics()}
    <div class="section-head"><h2>今日の学習をはじめる</h2><a href="#settings">出題条件を設定 ${icon('arrow')}</a></div>
    <div class="action-grid"><article class="action-card green"><span class="badge">6分野からランダムに</span><span class="action-symbol">${icon('book')}</span><h2>まずは、10問から。</h2><p>問題ごとの解説で、知識をひとつずつ確かめる。</p><button class="button light" data-action="random">ランダム演習をはじめる ${icon('arrow')}</button></article>
    <article class="action-card warm"><span class="small muted">復習待ち ${a.pending} 問</span><span class="action-symbol">${icon('repeat')}</span><h2>間違いが、学びになる。</h2><p>${a.pending ? '復習で2回連続正解して、苦手を克服しよう。' : '間違えた問題がここに集まります。'}</p><button class="button warm-button" data-action="review" ${a.pending ? '' : 'disabled'}>間違い直しをはじめる ${icon('arrow')}</button></article></div>
    <div class="bottom-panel"><div><h3>公表過去問を解く</h3><p>日本FP協会の公表問題・図表を、公式の正解で採点。1問ずつの練習と本番形式を選べます。</p></div><a class="button secondary" href="#past">過去問を解く ${icon('arrow')}</a></div>
    <div class="section-head"><h2>6分野の学習状況</h2><a href="#stats">成績を詳しく見る ${icon('arrow')}</a></div><div class="subject-grid">${subjectCards()}</div>
    <div class="bottom-panel"><div><h3>本番を意識した、${mockCount === 60 ? '60問模試' : 'お試し模試'}</h3><p>全${mockCount}問・${mockCount * gradeConfig(grade).minutesPerQuestion}分。解説は試験終了後にまとめて確認。</p></div><button class="button secondary" data-action="mock">模試を設定 ${icon('arrow')}</button></div>
    ${last ? `<div class="bottom-panel"><div><h3>直近の演習 · ${modeNames[last.mode]}</h3><p>${dateLabel(last.endedAt)} · ${last.answered} 問回答 / ${last.correct} 問正解${last.answered < last.total ? ` / 未回答 ${last.total - last.answered} 問` : ''}</p></div><strong>${last.answered ? Math.round(last.correct / last.answered * 100) + '%' : '回答なし'}</strong></div>` : ''}`;
}
function settingsView() {
  const pool = poolFor(bank, history, settings), mock = settings.mode === 'mock';
  const modes = [['random', '全分野からランダムに出題'], ['field', '1つ、または複数の分野を選択'], ['unit', '小単元をひとつ選んで集中演習'], ['review', '復習待ちの問題をもう一度'], ['mock', '制限時間付き・解説は終了後']];
  return `<div class="narrow">${pageHead('学ぶ内容を選ぶ', '出題設定', '今の自分に合った演習で、無理なく学習を進めましょう。')}
  <div class="panel"><fieldset><legend>01　出題モード</legend><div class="mode-grid">${modes.map(([mode, desc]) => `<label class="mode-option"><input type="radio" name="mode" value="${mode}" ${settings.mode === mode ? 'checked' : ''}><span><strong>${modeNames[mode]}</strong><small>${desc}</small></span></label>`).join('')}</div></fieldset>
  ${settings.mode === 'field' ? `<fieldset><legend>02　分野を選ぶ（複数選択可）</legend><div class="fields-grid">${bank.fields.map(f => `<label class="field-option"><input type="checkbox" name="fields" value="${esc(f.id)}" ${settings.fieldIds.includes(f.id) ? 'checked' : ''}>${esc(f.name)}</label>`).join('')}</div></fieldset>` : ''}
  ${settings.mode === 'unit' ? `<fieldset><legend>02　小単元を選ぶ</legend><label for="unit-select" class="small muted">分野 / 小単元</label><select id="unit-select" name="unit">${bank.fields.map(f => `<optgroup label="${esc(f.name)}">${f.units.map(u => `<option value="${esc(u.id)}" ${u.id === settings.unitId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</optgroup>`).join('')}</select></fieldset>` : ''}
  <fieldset><legend>${['field', 'unit'].includes(settings.mode) ? '03' : '02'}　${mock ? '模試の種類' : '出題数'}</legend>
  ${mock ? `<div class="counts"><label class="count-option"><input type="radio" name="count" value="12" ${settings.count === 12 ? 'checked' : ''}>お試し12問</label><label class="count-option"><input type="radio" name="count" value="60" ${settings.count === 60 ? 'checked' : ''} ${pool.length < 60 ? 'disabled' : ''}>60問模試</label></div><p class="disabled-note">${pool.length < 60 ? '正式な60問模試は、出題可能な問題が60問以上になってから利用できます。' : `60問模試の制限時間は${60 * gradeConfig(grade).minutesPerQuestion}分です。${grade === '3' ? '正誤30問・3択30問、各分野10問です。' : ''}`}</p>` : `<div class="counts">${[10, 20, 60].map(n => `<label class="count-option"><input type="radio" name="count" value="${n}" ${settings.count === n ? 'checked' : ''}>${n}問</label>`).join('')}</div>`}</fieldset>
  <div class="availability${pool.length < settings.count && !mock ? ' warning' : ''}">出題対象 <strong>${pool.length}</strong> 問
  <p>${!pool.length ? (settings.mode === 'review' ? '復習待ちの問題はありません。通常演習で学習を進めましょう。' : '条件に合う問題がありません。分野・小単元を選び直してください。') : pool.length < settings.count && !mock ? `${settings.count}問の指定に対し、利用可能なのは${pool.length}問です。下のボタンで全${pool.length}問を出題するか、条件を選び直してください。` : mock ? `${settings.count}問・${settings.count * gradeConfig(grade).minutesPerQuestion}分。回答確定後の変更はできません。正誤・解説は終了時に表示します。` : `重複なしで${Math.min(pool.length, settings.count)}問を出題します。問題と択一式の選択肢はランダムな順序です。○・×の順序は固定です。`}</p></div>
  ${bank.questions.some(q => q.needsReview) ? `<p class="small muted">内容が要確認の問題は出題対象から除外しています。</p>` : ''}
  <button class="button primary" data-action="start" ${!pool.length || (mock && pool.length < settings.count) ? 'disabled' : ''}>${pool.length < settings.count && !mock && pool.length ? `全${pool.length}問で演習をはじめる` : mock ? '模試をはじめる' : '演習をはじめる'} ${icon('arrow')}</button>
  </div><p class="small muted">学習履歴はこのブラウザに保存されます。PCとiPhoneの履歴は、JSONバックアップを使って移せます。</p></div>`;
}
function names(q) {
  const f = bank.fields.find(f => f.id === q.fieldId);
  return { field: f?.name || q.fieldId, unit: f?.units.find(u => u.id === q.unitId)?.name || q.unitId };
}
function explanation(q, order, chosenId) {
  const letters = q.format === 'true-false' ? ['○','×'] : q.format === 'three-choice' ? ['1','2','3'] : ['A','B','C','D'], correct = q.choices.find(c => c.id === q.correctChoiceId);
  return `<div class="correct-answer"><strong>正解：${letters[order.indexOf(correct.id)]}</strong>${q.format === 'true-false' ? '' : '　' + esc(correct.text)}</div><h3>考え方のポイント</h3><p class="small">${esc(q.correctReason)}</p>
    <div class="explanations">${order.map((id, i) => { const c = q.choices.find(c => c.id === id); return `<div class="explanation-item"><strong>${q.format === 'true-false' ? '' : letters[i] + '　'}${esc(c.text)} ${id === q.correctChoiceId ? '<span class="badge">正解</span>' : ''} ${id === chosenId ? '<span class="badge">あなたの回答</span>' : ''}</strong><p>${esc(c.explanation)}</p></div>`; }).join('')}</div>
    <details class="sources"><summary>参照資料・基準日</summary><p>法令・制度の基準日：${esc(q.basisDate)}<br>最終確認日：${esc(q.lastVerified)} · オリジナル問題 · ${esc(q.id)}</p>${q.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join('')}<p>外部の参照資料はオンライン時に閲覧できます。</p></details>`;
}
function quizView() {
  if (!active) return homeView();
  const q = active.questions[active.index], answered = active.answers[q.id], order = active.orders[q.id], mock = active.mode === 'mock', show = !!answered && !mock;
  const n = names(q), completed = Object.keys(active.answers).length, last = active.index === active.questions.length - 1;
  return `<div class="narrow"><div class="quiz-header"><div class="quiz-count">${modeNames[active.mode]} · <strong>${active.index + 1}</strong> / ${active.questions.length} 問</div><div class="quiz-tools"><button class="button secondary memo-toggle" data-action="memo" aria-controls="memo-panel" aria-expanded="${memo.open}">解答用メモ</button>${mock ? '<span class="timer" id="timer" role="timer" aria-label="模試の残り時間"></span>' : `<button class="text-button" data-action="pause">あとで続ける</button>`}</div></div>
  <div class="progress" role="progressbar" aria-label="回答進捗" aria-valuenow="${completed}" aria-valuemin="0" aria-valuemax="${active.questions.length}"><span style="width:${completed / active.questions.length * 100}%"></span></div>
  <div class="panel quiz-panel"><div class="question-meta"><span class="badge">${esc(n.field)}</span><span class="badge">${esc(n.unit)}</span><span class="badge">${esc(q.difficulty)}</span><span class="badge">${gradeConfig(grade).label} · ${q.format === 'true-false' ? '正誤' : q.format === 'three-choice' ? '3択' : '4択'}</span></div><h1 class="question-title">${esc(q.prompt)}</h1>
  <div class="choices" role="group" aria-label="${q.choices.length}つの選択肢">${order.map((id, i) => { const c = q.choices.find(c => c.id === id), selected = active.selected === id; return `<button class="choice${selected ? ' selected' : ''}${show && id === q.correctChoiceId ? ' correct' : ''}${show && selected && id !== q.correctChoiceId ? ' wrong' : ''}" data-action="choice" data-id="${id}" aria-pressed="${selected}" ${answered ? 'disabled' : ''}><span class="choice-letter">${q.format === 'true-false' ? (id === 'true' ? '○' : '×') : q.format === 'three-choice' ? i + 1 : 'ABCD'[i]}</span><span>${q.format === 'true-false' ? (id === 'true' ? '正しい' : '誤り') : esc(c.text)}${show && id === q.correctChoiceId ? '（正解）' : ''}${show && selected && id !== q.correctChoiceId ? '（あなたの回答）' : ''}</span></button>`; }).join('')}</div>
  ${show ? `<section class="answer-block" aria-label="解答・解説"><p class="answer-status${answered.choiceId !== q.correctChoiceId ? ' incorrect' : ''}" role="status">${answered.choiceId === q.correctChoiceId ? '正解です。' : '不正解 · 復習待ちに登録しました。'}</p>${explanation(q, order, answered.choiceId)}${active.mode === 'review' ? `<p class="small muted">${history.records[q.id]?.mastered ? 'この問題を克服しました。復習待ちから外れました。' : `復習での連続正解：${history.records[q.id]?.reviewStreak || 0} / 2回`}</p>` : ''}</section>` : ''}
  ${mock && answered ? '<p class="small muted" role="status" style="margin-top:18px">回答を確定しました。正誤は試験終了後に確認できます。</p>' : ''}
  <div class="quiz-actions"><span class="muted small">${answered ? '回答確定後の変更はできません' : '選択肢を選んでから確定してください'}</span><button class="button primary" data-action="${answered ? 'next' : 'submit'}" ${!answered && !active.selected ? 'disabled' : ''}>${answered ? last ? '結果を見る' : '次の問題へ' : '回答を確定する'} ${icon('arrow')}</button></div></div>
  <div class="button-row"><button class="text-button" data-action="finish">${mock ? '模試を終了して採点する' : 'ここまでで演習を終了する'}</button>${mock ? '<button class="text-button" data-action="pause">ホームへ戻る（時間は進みます）</button>' : ''}</div></div>`;
}
function resultView() {
  if (!resultSession) return homeView();
  const s = resultSession, answered = Object.keys(s.answers).length, correct = s.questions.filter(q => s.answers[q.id]?.choiceId === q.correctChoiceId).length;
  const wrong = s.questions.filter(q => s.answers[q.id] && s.answers[q.id].choiceId !== q.correctChoiceId);
  const pending = aggregate(bank.questions, history).pending, mock = s.mode === 'mock';
  return `<div class="narrow">${pageHead('今日の一歩を振り返る', 'おつかれさまでした。', `${modeNames[s.mode]}の結果です。解説を確認して、次の学びにつなげましょう。`)}
  <div class="result-hero"><h2>${mock ? '模試スコア（未回答も出題数に含む）' : '今回の正答率（回答した問題）'}</h2><div class="result-score">${mock ? Math.round(correct / s.questions.length * 100) : answered ? Math.round(correct / answered * 100) : '—'}<small>${mock || answered ? '%' : '回答なし'}</small></div><p>${mock ? `回答した問題の正答率：${answered ? Math.round(correct / answered * 100) + '%' : '回答なし'} · ` : ''}${s.questions.length} 問中 ${answered} 問を回答</p></div>
  <div class="result-metrics"><div><strong>${answered}</strong><span>回答問題数</span></div><div><strong>${correct}</strong><span>正解数</span></div><div><strong>${wrong.length}</strong><span>不正解数</span></div><div><strong>${s.questions.length - answered}</strong><span>未回答数</span></div></div>
  <div class="section-head"><h2>間違えた問題 · ${wrong.length}問</h2></div>${wrong.length ? wrong.map(q => resultDetail(q, s)).join('') : `<div class="empty-state"><h3>${answered ? '回答した問題はすべて正解です。' : '今回はまだ回答がありません。'}</h3><p>自分のペースで、次の演習へ進みましょう。</p></div>`}
  <details class="panel"><summary>すべての問題・解説を確認する</summary><div style="margin-top:18px">${s.questions.map(q => resultDetail(q, s)).join('')}</div></details>
  <div class="button-row"><button class="button primary" data-action="review" ${pending ? '' : 'disabled'}>復習待ちの問題を復習する ${icon('repeat')}</button><a class="button secondary" href="#home">ホームへ戻る</a></div><p class="small muted" style="margin-top:14px">累計正答率は回答した問題だけで計算します。未回答は不正解履歴に加算しません。</p></div>`;
}
function resultDetail(q, s) {
  const a = s.answers[q.id], correct = a?.choiceId === q.correctChoiceId;
  return `<details class="explanation-toggle"><summary><span class="badge">${!a ? '未回答' : correct ? '正解' : '不正解'}</span><span>${esc(q.prompt)}</span></summary><div class="detail-content">${explanation(q, s.orders[q.id], a?.choiceId)}</div></details>`;
}
function statsView() {
  const all = aggregate(bank.questions, history);
  return `${pageHead('学びの積み重ねを見える化', '学習成績', '正答率と学習進捗は別の指標です。回答を重ねるほど、苦手が見えてきます。')}${metrics()}
  <div class="panel"><div class="section-head"><h2>分野別の累計正答率</h2><span class="muted">克服済み ${all.mastered} 問</span></div>${bank.fields.map(f => { const a = aggregate(bank.questions.filter(q => q.fieldId === f.id), history); return `<div class="chart-row"><span>${esc(f.shortName || f.name)}</span><div class="progress" role="progressbar" aria-label="${esc(f.name)} 累計正答率 ${percent(a.accuracy)}" aria-valuenow="${Math.round(a.accuracy || 0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${a.accuracy || 0}%"></span></div><strong>${percent(a.accuracy)}</strong></div>`; }).join('')}</div>
  <div class="panel"><h2>小単元・問題ごとの成績</h2>${bank.fields.map(f => `<section class="stats-field"><h3>${esc(f.name)}</h3><div class="table-wrap"><table><thead><tr><th>小単元</th><th>回答数</th><th>正答率</th><th>学習済み</th></tr></thead><tbody>${f.units.map(u => { const a = aggregate(bank.questions.filter(q => q.unitId === u.id), history); return `<tr><td>${esc(u.name)}</td><td>${a.attempts}回</td><td>${percent(a.accuracy)}</td><td>${a.learned} / ${a.total}問</td></tr>`; }).join('')}</tbody></table></div><details style="margin-top:13px"><summary class="small">問題ごとの履歴を確認</summary><div class="table-wrap"><table><thead><tr><th>問題ID・小単元</th><th>正解 / 回答</th><th>正答率</th><th>状態</th><th>最終回答</th></tr></thead><tbody>${bank.questions.filter(q => q.fieldId === f.id).map(q => { const r = history.records[q.id]; return `<tr><td>${esc(q.id)}<br>${esc(names(q).unit)}</td><td>${r?.correct || 0} / ${r?.attempts || 0}</td><td>${percent(r?.attempts ? r.correct / r.attempts * 100 : null)}</td><td>${!r?.attempts ? '未学習' : r.reviewPending ? `復習待ち（${r.reviewStreak}/2）` : r.mastered ? '克服済み' : '学習済み'}</td><td>${r?.lastAnsweredAt ? `${dateLabel(r.lastAnsweredAt)}<br>${r.lastCorrect ? '正解' : '不正解'}` : '—'}</td></tr>`; }).join('')}</tbody></table></div></details></section>`).join('')}</div>
  <div class="panel"><h2>直近の演習履歴</h2>${history.sessions.length ? `<div class="session-list">${history.sessions.slice(0, 10).map(s => `<div class="session-row"><span>${modeNames[s.mode]}<br><span class="muted">${dateLabel(s.endedAt)} · ${s.answered} / ${s.total} 問回答</span></span><strong>${s.answered ? Math.round(s.correct / s.answered * 100) + '%' : '回答なし'}<br><span class="muted">${s.correct} 問正解</span></strong></div>`).join('')}</div>` : '<p class="muted small">まだ演習を終了していません。学習をはじめると、ここに結果が記録されます。</p>'}<p class="small muted" style="margin-top:15px">正答率 = 累計正解回答数 ÷ 累計回答数 × 100。演習履歴は直近50回分を保存し、画面には10回分を表示します。累計件数は保持します。</p></div>`;
}
function dataView() {
  const unknown = Object.keys(history.records).filter(id => !bank.questions.some(q => q.id === id)).length;
  const pending = bank.questions.filter(q => q.needsReview);
  return `${pageHead('大切な学習記録を守る', 'データ・設定', `${gradeConfig(grade).label}の履歴を管理します。履歴とバックアップは級ごとに分かれています。`)}
  ${protectedStorage ? '<div class="panel danger-panel"><h2>保存データを保護しています</h2><p class="small">保存形式を確認できません。元のデータを保存してから、有効なバックアップを復元するか、履歴の初期化を行ってください。</p><button class="button secondary" data-action="raw-export">読み込めなかった元データを保存</button></div>' : ''}
  <div class="panel data-card"><div><h2>履歴をバックアップ</h2><p>累計成績・復習状態・演習結果をJSONファイルで保存します。<br>進行中の演習はバックアップに含みません。</p></div><button class="button primary" data-action="export" ${protectedStorage ? 'disabled' : ''}>JSONを書き出す</button></div>
  <div class="panel data-card"><div><h2>バックアップから復元</h2><p>ファイルを検証した後、確認画面を表示します。<br>復元すると現在の履歴を置き換え、途中の演習を終了します。</p></div><button class="button secondary" data-action="import">JSONを読み込む</button><input type="file" id="import-file" accept=".json,application/json" hidden></div>
  <div class="panel"><h2>このアプリについて</h2><p class="small">問題データ ${esc(bank.dataVersion)} · ${bank.questions.length}問 · 保存形式 v${VERSION}<br>${gradeConfig(grade).label}の学習用オリジナル${gradeConfig(grade).formatLabel}問題です。法令・制度の基準日は各問題の解説で確認できます。</p><p class="small muted">${unknown ? `現在の問題集に含まれない${unknown}件の問題IDの履歴も保持しています。成績の集計対象は現在の問題集です。<br>` : ''}自動同期はありません。別の端末へ移すときはバックアップを利用してください。プライベートブラウズやブラウザデータの消去で履歴が失われる場合があります。</p><a class="small" href="${esc(bank.taxonomySource.url)}" target="_blank" rel="noopener noreferrer">日本FP協会の${grade}級試験範囲を確認 ↗</a></div>
  <div class="panel"><h2>問題の検証・校正</h2><p class="small">全${bank.questions.length}問の問題文・正解・全選択肢・解説を照合しました。<br>確認済み ${bank.questions.length-pending.length}問 · 要確認 ${pending.length}問<br>法令基準日：${esc(bank.lawBasisDate || '各問題を参照')} · 照合日：2026-10-11</p><p class="small">要確認の問題はすべての演習・模試から除外しています。検証記録には、問題ごとの修正内容と出典URLを収録しています。</p><div class="button-row"><a class="button secondary" href="${gradeConfig(grade).audit}.md" download>検証記録を保存</a><a class="button secondary" href="${gradeConfig(grade).audit}.json" download>検証JSONを保存</a></div>${pending.map(q=>`<details class="explanation-toggle"><summary><span class="badge">要確認</span><span>${esc(q.id)} · ${esc(names(q).unit)}</span></summary><div class="detail-content"><p>${esc(q.prompt)}</p><p class="small">${esc(q.reviewReason)}</p>${q.sources.map(s=>`<p class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></p>`).join('')}</div></details>`).join('')}</div>
  <div class="panel"><h2>iPhoneでホーム画面に追加</h2><ol class="help-list"><li>HTTPSで公開したこのアプリを、Safariで開きます。</li><li>共有メニューから「ホーム画面に追加」を選びます。</li><li>追加したアイコンで起動し、一度オンラインで問題を読み込みます。</li><li>上部に「オフライン利用の準備完了」が表示されてから、オフラインで利用してください。</li></ol><p class="small muted">初回は接続が必要です。参照先の外部サイトはオフラインでは開けません。</p></div>
  <div class="panel data-card danger-panel"><div><h2>学習履歴を初期化</h2><p>成績・復習状態・途中の演習を削除します。<br>この操作は取り消せません。必要なら先にバックアップしてください。</p></div><button class="button secondary" data-action="reset">履歴を削除する</button></div>`;
}

function render(focus = false) {
  if (!bank) return;
  let page = location.hash.slice(1) || 'home';
  if (!['home', 'settings', 'quiz', 'result', 'stats', 'data', 'past', 'past-quiz', 'past-result'].includes(page)) page = 'home';
  if ((page === 'quiz' && !active) || (page === 'result' && !resultSession)) page = 'home';
  const views = { home: homeView, settings: settingsView, quiz: quizView, result: resultView, stats: statsView, data: dataView };
  main.innerHTML = page.startsWith('past') ? pastUI.view(page) : views[page]();
  syncMemo();
  document.querySelectorAll('nav a').forEach(a => { const selected = a.dataset.page === (['quiz', 'result'].includes(page) ? 'settings' : page); a.classList.toggle('active', selected); if (selected) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = `${{home:'ホーム',settings:'出題設定',quiz:'問題演習',result:'学習結果',stats:'学習成績',data:'データ・設定',past:'過去問', 'past-quiz':'過去問演習', 'past-result':'過去問の結果'}[page]} | ${gradeConfig(grade).label} 学習トレーナー`;
  tick();
  if (focus) { main.scrollTop = 0; main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function go(page) { if (location.hash === `#${page}`) render(true); else location.hash = page; }
function confirmAction(title, message, label = '実行する', danger = false) {
  if (dialog.open) return Promise.resolve(false);
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#dialog-message').textContent = message;
  const button = document.querySelector('#dialog-confirm'); button.textContent = label; button.className = `button ${danger ? 'danger' : 'primary'}`;
  return new Promise(resolve => { dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); dialog.querySelector('[value="cancel"]').focus(); });
}
function finish(now = Date.now()) {
  if (!active || !canMutate()) return;
  const s = active;
  finishSession(history, s, now); active = null; resultSession = s; persist();
  go('result');
}
function tick() {
  pastUI?.tick();
  if (!active || active.mode !== 'mock') return;
  if (expired(active)) {
    if (dialog.open) dialog.close('cancel');
    finish(); showNotice('制限時間が終了したため、確定した回答を採点しました。'); return;
  }
  const el = document.querySelector('#timer');
  if (el) { const remaining = Math.max(0, Math.ceil((active.deadline - Date.now()) / 1000)); el.textContent = `残り ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`; el.classList.toggle('urgent', remaining <= 60); }
}
function download(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function start() {
  if (!canMutate()) return;
  if (active) {
    const previous = active;
    const ok = await confirmAction('途中の演習があります', '新しい演習を始めると、途中の演習を終了します。確定した回答は成績に記録します。', '終了して新しく開始');
    if (!ok || active !== previous || !canMutate()) return;
    finishSession(history, active); active = null;
  }
  try { active = createSession(bank, history, settings); persist(); go('quiz'); }
  catch (err) { persist(); showNotice(err.message, true); }
}
main.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'import-file') { readImport(input); return; }
  if (input.name === 'mode') { settings.mode = input.value; settings.count = input.value === 'mock' ? (poolFor(bank, history, { mode: 'mock' }).length >= 60 ? 60 : 12) : (settings.count === 12 ? 10 : settings.count); }
  else if (input.name === 'count') settings.count = Number(input.value);
  else if (input.name === 'fields') settings.fieldIds = [...main.querySelectorAll('[name="fields"]:checked')].map(el => el.value);
  else if (input.name === 'unit') settings.unitId = input.value;
  else return;
  const name = input.name, value = input.value;
  render();
  main.querySelector(name === 'unit' ? '#unit-select' : `[name="${name}"][value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
});
main.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  const action = el.dataset.action;
  try {
    if (action === 'random') { settings.mode = 'random'; settings.count = 10; await start(); }
    else if (action === 'review') { settings.mode = 'review'; settings.count = 10; go('settings'); }
    else if (action === 'mock') { settings.mode = 'mock'; settings.count = poolFor(bank, history, settings).length >= 60 ? 60 : 12; go('settings'); }
    else if (action === 'field') { settings.mode = 'field'; settings.fieldIds = [el.dataset.id]; settings.count = 10; go('settings'); }
    else if (action === 'start') { el.disabled = true; await start(); if (el.isConnected) el.disabled = false; }
    else if (action === 'resume') go('quiz');
    else if (action === 'pause') go('home');
    else if (action === 'memo') { memo.setOpen(!memo.open); syncMemo(); }
    else if (action === 'choice' && active && canMutate()) {
      if (expired(active)) { tick(); return; }
      if (!active.answers[active.questions[active.index].id]) { active.selected = el.dataset.id; persist(); render(); main.querySelector(`[data-action="choice"][data-id="${el.dataset.id}"]`)?.focus({ preventScroll: true }); }
    }
    else if (action === 'submit' && active && canMutate()) {
      if (expired(active)) { tick(); return; }
      if (active.selected && submitAnswer(history, active, active.selected)) { persist(); render(); document.querySelector('.answer-status')?.scrollIntoView({ block: 'nearest' }); }
    }
    else if (action === 'next' && active && canMutate()) { if (expired(active)) tick(); else if (nextQuestion(active)) { persist(); render(true); } else if (active.answers[active.questions[active.index].id]) finish(); }
    else if (action === 'finish' && active && canMutate()) { const s = active; if (await confirmAction('ここまでで終了しますか？', `確定した${Object.keys(s.answers).length}問を記録します。未回答は不正解履歴に加算しません。`, '終了して結果を見る') && active === s) finish(); }
    else if (action === 'export') { download(JSON.stringify(exportBackup(history, bank.dataVersion, new Date().toISOString(), grade), null, 2), `fp${grade}-history-${new Date().toISOString().slice(0, 10)}.json`); showNotice('バックアップを書き出しました。ダウンロードしたファイルを保管してください。'); }
    else if (action === 'raw-export') { download(storage.getItem(gradeConfig(grade).storageKey) || '', `fp${grade}-original-data.txt`, 'text/plain'); }
    else if (action === 'import') document.querySelector('#import-file').click();
    else if (action === 'reset') {
      if (conflictingTab) { canMutate(); return; }
      if (await confirmAction(`${gradeConfig(grade).label}の学習履歴を削除しますか？`, `${gradeConfig(grade).label}の累計成績・復習状態・途中の演習を削除します。必要な履歴は、先にこの級のJSONバックアップで保存してください。`, 'この級の履歴を削除する', true)) {
        // 先にストレージへ保存。失敗時は画面上の履歴も維持する。
        const clean = emptyHistory();
        try { saveState(storage, clean, null, grade); } catch { showNotice('削除を保存できませんでした。履歴は変更していません。', true); return; }
        history = clean; active = null; resultSession = null; protectedStorage = false; storageFailed = false; showNotice('学習履歴を初期化しました。'); render();
      }
    }
  } catch (err) { showNotice(err.message || '操作を完了できませんでした。', true); }
});
async function readImport(input) {
  const file = input.files?.[0]; if (!file) return;
  input.value = '';
  if (conflictingTab) { canMutate(); return; }
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('バックアップは20MB以下にしてください。');
    const importGrade = grade;
    const text = await file.text();
    if (grade !== importGrade) throw new Error('級が変更されたため、読み込みを中止しました。');
    const imported = importBackup(text, importGrade);
    const a = aggregate(bank.questions, imported);
    const ok = await confirmAction('このバックアップを復元しますか？', `現在の問題集の回答 ${a.attempts}回・正解 ${a.correct}回・復習待ち ${a.pending}問を復元します。\n現在の履歴を置き換え、途中の演習は終了します。必要なら先に現在の履歴を書き出してください。`, '履歴を置き換える');
    if (!ok || grade !== importGrade) return;
    if (conflictingTab) { canMutate(); return; }
    try { saveState(storage, imported, null, grade); } catch { throw new Error('端末に保存できないため、復元を中止しました。現在の履歴は変更していません。'); }
    history = imported; active = null; resultSession = null; protectedStorage = false; storageFailed = false;
    showNotice('バックアップから学習履歴を復元しました。'); render();
  } catch (err) { showNotice(`読み込みを中止しました：${err.message} 現在の履歴は変更していません。`, true); }
}
window.addEventListener('hashchange', () => render(true));
window.addEventListener('storage', event => { if (event.key === gradeConfig(grade).storageKey || event.key === null) { conflictingTab = true; showNotice('別のタブで学習データが変更されました。記録の上書きを防ぐため、この画面を再読み込みしてください。', true); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
setInterval(tick, 1000);

let offlineReady = false;
function networkStatus() { document.querySelector('#network-status').textContent = navigator.onLine ? offlineReady ? '● オフライン利用の準備完了' : '● オンライン' : offlineReady ? '● オフラインで学習中' : '● オフライン'; }
window.addEventListener('online', networkStatus); window.addEventListener('offline', networkStatus);
async function setupPWA() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { networkStatus(); showNotice('オフライン利用にはHTTPS公開またはlocalhostでの起動が必要です。'); return; }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    function showUpdate(worker) { waitingWorker = worker; document.querySelector('#update-banner').hidden = false; }
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => { const worker = reg.installing; worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller && reg.waiting) showUpdate(reg.waiting); }); });
    const ready = await navigator.serviceWorker.ready;
    if (ready.active) { offlineReady = true; networkStatus(); }
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (waitingWorker && !reloading) { reloading = true; location.reload(); } });
  } catch { showNotice('オフライン用データの準備に失敗しました。オンラインで再読み込みしてください。', true); }
}
document.querySelector('#apply-update').addEventListener('click', () => {
  if (active || pastUI?.hasActive()) { showNotice('進行中の演習・過去問を終了してから、アプリを更新してください。'); return; }
  if (storageFailed || protectedStorage || conflictingTab) { showNotice('学習データの保存状態を確認し、バックアップを取ってから再読み込みしてください。', true); return; }
  waitingWorker?.postMessage({ type: 'ACTIVATE_UPDATE' });
});

function loadGradeState() {
  bank = banks[grade]; history = emptyHistory(); active = null; resultSession = null;
  protectedStorage = false; storageFailed = false; conflictingTab = false;
  settings = { mode: 'random', count: 10, fieldIds: bank.fields.map(f=>f.id), unitId: bank.fields[0].units[0].id };
  try {
    if (!storage) throw new Error('保存領域なし');
    const state = unsavedGrades.get(grade) || loadState(storage, bank); history = state.history; active = state.active;
    if (unsavedGrades.has(grade)) storageFailed = true;
    if (state.warning) showNotice(state.warning,true);
  } catch {
    if (!storage) {
      storage = { getItem:()=>null, setItem:()=>{throw new Error('保存領域なし');} };
      storageFailed = true; showNotice('ブラウザに保存できません。学習後に選択中の級のJSONバックアップを保存してください。',true);
    } else { protectedStorage = true; showNotice('選択中の級の保存データを読み込めません。元データを保護しています。「データ・設定」で確認してください。',true); }
  }
  document.querySelector('#grade-select').value = grade;
  document.querySelector('.topbar-title').textContent = gradeConfig(grade).label + ' 学習トレーナー';
  document.querySelector('.sidebar-note p').textContent = gradeConfig(grade).label + '・6分野・' + bank.questions.length + '問';
  document.querySelector('.stage-tag').textContent = gradeConfig(grade).formatLabel + ' / ' + bank.questions.length + '問';
}
document.querySelector('#grade-select').addEventListener('change', event => {
  const next = event.target.value;
  if (!GRADES[next] || next === grade) return;
  if (dialog.open || !canMutate()) { event.target.value = grade; return; }
  persist();
  grade = next; notice.hidden = true; loadGradeState();
  try { storage.setItem(GRADE_PREFERENCE_KEY,grade); } catch { showNotice('級の選択を保存できません。次回起動時はFP2級から始まります。',true); }
  if (active && expired(active)) { finish(); showNotice('前回の模試は制限時間を過ぎたため、確定した回答を採点しました。'); }
  else go('home');
});

async function init() {
  try {
    await Promise.all(Object.entries(GRADES).map(async ([level,config]) => {
      const response = await fetch(config.bankFile);
      if (!response.ok) throw new Error(config.label + 'の問題データを取得できませんでした。');
      banks[level] = validateBank(await response.json());
    }));
    try { storage = window.localStorage; } catch { /* 保存不可時も演習を続けられる。 */ }
    grade = readGrade(storage); loadGradeState();
    const pastResponse = await fetch('./past-exams.json');
    if (!pastResponse.ok) throw new Error('過去問データを取得できませんでした。');
    const pastData = validatePastBank(await pastResponse.json());
    pastUI = createPastUI({data:pastData, storage, main, getGrade:()=>grade, go, render, showNotice, confirmAction, download});
    document.querySelector('#grade-select').disabled = false;
    if (active && expired(active)) { finish(); showNotice('前回の模試は制限時間を過ぎたため、確定した回答を採点しました。'); }
    render(); networkStatus(); setupPWA();
  } catch (err) { main.innerHTML = `<div class="panel"><h1>アプリを起動できませんでした</h1><p>${esc(err.message)}</p><p>フォルダをHTTPサーバーで開き、必要なファイルがそろっているか確認してください。初回はオンラインで読み込みが必要です。</p><button class="button primary" onclick="location.reload()">再読み込み</button></div>`; }
}
init();

export const PAST_KEY = 'fp-past-exams:v1';
const safe = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const requireThat = (condition, text) => { if (!condition) throw new Error(text); };
export function validatePastBank(data) {
  requireThat(data?.schemaVersion === 1 && Array.isArray(data.exams) && data.exams.length > 0, '過去問データの形式が不正です。');
  requireThat(new Set(data.exams.map(e => e.id)).size === data.exams.length, '過去問のセットIDが重複しています。');
  for (const e of data.exams) {
    requireThat(/^fp[23]-\d{6}$/.test(e.id) && ['2','3'].includes(e.grade) && e.id.startsWith('fp'+e.grade+'-') && typeof e.title === 'string' && /^https:\/\//.test(e.sourceUrl), '過去問の出典・級を確認してください。');
    requireThat(e.answerUrl === undefined || /^https:\/\//.test(e.answerUrl), '過去問の模範解答の出典を確認してください。');
    requireThat(e.minutes === (e.grade === '2' ? 120 : 90) && /^\d{4}-\d\d-\d\d$/.test(e.lawBasisDate), '過去問の時間・基準日が不正です。');
    requireThat(e.questions.length === 60, '過去問は60問のセットが必要です。');
    e.questions.forEach((q, i) => {
      const options = e.grade === '3' && i < 30 ? ['○','×'] : e.grade === '2' ? ['1','2','3','4'] : ['1','2','3'];
      requireThat(q.format === (e.grade === '3' && i < 30 ? 'true-false' : 'choice'), '過去問の出題形式が不正です。');
      requireThat(q.number === i + 1 && JSON.stringify(q.choices) === JSON.stringify(options) && options.includes(q.correct), '過去問の番号・正解・選択肢が不正です。');
      requireThat(typeof q.text === 'string' && q.text.trim() && !/正解\s*[1-4○〇×]/.test(q.text), '過去問の本文を確認してください。');
      requireThat(Array.isArray(q.images) && q.images.length > 0 && q.images.every(p => /^\.\/past-exams\/fp[23]-\d{6}-q\d{2}-\d+\.png$/.test(p)), '過去問画像のパスが不正です。');
    });
  }
  return data;
}
export function emptyPastState() { return {schemaVersion:1, active:{}, results:[]}; }
export function startPast(exam, mode = 'practice', now = Date.now()) {
  requireThat(['practice','mock'].includes(mode), '過去問の出題方式が不正です。');
  return {id:`p-${now}-${Math.random().toString(36).slice(2,9)}`,examId:exam.id,grade:exam.grade,mode,index:0,answers:{},selected:null,
    startedAt:new Date(now).toISOString(),deadline:mode === 'mock' ? now+exam.minutes*60000 : null};
}
export function pastExpired(s, now = Date.now()) { return s?.mode === 'mock' && now >= s.deadline; }
export function answerPast(s, exam, choice, now = Date.now()) {
  requireThat(s.examId === exam.id && !s.endedAt && !pastExpired(s,now), 'この過去問は回答を確定できません。');
  const q = exam.questions[s.index];
  requireThat(q.choices.includes(choice), '選択肢が不正です。');
  if (s.mode === 'practice' && Object.hasOwn(s.answers,String(q.number))) return false;
  s.answers[q.number] = choice; s.selected = choice; return true;
}
export function scorePast(s, exam) {
  const answered = Object.keys(s.answers).length;
  const correct = exam.questions.filter(q => s.answers[q.number] === q.correct).length;
  return {total:60,answered,correct,incorrect:answered-correct,unanswered:60-answered,score:correct,passed:correct>=36};
}
export function finishPast(s, exam, now = Date.now()) {
  if (s.endedAt) return false;
  s.endedAt = new Date(now).toISOString(); s.selected = null; return {...s,score:scorePast(s,exam)};
}
export function validatePastState(value, data) {
  requireThat(safe(value) && value.schemaVersion === 1 && safe(value.active) && Array.isArray(value.results) && value.results.length <= 50, '過去問の保存形式が不正です。');
  const validate = (s, ended = false) => {
    const exam = data.exams.find(e => e.id === s?.examId);
    requireThat(safe(s) && /^p-[A-Za-z0-9_-]{1,80}$/.test(s.id) && exam && s.grade === exam.grade && ['practice','mock'].includes(s.mode) && Number.isInteger(s.index) && s.index>=0 && s.index<60 && safe(s.answers) && date(s.startedAt), '過去問の途中保存が不正です。');
    requireThat(s.mode === 'practice' ? s.deadline === null : s.deadline === Date.parse(s.startedAt)+exam.minutes*60000, '過去問の制限時間に矛盾があります。');
    for (const [n,c] of Object.entries(s.answers)) requireThat(/^[1-9]\d?$/.test(n) && Number(n)<=60 && exam.questions[Number(n)-1].choices.includes(c), '過去問の保存済み回答が不正です。');
    requireThat(s.selected === null || exam.questions[s.index].choices.includes(s.selected), '選択中の回答が不正です。');
    requireThat(ended ? date(s.endedAt) && Date.parse(s.endedAt)>=Date.parse(s.startedAt) && JSON.stringify(s.score)===JSON.stringify(scorePast(s,exam)) : !s.endedAt, '過去問の採点結果が不正です。');
  };
  for (const [g,s] of Object.entries(value.active)) { requireThat(['2','3'].includes(g) && s.grade===g, '過去問の保存先の級が不正です。'); validate(s); }
  value.results.forEach(s => validate(s,true));
  requireThat(new Set(value.results.map(s=>s.id)).size === value.results.length, '過去問の結果が重複しています。');
  return structuredClone(value);
}
export function loadPastState(storage, data) {
  const raw = storage?.getItem(PAST_KEY); return raw ? validatePastState(JSON.parse(raw),data) : emptyPastState();
}
const esc = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPastUI({data,storage,main,getGrade,go,render,showNotice,confirmAction,download}) {
  let state, protectedData = false, conflict = false, latest = null, selectedExam = {}, selectedMode = {}, zoom = false;
  try { state = loadPastState(storage,data); } catch { state = emptyPastState(); protectedData = true; }
  function writable() { if(protectedData || conflict) { showNotice(protectedData ? '過去問の保存データを保護しています。先に元データを書き出してください。' : '別のタブで過去問の保存が変更されました。再読み込みしてください。',true); return false; } return true; }
  function persist() { try {storage.setItem(PAST_KEY,JSON.stringify(validatePastState(state,data)));} catch {showNotice('過去問の保存に失敗しました。ページを開いている間は保持します。過去問のバックアップを書き出してください。',true);} }
  const active = () => state.active[getGrade()];
  const examFor = s => data.exams.find(e=>e.id===s?.examId);
  function finish() { const s=active(),exam=examFor(s); if(!s || !writable()) return; const result=finishPast(s,exam); if(result) { state.results.unshift(result); state.results=state.results.slice(0,50); delete state.active[getGrade()];latest=result;persist();go('past-result'); } }
  function source(exam) { return `<details class="sources"><summary>出典・加工内容</summary><p>${esc(exam.sourceTitle)}<br>法令基準日：${esc(exam.lawBasisDate)}</p><p>${esc(exam.processing)}</p><a href="${esc(exam.sourceUrl)}" target="_blank" rel="noopener noreferrer">${exam.answerUrl?'公式の問題を確認':'公式の問題・正解を確認'} ↗</a>${exam.answerUrl?`<a href="${esc(exam.answerUrl)}" target="_blank" rel="noopener noreferrer">公式の模範解答を確認 ↗</a>`:''}<a href="${esc(exam.questionPdf)}" download>問題のみのPDFを保存</a><a href="${esc(exam.licenseUrl)}" target="_blank" rel="noopener noreferrer">日本FP協会の試験問題利用条件 ↗</a></details>`; }
  function listing() {
    const grade=getGrade(), exams=data.exams.filter(e=>e.grade===grade),s=active(), e=exams.find(e=>e.id===selectedExam[grade])||exams[0];
    if(!e)return '<div class="panel"><h1>この級の過去問は未収録です。</h1></div>';
    return `<div class="narrow"><div class="page-head"><div><p class="eyebrow">公表過去問</p><h1>過去問を解く</h1><p class="subtitle">FP${grade}級・学科。原文の条件で解き、公式の正解で採点します。</p></div></div>
      ${protectedData?'<div class="notice"><p>過去問の保存データを読み込めませんでした。元データを保護し、上書きを停止しています。</p><button class="button secondary" data-action="past-raw">元データを書き出す</button></div>':''}
      ${s?`<div class="bottom-panel"><div><h3>途中の過去問があります</h3><p>${esc(examFor(s).title)} · ${Object.keys(s.answers).length}/60問${s.mode==='mock'?' · 時間は離席中も進みます':''}</p></div><button class="button primary" data-action="past-resume">続きから再開</button></div>`:''}
      <div class="panel"><label for="past-exam-select">公表回を選ぶ</label><select id="past-exam-select">${exams.map(x=>`<option value="${esc(x.id)}" ${e.id===x.id?'selected':''}>${esc(x.title)}</option>`).join('')}</select>
      <p class="disabled-note">全60問・${e.minutes}分／法令基準日：${esc(e.lawBasisDate)}。オリジナル問題の基準日とは異なります。</p><fieldset><legend>解き方</legend><div class="mode-grid"><label class="mode-option"><input type="radio" name="past-mode" value="practice" ${selectedMode[grade]!=='mock'?'checked':''}><span><strong>1問ずつ練習</strong><small>時間制限なし・確定後に正解を確認</small></span></label><label class="mode-option"><input type="radio" name="past-mode" value="mock" ${selectedMode[grade]==='mock'?'checked':''}><span><strong>本番形式</strong><small>制限時間あり・終了後に採点</small></span></label></div></fieldset><button class="button primary" data-action="past-start" ${protectedData||conflict?'disabled':''}>過去問をはじめる</button>${source(e)}</div>
      <div class="section-head"><h2>過去問の成績</h2><button class="text-button" data-action="past-export" ${protectedData?'disabled':''}>過去問のバックアップを保存</button></div><label class="button secondary" for="past-import">過去問のバックアップを復元</label><input id="past-import" type="file" accept="application/json,.json" hidden>
      ${state.results.filter(r=>r.grade===grade).length?state.results.filter(r=>r.grade===grade).map(r=>`<div class="bottom-panel"><div><h3>${esc(examFor(r).title)}</h3><p>${r.mode==='mock'?'本番形式':'1問ずつ練習'} · ${esc(new Date(r.endedAt).toLocaleString('ja-JP'))} · 回答${r.score.answered}問</p></div><button class="button secondary" data-action="past-result" data-id="${esc(r.id)}">${r.score.correct}/60問の結果</button></div>`).join(''):'<p class="small muted" style="margin-top:20px">過去問の結果はここに保存されます。オリジナル問題の成績とは別です。</p>'}</div>`;
  }
  function quiz() {
    const s=active(),exam=examFor(s); if(!exam)return listing();const q=exam.questions[s.index], answer=s.answers[q.number], show=answer && s.mode==='practice';
    return `<div class="narrow"><div class="quiz-header"><div class="quiz-count">過去問 · FP${exam.grade}級 · <strong>${q.number}</strong>/60問</div><div class="quiz-tools"><button class="button secondary memo-toggle" data-action="memo" aria-controls="memo-panel">解答用メモ</button>${s.mode==='mock'?'<span class="timer" id="past-timer" aria-label="過去問の残り時間" role="timer"></span>':''}<button class="text-button" data-action="past-pause">あとで続ける</button></div></div>
      <div class="panel quiz-panel"><div class="question-meta"><span class="badge">${esc(exam.title)}</span><span class="badge">法令基準日 ${esc(exam.lawBasisDate)}</span></div><h1 class="past-title">過去問 第${q.number}問</h1><div class="past-toolbar"><button class="text-button" data-action="past-zoom">${zoom?'全体表示':'原文を拡大'}</button><span class="small muted">${zoom?'横にスクロールできます':''}</span></div>
      ${q.hasDiagram ? '' : `<p class="past-text">${esc(q.text)}</p>`}
      <details class="sources" ${q.hasDiagram||zoom?'open':''}><summary>原文・図表を確認</summary><div class="past-image-window" tabindex="0" aria-label="問題原文・図表"><div class="past-images${zoom?' zoomed':''}">${q.images.map((src,i)=>`<img src="${esc(src)}" alt="FP${exam.grade}級 ${esc(exam.title)} 第${q.number}問の原文と図表${q.images.length>1?'（'+(i+1)+'/'+q.images.length+'）':''}" loading="eager">`).join('')}</div></div></details>
      ${q.hasDiagram?`<details class="sources"><summary>読み取り補助テキスト</summary><p class="past-text">${esc(q.text)}</p><p>図表の配置・空欄の対応は原文画像で確認してください。</p></details>`:''}
      <div class="choices past-choices" role="group" aria-label="回答選択肢">${q.choices.map(c=>`<button class="choice${s.selected===c?' selected':''}${show&&c===q.correct?' correct':''}" data-action="past-choice" data-id="${esc(c)}" aria-pressed="${s.selected===c}" ${show?'disabled':''}><span>${esc(c)}</span></button>`).join('')}</div>
      ${show?`<p class="answer-status${answer!==q.correct?' incorrect':''}" role="status">${answer===q.correct?'正解です。':'不正解です。'} 公式の正解：${esc(q.correct)}／あなたの回答：${esc(answer)}</p>`:''}
      ${s.mode==='mock'&&answer?'<p class="small muted">回答を保存しました。終了前なら選び直して再確定できます。</p>':''}
      <div class="quiz-actions"><span class="small muted">回答済み ${Object.keys(s.answers).length}/60問</span><button class="button primary" data-action="past-submit" ${!s.selected||show?'disabled':''}>回答を確定する</button></div>
      <div class="button-row"><button class="button secondary" data-action="past-prev" ${s.index===0?'disabled':''}>前の問題</button><button class="button secondary" data-action="past-next" ${s.index===59?'disabled':''}>次の問題</button></div>
      <details class="sources"><summary>問題番号を選んで移動</summary><div class="past-number-grid">${exam.questions.map(x=>`<button class="${s.answers[x.number]?'answered':''}" data-action="past-jump" data-index="${x.number-1}" aria-label="第${x.number}問${s.answers[x.number]?'・回答済み':'・未回答'}">${x.number}</button>`).join('')}</div></details>${source(exam)}</div><div class="button-row"><button class="button primary" data-action="past-finish">終了して採点する</button><a href="#past">過去問の一覧へ</a></div></div>`;
  }
  function result() {
    const r=latest?.grade===getGrade()?latest:state.results.find(s=>s.grade===getGrade());if(!r)return listing();const exam=examFor(r),score=r.score;
    return `<div class="narrow"><h1>過去問の結果</h1><p>${esc(exam.title)} · FP${exam.grade}級 · 法令基準日${esc(exam.lawBasisDate)}</p><div class="result-hero"><h2>公式の正解による採点</h2><div class="result-score">${score.correct}<small>/60点</small></div><p>${score.correct>=36?'合格基準36点以上に達しました。':'合格基準は36点以上です。'}${score.answered<60?' 未回答も60問の出題数に含めています。':''}</p></div><p>回答 ${score.answered}問／正解 ${score.correct}問／不正解 ${score.incorrect}問／未回答 ${score.unanswered}問</p>
      <div class="panel"><h2>全問題の振り返り</h2>${exam.questions.map(q=>`<details class="explanation-toggle"><summary>第${q.number}問 · ${!r.answers[q.number]?'未回答':r.answers[q.number]===q.correct?'正解':'不正解'} · 公式の正解 ${esc(q.correct)}</summary><p>あなたの回答：${esc(r.answers[q.number]||'未回答')}</p><div class="past-image-window"><div class="past-images">${q.images.map(src=>`<img src="${esc(src)}" alt="第${q.number}問の原文・図表" loading="lazy">`).join('')}</div></div><p class="past-text">${esc(q.text)}</p></details>`).join('')}</div>${source(exam)}<a class="button primary" href="#past">過去問の一覧へ戻る</a></div>`;
  }
  function tick() { const s=active();if(!s||s.mode!=='mock'||conflict||protectedData)return;if(pastExpired(s)){const dialog=document.querySelector('#confirm-dialog');if(dialog?.open)dialog.close('cancel');finish();showNotice('過去問の制限時間が終了し、確定済みの回答を採点しました。');return;}const el=main.querySelector('#past-timer');if(el){const n=Math.max(0,Math.ceil((s.deadline-Date.now())/1000));el.textContent=`残り ${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;} }
  main.addEventListener('click', async event => {
    const el=event.target.closest('[data-action^="past-"]');if(!el||el.disabled)return; const action=el.dataset.action;
    try{
      if(action==='past-export'){download(JSON.stringify({app:'fp-past-exams',schemaVersion:1,exportedAt:new Date().toISOString(),state},null,2),`fp-past-exams-${new Date().toISOString().slice(0,10)}.json`);return;}
      if(action==='past-raw'){download(storage.getItem(PAST_KEY)||'', 'fp-past-original.txt','text/plain');return;}
      if(action==='past-zoom'){zoom=!zoom;render();return;}
      if(action==='past-result'){latest=state.results.find(s=>s.id===el.dataset.id);go('past-result');return;}
      if(action==='past-pause'){go('past');return;}
      if(!writable())return;tick();
      if(action==='past-resume'){go('past-quiz');return;}
      if(action==='past-start'){
        const grade=getGrade(),old=active();
        if(old && !await confirmAction('途中の過去問があります','新しく始めると現在の過去問を終了して採点します。','採点して新しく開始'))return;
        if(grade!==getGrade()||active()!==old||!writable())return;
        if(old){const done=finishPast(old,examFor(old));if(done)state.results.unshift(done);state.results=state.results.slice(0,50);}
        const exam=data.exams.find(e=>e.id===selectedExam[grade]&&e.grade===grade)||data.exams.find(e=>e.grade===grade);
        state.active[grade]=startPast(exam,selectedMode[grade]||'practice');latest=null;zoom=false;persist();go('past-quiz');return;
      }
      const s=active(),exam=examFor(s);if(!s||!exam)return;
      if(action==='past-finish'){const g=getGrade();if(await confirmAction('過去問を終了しますか？',`確定済み${Object.keys(s.answers).length}問を採点します。未回答も全60問に含めます。`,'終了して採点する')&&g===getGrade()&&active()===s)finish();return;}
      if(action==='past-choice'){s.selected=el.dataset.id;}
      else if(action==='past-submit'){answerPast(s,exam,s.selected);}
      else if(['past-next','past-prev','past-jump'].includes(action)){
        s.index=action==='past-jump'?Number(el.dataset.index):Math.max(0,Math.min(59,s.index+(action==='past-next'?1:-1)));
        s.selected=s.answers[s.index+1]||null;persist();render(true);return;
      }else return;
      persist();render();
    }catch(err){showNotice(err.message,true);}
  });
  main.addEventListener('change',async event=>{
    const el=event.target;
    if(el.id==='past-exam-select'){selectedExam[getGrade()]=el.value;render();return;}
    if(el.name==='past-mode'){selectedMode[getGrade()]=el.value;return;}
    if(el.id!=='past-import'||!el.files?.[0])return;
    const file=el.files[0];el.value='';
    try{
      if(conflict){writable();return;}requireThat(file.size<=20*1024*1024,'過去問バックアップは20MB以下にしてください。');
      const parsed=JSON.parse(await file.text());requireThat(parsed?.app==='fp-past-exams'&&parsed.schemaVersion===1&&date(parsed.exportedAt),'過去問のバックアップではありません。');
      const restored=validatePastState(parsed.state,data);
      if(!await confirmAction('過去問の履歴を復元しますか？','両級の過去問の成績と途中保存を置き換えます。オリジナル問題の履歴は変更しません。','過去問の履歴を復元'))return;
      if(conflict){writable();return;}storage.setItem(PAST_KEY,JSON.stringify(restored));state=restored;protectedData=false;latest=null;showNotice('過去問の履歴を復元しました。');render();
    }catch(err){showNotice('過去問の復元を中止しました：'+err.message,true);}
  });
  window.addEventListener('storage',event=>{if(event.key===PAST_KEY||event.key===null){conflict=true;showNotice('別のタブで過去問の保存が変更されました。上書きを防ぐため再読み込みしてください。',true);}});
  return {view:page=>page==='past-quiz'?quiz():page==='past-result'?result():listing(),tick,hasActive:()=>Object.keys(state.active).length>0};
}

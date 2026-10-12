export const APP_VERSION = '1.5.0';
export const APP_RELEASE = 'v1.5.0-8712c12c0cf9';
export function createUpdateManager({serviceWorker,online,visible,canReload,reload,onState,onCoreReady,onContent,fetchVersion,windowEvents,documentEvents,channelFactory=()=>new MessageChannel(),setTimer=setTimeout,clearTimer=clearTimeout,timeout=20000}) {
  let registration,checking=null,starting=null,waiting=null,requested=false,needsReload=false,reloaded=false,hadController=!!serviceWorker?.controller,applyTimer;
  let state={phase:'idle',message:'最新版はまだ確認していません。',checkedAt:null},downloadBusy=false;
  const watched=new WeakSet();
  const friendly = error => /^(通信が時間内|公開版情報|この起動方法)/.test(error?.message||'') ? error.message : '通信・公開ファイルを確認して「最新版を確認」を再試行してください。';
  function emit(phase,message,extra={}) { state={...state,phase,message,...extra};onState({...state,canApply:!!waiting||needsReload,busy:!!checking||phase==='checking'||phase==='installing'||phase==='activating'}); }
  function limit(promise) {
    return new Promise((resolve,reject)=>{const timer=setTimer(()=>reject(new Error('通信が時間内に完了しませんでした。')),timeout);Promise.resolve(promise).then(resolve,reject).finally(()=>clearTimer(timer));});
  }
  function showWaiting(worker) { waiting=worker;emit('waiting','最新版のインストールが完了しました。学習終了後に「更新する」を押してください。'); }
  function watch(worker) {
    if (!worker||watched.has(worker))return;watched.add(worker);
    let timer;
    function inspect() {
      if(worker.state==='installing') {
        emit('installing','最新版の必須ファイルを取得しています。学習は続けられます。');
        if(!timer)timer=setTimer(()=>emit('failed','新版のインストールが時間内に完了しませんでした。通信や空き容量を確認して「最新版を確認」を再試行してください。'),timeout*2);
      } else {
        clearTimer(timer);timer=null;
        if(worker.state==='installed') {
          if(registration?.waiting)showWaiting(registration.waiting);
          else if(hadController&&registration?.active!==worker)showWaiting(worker);
        } else if(worker.state==='redundant') emit('failed','最新版のインストールに失敗しました。旧版で学習を続けられます。通信・公開ファイル・空き容量を確認して再試行してください。');
        else if(worker.state==='activated') {onCoreReady(true);if(waiting===worker)waiting=null;if(!requested&&!needsReload)emit('current','基本問題のオフライン利用準備が完了しました。過去問の図表・PDFは別途保存できます。');}
      }
    }
    worker.addEventListener('statechange',inspect);inspect();
  }
  function attach(reg) { registration=reg;reg.addEventListener('updatefound',()=>watch(reg.installing));watch(reg.installing);if(reg.waiting)showWaiting(reg.waiting);if(reg.active)onCoreReady(true); }
  async function register() {
    if(!serviceWorker)throw new Error('この起動方法ではService Workerを利用できません。HTTPSで開いてください。');
    const reg=await limit(serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}));attach(reg);return reg;
  }
  async function check(reason='manual') {
    if(checking)return checking;
    if(!online()){emit('offline','オフラインのため最新版を確認できません。保存済みの問題で学習を続けられます。');return;}
    emit('checking','最新版を確認しています…');
    checking=(async()=>{
      try {
        if(!registration)await register();
        // 更新確認だけではinstall完了を保証しない。installing／waiting／redundantを別に監視。
        await limit(registration.update());
        const latest=await limit(fetchVersion());
        if(typeof latest?.release!=='string')throw new Error('公開版情報の形式が不正です。');
        state.checkedAt=new Date().toISOString();
        if(needsReload)emit('waiting','新しい版が有効になっています。学習終了後に「更新する」で画面を切り替えてください。');
        else if(registration.waiting)showWaiting(registration.waiting);
        else if(registration.installing){watch(registration.installing);if(registration.installing.state==='installing')emit('installing','最新版の必須ファイルを取得しています。学習は続けられます。');}
        else if(latest.release!==APP_RELEASE)emit('failed','新しい公開版がありますが、更新版のインストールを確認できません。通信・公開ファイルを確認して再試行してください。');
        else if(state.phase!=='failed')emit('current','最新版です。確認日時：'+new Date(state.checkedAt).toLocaleString('ja-JP'));
      } catch(error) {emit('failed','更新確認に失敗しました。'+friendly(error)+' 保存済みの問題と学習履歴はそのまま利用できます。');}
    })().finally(()=>{checking=null;onState({...state,canApply:!!waiting||needsReload,busy:state.phase==='installing'||state.phase==='activating'});});
    return checking;
  }
  function apply() {
    const reason=canReload();if(reason){emit('waiting',reason);return false;}
    if(needsReload){if(!reloaded){reloaded=true;reload();}return true;}
    const worker=registration?.waiting||waiting;
    if(!worker){emit('failed','有効化できる更新版がまだありません。「最新版を確認」を押してください。');return false;}
    requested=true;emit('activating','新版へ切り替えています。学習記録は削除しません。');
    applyTimer=setTimer(()=>{requested=false;emit('failed','新版への切替えを確認できません。再度「最新版を確認」を押してください。');},timeout);
    try {worker.postMessage({type:'ACTIVATE_UPDATE'});return true;}
    catch(error){requested=false;clearTimer(applyTimer);emit('failed','新版への切替えに失敗しました。'+friendly(error));return false;}
  }
  function controllerChanged() {
    onCoreReady(true);
    if(!hadController&&!requested){hadController=true;return;}
    hadController=true;waiting=null;needsReload=true;clearTimer(applyTimer);
    const reason=canReload();
    if(requested&&!reason&&!reloaded){reloaded=true;requested=false;reload();return;}
    requested=false;emit('waiting',reason||'新版が有効になりました。学習終了後に「更新する」で画面を切り替えてください。');
  }
  async function download(examId) {
    if(downloadBusy)return;
    if(!online()){onContent({type:'CONTENT_FAILED',message:'オフライン保存にはオンライン接続が必要です。'});return;}
    if(!registration?.active&&!serviceWorker?.controller){onContent({type:'CONTENT_FAILED',message:'基本ファイルの準備完了後に再試行してください。'});return;}
    downloadBusy=true;
    return new Promise(resolve=>{
      const channel=channelFactory();let timer;
      const done=data=>{clearTimer(timer);channel.port1.close();downloadBusy=false;onContent(data);resolve(data);};
      const arm=()=>{clearTimer(timer);timer=setTimer(()=>done({type:'CONTENT_FAILED',message:'追加コンテンツの保存応答を確認できません。通信を確認し、同じ回で再試行してください。保存済み分は再利用します。'}),timeout*2);};
      channel.port1.onmessage=event=>{arm();const data=event.data;if(data.type==='CONTENT_PROGRESS')onContent(data);else if(['CONTENT_DONE','CONTENT_FAILED'].includes(data.type))done(data);};
      arm();try{(serviceWorker.controller||registration.active).postMessage({type:'CACHE_CONTENT',examId},[channel.port2]);}catch(error){done({type:'CONTENT_FAILED',message:friendly(error)});}
    });
  }
  async function start() {
    if(starting)return starting;
    serviceWorker?.addEventListener('controllerchange',controllerChanged);
    serviceWorker?.addEventListener('message',event=>{if(event.source===serviceWorker.controller&&event.data?.type==='CONTENT_ERROR')onContent(event.data);});
    documentEvents.addEventListener('visibilitychange',()=>{if(visible())void check('resume');});
    windowEvents.addEventListener('pageshow',()=>{if(visible())void check('pageshow');});
    windowEvents.addEventListener('online',()=>{if(visible())void check('online');});
    if(serviceWorker?.controller)onCoreReady(true);
    starting=check('startup');return starting;
  }
  return {start,check,apply,download,get state(){return {...state};},get activating(){return requested;},get downloadBusy(){return downloadBusy;}};
}

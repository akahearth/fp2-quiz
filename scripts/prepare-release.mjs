import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=n=>readFileSync(new URL(n,root),'utf8'),write=(n,t)=>writeFileSync(new URL(n,root),t);
const pkg=JSON.parse(read('package.json')),past=JSON.parse(read('past-exams.json'));
const base=['index.html','style.css','app.js','core.js','grades.js','memo.js','pwa.js','past.js','questions.json','questions-fp3.json','past-exams.json','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
const references=['AUDIT.md','AUDIT.json','SOURCES.md','AUDIT-FP3.md','AUDIT-FP3.json','SOURCES-FP3.md','PAST-EXAMS.md','REVISION.md','REVISION.json'];
const groups=new Map(past.exams.flatMap(e=>[e.questionPdf,...e.questions.flatMap(q=>q.images)].map(p=>[p.slice(2),e.id])));
references.forEach(p=>groups.set(p,'reference'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assets=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([file,group])=>({url:'./'+file,group,sha256:hash(readFileSync(new URL(file,root))),bytes:statSync(new URL(file,root)).size}));
let module=read('pwa.js').replace(/export const APP_VERSION = '[^']+';/,"export const APP_VERSION = '"+pkg.version+"';");
const sw=read('sw.js');
const digest=createHash('sha256');
for(const file of base){digest.update(file);digest.update(file==='pwa.js'?module.replace(/APP_RELEASE = '[^']+';/,"APP_RELEASE = '__RELEASE__';"):readFileSync(new URL(file,root)));}
digest.update(sw.replace(/const CACHE_VERSION = '[^']+';/,"const CACHE_VERSION = '__RELEASE__';"));digest.update(JSON.stringify(assets));
const release='v'+pkg.version+'-'+digest.digest('hex').slice(0,12);

const generated={
  'pwa.js':module.replace(/export const APP_RELEASE = '[^']+';/,"export const APP_RELEASE = '"+release+"';"),
  'sw.js':sw.replace(/const CACHE_VERSION = '[^']+';/,"const CACHE_VERSION = '"+release+"';"),
  'version.json':JSON.stringify({release,appVersion:pkg.version},null,2)+'\n',
  'content-manifest.json':JSON.stringify({schemaVersion:1,release,assets},null,2)+'\n'
};
const stale=Object.entries(generated).filter(([file,content])=>read(file)!==content).map(([file])=>file);
if(process.argv.includes('--check')) {
  if(stale.length){console.error('公開準備が未完了です。node scripts/prepare-release.mjs を実行してください。対象: '+stale.join(', '));process.exitCode=1;}
  else console.log('公開版と内容ハッシュが一致しています: '+release);
} else {
  for(const [file,content] of Object.entries(generated))write(file,content);
  console.log(JSON.stringify({release,coreFiles:17,optionalFiles:assets.length}));
}

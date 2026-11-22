import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {TextEncoder} from 'node:util';
process.env.TZ='Asia/Taipei';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({Date,TextEncoder});
for(const [,id,code] of html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g))new vm.Script(code,{filename:id});
vm.runInContext(html.match(/<script id="study-core">([\s\S]*?)<\/script>/)[1]+'\nthis.core=StudyCore;',context);
const C=context.core;
const copy=x=>JSON.parse(JSON.stringify(x));
const fixture=()=>{const d=C.initialData();d.tasks=[
 {id:'a',text:'複習離散數學',subjectId:'math',completed:false,priority:'normal',dueDate:'2026-11-22'},
 {id:'b',text:'資料結構作業',subjectId:'other',completed:false,priority:'high',dueDate:'2026-11-25'},
 {id:'c',text:'英文單字',subjectId:'english',completed:true,priority:'high',dueDate:'2026-11-20'},
 {id:'d',text:'數學練習題',subjectId:'math',completed:false,priority:'low',dueDate:'2026-11-20'}];return d};
const backup=data=>JSON.stringify({app:'study-shiba',backupVersion:1,data});
test('初始資料可完整通過格式檢查',()=>{assert.equal(C.normalize(C.initialData()).invalid,false)});
test('舊版資料升級後保留任務、名稱、時間與成就',()=>{const d=fixture();d.version=2;delete d.settings.dailyGoal;d.tasks.forEach(t=>{delete t.priority;delete t.dueDate});d.petName='豆豆';C.addFocus(d,0,60000,'math');C.unlockEligible(d,123);const n=C.normalize(d);assert.equal(n.invalid,false);assert.equal(n.data.version,3);assert.equal(n.data.tasks.length,4);assert.equal(n.data.petName,'豆豆');assert.equal(n.data.settings.dailyGoal,60);assert.equal(n.data.tasks[0].priority,'normal');assert.equal(C.totalMs(n.data),60000);assert.equal(n.data.achievements['first-step'].unlockedAt,123)});
test('空任務進度為 0，完成及刪除不產生負數點心',()=>{const d=C.initialData();assert.equal(C.taskSummary(d).percent,0);d.tasks=fixture().tasks.slice(0,3);assert.equal(C.taskSummary(d).percent,33);assert.equal(C.taskSummary(d).snacks,1);d.tasks=d.tasks.filter(t=>!t.completed);assert.equal(C.taskSummary(d).snacks,0)});
test('首次成就保留，重複勾選不會重複解鎖',()=>{const d=fixture();assert.equal(C.unlockEligible(d,10).length,1);d.tasks.forEach(t=>t.completed=false);assert.equal(C.unlockEligible(d,20).length,0);assert.equal(d.achievements['first-step'].unlockedAt,10)});
test('時間成就的前一毫秒未解鎖，到達門檻才解鎖',()=>{const d=C.initialData();C.addFocus(d,0,599999,'math');assert.equal(C.unlockEligible(d,0).length,0);C.addFocus(d,599999,600000,'math');assert.equal(C.unlockEligible(d,1)[0].id,'warm-up');assert.equal(C.unlockEligible(d,2).length,0)});
test('分鐘與目標的邊界驗證',()=>{for(const v of ['',0,61,1.2,'x'])assert.equal(C.minutesValid(v),false);for(const v of [1,25,60])assert.equal(C.minutesValid(v),true);for(const v of ['',4,481,5.1])assert.equal(C.goalValid(v),false);for(const v of [5,60,480])assert.equal(C.goalValid(v),true)});
test('科目去空白、不分英文大小寫判斷重複',()=>{assert.match(C.subjectError(' Math ',[{id:'m',name:'math'}]),/存在/);assert.match(C.subjectError('   ',[]),/輸入/);assert.match(C.subjectError('全部',[]),/其他/)});
test('建議排序：未完成優先，再依優先順序及日期',()=>{const d=fixture(),before=JSON.stringify(d);assert.deepEqual(copy(C.visibleTasks(d,{sort:'plan'})).map(t=>t.id),['b','a','d','c']);assert.equal(JSON.stringify(d),before)});
test('截止日排序與新增排序分別符合規格',()=>{const d=fixture();assert.deepEqual(copy(C.visibleTasks(d,{sort:'due'})).map(t=>t.id),['d','a','b','c']);assert.deepEqual(copy(C.visibleTasks(d,{sort:'added'})).map(t=>t.id),['a','b','c','d'])});
test('搜尋、科目與狀態條件可以交集使用，不更改總進度',()=>{const d=fixture(),before=C.taskSummary(d).percent;const list=C.visibleTasks(d,{subjectId:'math',query:'練習',status:'pending'});assert.equal(list.length,1);assert.equal(list[0].id,'d');assert.equal(C.taskSummary(d).percent,before)});
test('逾期排除已完成任務，今天截止不算逾期',()=>{const d=fixture();assert.equal(C.dueState(d.tasks[0],'2026-11-22'),'today');assert.deepEqual(copy(C.visibleTasks(d,{status:'overdue',today:'2026-11-22'})).map(t=>t.id),['d'])});
test('倒數連按開始只有一輪，上限不超過設定時間',()=>{const t=new C.Timer(1,'math');assert.equal(t.start(100),true);assert.equal(t.start(200),false);const r=t.tick(900100);assert.equal(r.interval.endMs-r.interval.startMs,60000);assert.equal(r.ended,'focus');assert.equal(t.remainingMs,0);assert.equal(t.tick(1000100).interval,null)});
test('暫停等待不累積，繼續只算恢復後時間',()=>{const t=new C.Timer(1,'math');t.start(0);assert.equal(t.tick(10000).interval.endMs,10000);t.pause();assert.equal(t.tick(90000).interval,null);t.resume(100000);const r=t.tick(105000);assert.equal(r.interval.startMs,100000);assert.equal(t.remainingMs,45000)});
test('重設保留已記錄時間，休息不計入專注',()=>{const d=C.initialData(),t=new C.Timer(1,'math');t.start(0);const r=t.tick(10000);C.addFocus(d,r.interval.startMs,r.interval.endMs,r.interval.subjectId);t.reset();assert.equal(C.totalMs(d),10000);assert.equal(t.remainingMs,60000);t.start(20000);t.tick(80000);assert.equal(t.startRest(80000),true);assert.equal(t.tick(380000).interval,null);assert.equal(t.status,'finished');assert.equal(t.backToFocus(),true);assert.equal(t.status,'idle')});
test('系統時間倒退不增加時間也不延長本輪',()=>{const t=new C.Timer(1,'math');t.start(10000);assert.equal(t.tick(5000).interval,null);assert.equal(t.remainingMs,60000);assert.equal(t.tick(20000).interval.startMs,10000);assert.equal(t.remainingMs,50000)});
test('跨午夜將秒數分給兩個本地日期',()=>{const d=C.initialData(),start=new Date(2026,10,21,23,59,30).getTime();C.addFocus(d,start,start+90000,'math');assert.equal(C.totalMs(d,'2026-11-21'),30000);assert.equal(C.totalMs(d,'2026-11-22'),60000);assert.equal(C.totalMs(d),90000)});
test('分次累積毫秒不會因四捨五入遺失',()=>{const d=C.initialData();for(let i=0;i<10;i++)C.addFocus(d,i*250,(i+1)*250,'math');assert.equal(C.totalMs(d),2500)});
test('近七天跨月，排除範圍外資料，保留零紀錄日',()=>{const d=C.initialData(),now=new Date(2026,10,3,12).getTime();C.addFocus(d,new Date(2026,9,27,12).getTime(),new Date(2026,9,27,12,30).getTime(),'math');C.addFocus(d,now-1000,now,'math');const w=C.weekStats(d,now);assert.equal(w.length,7);assert.equal(w[0].date,'2026-10-28');assert.equal(w[6].date,'2026-11-03');assert.equal(w.reduce((a,b)=>a+b.ms,0),1000)});
test('完整備份匯出再讀取保留資料，使用新物件',()=>{const d=fixture();C.addFocus(d,0,123456,'math');C.unlockEligible(d,100);const next=C.parseBackup(backup(d));assert.deepEqual(copy(next),copy(d));assert.notEqual(next,d)});
test('拒絕錯誤 JSON、其他應用、未來版本與不完整內容',()=>{for(const str of ['{','{}',JSON.stringify({app:'other',backupVersion:1,data:fixture()}),JSON.stringify({app:'study-shiba',backupVersion:2,data:fixture()}),backup({version:3})])assert.throws(()=>C.parseBackup(str))});
test('拒絕無效日期、重複識別碼、負數時間與無效優先順序',()=>{for(const alter of [d=>d.tasks[0].dueDate='2026-02-30',d=>d.tasks[1].id=d.tasks[0].id,d=>d.focusRecords.push({date:'2026-11-22',subjectId:'math',seconds:-1,remainderMs:0}),d=>d.tasks[0].priority='urgent',d=>d.settings.dailyGoal=0]){const d=fixture();alter(d);assert.throws(()=>C.parseBackup(backup(d)))}});
test('拒絕超過 2 MB 的備份',()=>{assert.throws(()=>C.parseBackup('a'.repeat(2097153)),/2 MB/)});
test('備份內容以文字保留，不把任務解讀為 HTML',()=>{const d=fixture();d.tasks[0].text='<img src=x onerror=alert(1)>';assert.equal(C.parseBackup(backup(d)).tasks[0].text,d.tasks[0].text)});

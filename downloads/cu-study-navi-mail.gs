(function(root) {
  const normalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').trim();
  function week(now = new Date()) {
    const shifted = new Date(now.getTime() + 9 * 3600000);
    const day = shifted.getUTCDay();
    let back = (day + 3) % 7;
    if (back === 0 && shifted.getUTCHours() < 12) back = 7;
    shifted.setUTCDate(shifted.getUTCDate() - back);
    shifted.setUTCHours(12, 0, 0, 0);
    const start = shifted.getTime() - 9 * 3600000;
    return {start, end: start + 7 * 86400000};
  }
  function dateValue(text, termStart, termEnd) {
    const m = String(text || '').match(/(?:(\d{4})[\/年-])?(\d{1,2})[\/月-](\d{1,2})/);
    if (!m || !termStart || !termEnd) return null;
    const years = m[1] ? [+m[1]] : [...new Set([+termStart.slice(0,4), +termEnd.slice(0,4)])];
    const candidates = years.map(y => `${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`)
      .filter(d => { const parsed=new Date(d+'T00:00:00Z'); return d >= termStart && d <= termEnd && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === d; });
    return candidates.length === 1 ? candidates[0] : null;
  }
  function parseManual(text) {
    const normalized = text.normalize('NFKC').replace(/第\s*(\d+)\s*回/g, '第$1回');
    const chunks = [...normalized.matchAll(/(?:^|\n)\s*第(\d{1,2})回[^\S\n]*(.*?)(?=\n\s*第\d{1,2}回|$)/gs)];
    const seen = new Set();
    return chunks.map(m => {
      const number = +m[1];
      if (number < 1 || number > 99 || seen.has(number)) throw new Error('授業回の重複・範囲を確認してください。');
      seen.add(number);
      const body = m[2].trim();
      const title = body.split('\n').find(x => x.trim()) || `第${number}回`;
      const tasks = [...new Set(body.match(/小テスト|レポート|ディベート/g) || [])];
      return {number, title: title.slice(0,200), description: body, tasks};
    });
  }
  function classify(lesson, dates, now = new Date()) {
    const w = week(now), today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(now);
    const start = dateValue(lesson.start, dates.start, dates.end);
    const end = dateValue(lesson.end, dates.start, dates.end);
    const weekStart = new Date(w.start + 9*3600000).toISOString().slice(0,10);
    const weekEnd = new Date(w.end + 9*3600000).toISOString().slice(0,10);
    if (lesson.status === '完了') return '完了';
    if (end && end < today) return '期限経過・状況確認';
    if (end && end >= weekStart && end <= weekEnd) return '今週の期限';
    if (start && start > today) return '公開予定';
    return '受講状況を確認';
  }
  function cleanText(value) {
    return String(value || '').replace(/\r/g,'').split('\n').map(x=>x.replace(/[ \t\u00a0\u3000]+/g,' ').trim()).filter(Boolean).join('\n');
  }
  function overallStatus(lesson, info) {
    if (lesson.manualStatus) return lesson.status;
    if (!info || lesson.number === 'final') return '未確認';
    const required=['講義', ...info.tasks.map(t=>t==='小テスト'?'テスト':t)];
    const states=required.map(k=>lesson.states?.[k] || '未確認');
    if(states.every(s=>s==='完了')) {
      // A completed lecture is not enough when an additional observed activity remains.
      const extra=Object.values(lesson.states || {}).filter(s=>s!=='空欄' && s!=='未確認');
      if(extra.some(s=>s!=='完了')) return '進行中';
      return '完了';
    }
    if(states.includes('進行中') || states.includes('完了')) return '進行中';
    return '未確認';
  }
  const api = {normalize, week, dateValue, parseManual, classify, cleanText, overallStatus};
  root.CUCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);


(function(root){
 const C=root.CUCore || require('./core.js');
 const iso=t=>new Date(t).toISOString().slice(0,10);
 function nextWindow(now=new Date()){
  const j=new Date(now.getTime()+9*3600000);let days=(3-j.getUTCDay()+7)%7;
  if(days===0&&j.getUTCHours()>=18)days=7;
  j.setUTCDate(j.getUTCDate()+days);j.setUTCHours(18,0,0,0);
  const send=j.getTime()-9*3600000;
  const start=iso(j.getTime()+86400000);
  return {send,start,end:iso(Date.parse(start)+7*86400000)};
 }
 function mode(course,guide){
  const dates=course.lessons.filter(l=>typeof l.number==='number').map(l=>C.dateValue(l.start,guide.start,guide.end));
  if(!dates.length||dates.some(x=>!x))return 'unknown';
  return new Set(dates).size===1?'batch':'weekly';
 }
 function brief(info){
  if(!info)return 'シラバス未登録';
  const clean=C.cleanText(info.description);
  const goals=clean.split(/2\)学習目標[：:]/)[1]?.split(/3\)目次[：:]/)[0];
  return (goals||clean).split('\n').filter(x=>x&&!/^第\d+回|^課題[：:]/.test(x)).slice(0,3).join('\n');
 }
 function build(guide,window){
  const rows=[],warnings=[],references=[];
  for(const c of guide.courses){
   if(mode(c,guide)!=='weekly')continue;
   for(const l of c.lessons){const start=C.dateValue(l.start,guide.start,guide.end);if(typeof l.number==='number'&&start>=window.start&&start<window.end)references.push(l.number);}
  }
  const nums=[...new Set(references)];
  const base=nums.length===1?nums[0]:null;
  if(!nums.length)warnings.push('対象週に毎週公開科目の公開予定がないため、一括公開科目の次の回は選んでいません。');
  if(nums.length>1)warnings.push('毎週公開科目の授業回が一致しないため、一括公開科目の標準回は未確定です。');
  for(const c of guide.courses){
   const type=mode(c,guide),ordered=c.lessons.filter(l=>typeof l.number==='number').sort((a,b)=>a.number-b.number);
   let targets=[];
   if(type==='weekly')targets=ordered.filter(l=>{const d=C.dateValue(l.start,guide.start,guide.end);return d>=window.start&&d<window.end;});
   else if(type==='batch'&&base){
    let frontier=0;
    for(const l of ordered){if(l.number!==frontier+1)break;const info=c.syllabus?.lessons.find(i=>i.number===l.number);if(l.states?.講義==='完了'||C.overallStatus(l,info)==='完了')frontier=l.number;else break;}
    const candidate=ordered.find(l=>l.number===Math.max(base,frontier+1));
    if(candidate&&C.dateValue(candidate.start,guide.start,guide.end)<window.end)targets=[candidate];
   }else if(type==='unknown')warnings.push(`${c.name}：公開日を確認できません。`);
   const pending=[];
   for(const l of ordered){
    if(targets.includes(l))continue;
    const info=c.syllabus?.lessons.find(i=>i.number===l.number);
    const before=base?l.number<base:C.dateValue(l.start,guide.start,guide.end)<window.start;
    if(!before&&l.states?.講義!=='完了')continue;
    if(C.overallStatus(l,info)==='完了')continue;
    const tasks=info?.tasks?.filter(t=>l.states?.[t==='小テスト'?'テスト':t]!=='完了')||[];
    pending.push(`第${l.number}回：${l.states?.講義==='完了'?'講義完了／':''}${tasks.length?tasks.join('・')+'の状況確認':'受講・課題の状況確認'}（終了 ${l.end||'未確認'}）`);
   }
   const items=targets.filter(l=>C.overallStatus(l,c.syllabus?.lessons.find(i=>i.number===l.number))!=='完了').map(l=>{
    const info=c.syllabus?.lessons.find(i=>i.number===l.number),prev=c.syllabus?.lessons.find(i=>i.number===l.number-1);
    return {number:l.number,title:info?.title||'内容未登録',start:l.start,end:l.end,tasks:info?.tasks||[],previous:brief(prev),current:brief(info),connection:prev&&info?`${prev.title} → ${info.title}`:'シラバスを登録すると前回と今回を対比できます。'};
   });
   rows.push({name:c.name,type,items,pending});
  }
  const subject=`▶▶ Study Navi ▶▶ ${window.start.slice(5).replace('-','/')}〜 学習ガイド`;
  const updated=Number.isFinite(Date.parse(guide.updated))?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date(guide.updated))+'（日本時間）':'取得日時不明';
  const parts=[`Study Navi｜${window.start.slice(5).replace('-','/')}〜 学習ガイド`,`進捗：${updated} 時点`, '最新の情報はCloud Campusにて確認してください。提出状況と締切期日もCloud Campusでご確認ください。','', '【今週やること】'];
  for(const r of rows)parts.push(`• ${r.name}：${r.items.map(i=>'第'+i.number+'回 '+i.title).join(' ／ ')||'今回の案内対象なし'}`);
  for(const r of rows){
   parts.push('','━━━━━━━━━━━━━━━━━━━━',`【${r.name}】`,'━━━━━━━━━━━━━━━━━━━━','');
   for(const i of r.items)parts.push(`第${i.number}回 ${i.title}`,`公開 ${i.start} ／ 終了 ${i.end}`,`課題：${i.tasks.join('・')||'未確認'}`,'','── 前回の要点 ──','（シラバスから抜粋）',i.previous,'','── 今回の内容 ──','（シラバスから抜粋）',i.current,'','── 前回 → 今回 ──','（テーマの対比）',i.connection,'');
   if(r.pending.length)parts.push('','── 状況を確認する授業・課題 ──',...r.pending);
  }
  if(warnings.length)parts.push('','【確認事項】',...warnings);
  parts.push('','進捗・授業：https://ccampus.org/learners/attendProgress','配信停止は拡張機能の「週次メール」から行えます。');
  return {subject,text:parts.join('\n'),html:emailHTML(parts),rows,warnings,window};
 }
 function emailHTML(parts){
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const body=parts.map((line,index)=>{
   if(line.startsWith('• ')){
    const split=line.indexOf('：');
    const name=split<0?line.slice(2):line.slice(2,split),detail=split<0?'':line.slice(split+1).trim();
    const start=index===0||!parts[index-1].startsWith('• '),end=index===parts.length-1||!parts[index+1].startsWith('• ');
    return (start?'<ul style="margin:0;padding-left:24px">':'')+`<li style="margin:0 0 8px;padding-left:4px;line-height:1.7;overflow-wrap:anywhere"><strong>${escape(name)}</strong>：<span>${escape(detail)}</span></li>`+(end?'</ul>':'');
   }
   if(line==='━━━━━━━━━━━━━━━━━━━━')return '';
   if(!line)return '<div style="height:12px"></div>';
   if(index===0)return `<h1 style="font-size:22px;line-height:1.5;margin:0 0 20px;color:#173f35">${escape(line)}</h1>`;
   if(/^【.*】$/.test(line))return `<h2 style="font-size:19px;margin:28px 0 16px;padding:12px 0;border-top:3px solid #24664f;border-bottom:1px solid #dce5de;color:#173f35">${escape(line.slice(1,-1))}</h2>`;
   if(/^── .* ──$/.test(line))return `<h3 style="font-size:16px;margin:18px 0 10px;padding:9px 12px;background:#edf4f0;border-left:4px solid #24664f">${escape(line.slice(3,-3))}</h3>`;
   if(line.startsWith('（'))return `<p style="font-size:12px;color:#64756d;margin:0 0 8px">${escape(line)}</p>`;
   return `<p style="margin:0 0 8px;line-height:1.85;overflow-wrap:anywhere">${escape(line).replace(/\n/g,'<br>')}</p>`;
  }).join('');
  return `<html lang="ja"><body style="margin:0;padding:20px;background:#fff;color:#20332e;font:15px sans-serif"><div style="max-width:680px;margin:auto">${body}</div></body></html>`;
 }
 // Explicit whitelist: no notes, login data, account identifiers or page HTML.
 function snapshot(g){return {term:g.term,start:g.start,end:g.end,updated:g.updated,courses:g.courses.map(c=>({name:c.name,lessons:c.lessons.map(l=>({number:l.number,start:l.start,end:l.end,states:l.states,status:l.status,manualStatus:!!l.manualStatus})),syllabus:c.syllabus?{lessons:c.syllabus.lessons.map(i=>({number:i.number,title:i.title,description:i.description,tasks:i.tasks}))}:null}))};}
 const api={nextWindow,mode,brief,build,snapshot};root.CUDigest=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);


// Each student owns a separate, unshared project. No third-party service calls.
function setup() {
  const p=PropertiesService.getScriptProperties();
  if(!/^[a-f0-9]{64}$/.test(p.getProperty('SYNC_TOKEN')||''))throw new Error('プロジェクト設定のスクリプトプロパティに、拡張で作ったSYNC_TOKENを保存してください。');
  if(!p.getProperty('DATA_FILE_ID')){
    const folder=DriveApp.createFolder('CU 週次案内（個人用）');
    const file=folder.createFile('progress.json',JSON.stringify({enabled:false}),MimeType.PLAIN_TEXT);
    p.setProperties({DATA_FILE_ID:file.getId(),DATA_FOLDER_ID:folder.getId()});
  }
  const existing=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sendWeekly');
  if(!existing.length)ScriptApp.newTrigger('sendWeekly').timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(18).nearMinute(0).everyWeeks(1).inTimezone('Asia/Tokyo').create();
  console.log('初期設定完了。週次配信は拡張から有効にするまで停止中です。');
}
function doGet(){
  const endpoint=JSON.stringify(ScriptApp.getService().getUrl()).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>CU データ更新</title>
  <style>body{font:18px sans-serif;max-width:640px;margin:60px auto;padding:24px;color:#173f35}p{line-height:1.8}</style>
  <h1>CU データ更新</h1><p id="status">拡張機能からの更新を待っています。この画面は開いたままにしてください。</p>
  <script>
  window.CU_SYNC_ENDPOINT=${endpoint};
  window.CU_SYNC_VERSION=1;
  window.cuSyncFromExtension=function(payload){
    document.getElementById('status').textContent='データを保存しています…';
    return new Promise(function(resolve){
      google.script.run.withSuccessHandler(function(result){
        document.getElementById('status').textContent=result.ok?'保存しました。このタブは閉じて構いません。':'保存できません：'+result.error;
        resolve(result);
      }).withFailureHandler(function(error){
        document.getElementById('status').textContent='保存できません：'+error.message;
        resolve({ok:false,error:error.message});
      }).syncFromExtension(payload);
    });
  };
  </script></html>`).setTitle('CU データ更新');
}
// Same token validation and data validation as the POST endpoint; never sends email.
function syncFromExtension(payload){
  return JSON.parse(doPost({postData:{contents:JSON.stringify(payload)}}).getContent());
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function validToken_(supplied,expected){
  if(typeof supplied!=='string'||!expected||supplied.length!==64||expected.length!==64)return false;
  let diff=0;for(let i=0;i<64;i++)diff|=supplied.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
}
function validate_(g){
  if(!g||typeof g.term!=='string'||g.term.length>100||!Array.isArray(g.courses)||g.courses.length>50)throw new Error('進捗データの形式を確認してください。');
  for(const k of ['start','end'])if(!/^\d{4}-\d{2}-\d{2}$/.test(g[k])||!Number.isFinite(Date.parse(g[k])))throw new Error('学期日程が不正です。');
  if(g.start>=g.end||Date.parse(g.end)-Date.parse(g.start)>366*86400000)throw new Error('学期期間が不正です。');
  if(!Number.isFinite(Date.parse(g.updated)))throw new Error('取得日時が不正です。');
  const check=(v,n)=>{if(typeof v!=='string'||v.length>n)throw new Error('データ量または形式が不正です。');};
  for(const c of g.courses){
    check(c.name,200);if(!Array.isArray(c.lessons)||c.lessons.length>100)throw new Error('授業回が不正です。');
    for(const l of c.lessons){if(l.number!=='final'&&(!Number.isInteger(l.number)||l.number<1||l.number>99))throw new Error('授業回が不正です。');check(l.start,30);check(l.end,30);}
    if(c.syllabus){if(!Array.isArray(c.syllabus.lessons)||c.syllabus.lessons.length>100)throw new Error('シラバスが不正です。');for(const i of c.syllabus.lessons){check(i.title,500);check(i.description,20000);if(!Array.isArray(i.tasks)||i.tasks.some(t=>!['小テスト','レポート','ディベート'].includes(t)))throw new Error('課題が不正です。');}}
  }
  return CUDigest.snapshot(g);
}
function doPost(e){
  const lock=LockService.getScriptLock();let acquired=false;
  try{
    const raw=e&&e.postData&&e.postData.contents;
    if(!raw||raw.length>1500000)throw new Error('送信データが空か、大きすぎます。');
    const b=JSON.parse(raw),p=PropertiesService.getScriptProperties();
    if(!validToken_(b.token,p.getProperty('SYNC_TOKEN')))return json_({ok:false,error:'接続キーが一致しません。'});
    acquired=lock.tryLock(5000);if(!acquired)throw new Error('配信または同期中です。少し待って再実行してください。');
    const id=p.getProperty('DATA_FILE_ID');if(!id)throw new Error('GASのsetupを先に実行してください。');
    const file=DriveApp.getFileById(id);
    if(b.action==='pause'){const data=JSON.parse(file.getBlob().getDataAsString());data.enabled=false;file.setContent(JSON.stringify(data));return json_({ok:true,enabled:false});}
    if(typeof b.recipient!=='string'||b.recipient.length>254||!/^\S+@[^\s@<>]+\.[^\s@<>]+$/.test(b.recipient)||/[\r\n,;<>]/.test(b.recipient))throw new Error('送信先メールアドレスを確認してください。');
    if(typeof b.enabled!=='boolean')throw new Error('配信設定が不正です。');
    const snapshot=validate_(b.snapshot),updated=new Date().toISOString();
    file.setContent(JSON.stringify({snapshot,recipient:b.recipient,enabled:b.enabled,updated}));
    return json_({ok:true,recipient:b.recipient,enabled:b.enabled,updated});
  }catch(error){return json_({ok:false,error:error.message||'処理に失敗しました。'});}
  finally{if(acquired)lock.releaseLock();}
}
function sendWeekly(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('同期中のため配信できませんでした。実行履歴を確認してください。');
  try{
    const p=PropertiesService.getScriptProperties(),id=p.getProperty('DATA_FILE_ID');if(!id)throw new Error('setupを実行してください。');
    const data=JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());if(!data.enabled)return;
    const now=new Date(),j=new Date(now.getTime()+9*3600000);
    // nearMinute(0) may run about 15 minutes either side of 18:00.
    if(j.getUTCDay()!==3)return;
    const start=new Date(Date.UTC(j.getUTCFullYear(),j.getUTCMonth(),j.getUTCDate()+1)).toISOString().slice(0,10);
    const end=new Date(Date.parse(start)+7*86400000).toISOString().slice(0,10);
    if(start>data.snapshot.end||end<=data.snapshot.start)return;
    const key=[data.snapshot.term,data.snapshot.start,start].join('|');
    if(p.getProperty('DELIVERY_KEY')===key)return;
    const digest=CUDigest.build(data.snapshot,{start,end});
    if(MailApp.getRemainingDailyQuota()<1)throw new Error('メール送信上限に達しています。');
    // Claim before send: a crash with uncertain delivery never triggers duplicate mail.
    p.setProperties({DELIVERY_KEY:key,DELIVERY_STATE:'sending'});
    try{MailApp.sendEmail({to:data.recipient,subject:digest.subject,body:digest.text,htmlBody:digest.html,name:'CU Study Navi（非公式）'});p.setProperty('DELIVERY_STATE','sent');}
    catch(error){p.setProperty('DELIVERY_STATE','failed');throw error;}
  }finally{lock.releaseLock();}
}
function sendTestEmail(){
  const p=PropertiesService.getScriptProperties(),id=p.getProperty('DATA_FILE_ID');if(!id)throw new Error('setupを実行してください。');
  const data=JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());if(!data.snapshot||!data.recipient)throw new Error('拡張から同期してください。');
  const digest=CUDigest.build(data.snapshot,CUDigest.nextWindow());
  MailApp.sendEmail({to:data.recipient,subject:'【テスト】'+digest.subject,body:digest.text,htmlBody:digest.html,name:'CU Study Navi（非公式）'});
  console.log('テストメールを送信しました。');
}

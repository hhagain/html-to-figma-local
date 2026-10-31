import type { CaptureBundle } from './bundle';
type Mark = { id: string; name: string; mode: 'viewport'|'long'; selected: boolean; order: number; longAvailable: boolean; longError?: string };
type Session = { id: string; url: string; viewport: {width:number;height:number}; observed: number; options: {collectExtras:boolean;layout:'selection'|'smart'}; marks: Mark[]; selectedIds: string[]; warning?: string; dialog?: {type:string;message:string;defaultValue:string}|null };
type Result = { bundle: CaptureBundle; previewImages: string[]; report: any };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function setupManualCapture(config: {
  plugin: boolean;
  request: (path: string, body?: unknown, timeout?: number) => Promise<any>;
  status: (text: string, error?: boolean) => void;
  changed: () => void;
  edited: () => void;
  prepared: (result: Result) => void;
  openWorkbench: (request: any) => void;
}) {
  let session: Session|null=null, timer: ReturnType<typeof setTimeout>|null=null, live=false, pending=false, disposed=false;
  let events=Promise.resolve(), signature='', fit=true, scale=1, dragging=false, lastMove=0, composing=false;
  const extras=$<HTMLInputElement>('manual-extras'),layout=$<HTMLSelectElement>('manual-layout');
  try { const saved=JSON.parse(localStorage.getItem('h2f-manual-options')||'null');if(typeof saved?.collectExtras==='boolean')extras.checked=saved.collectExtras;if(['selection','smart'].includes(saved?.layout))layout.value=saved.layout; } catch {}
  const options=()=>({collectExtras:extras.checked,layout:layout.value as 'selection'|'smart'});
  const tell=(text:string,error=false)=>{$('manual-browser-status').textContent=text;config.status(text,error);};
  const request=(action:string,body?:unknown,timeout=60000)=>config.request(`/api/manual/${session!.id}/${action}`,body,timeout);
  function zoom() {
    if(!session)return;const host=$('manual-viewport'),surface=$('manual-surface');
    if(fit)scale=Math.max(.1,Math.min(1,(host.clientWidth-26)/session.viewport.width));
    surface.style.width=`${session.viewport.width*scale}px`;surface.style.height=`${session.viewport.height*scale}px`;
    $('manual-fit').setAttribute('aria-pressed',String(fit));$('manual-actual').setAttribute('aria-pressed',String(!fit&&scale===1));
  }
  function showLive(value:boolean) {
    live=value;document.body.classList.toggle('manual-active',value);document.body.classList.toggle('manual-result',!value&&!!session);$('manual-browser').hidden=!value;$('preview-stage').hidden=value;
    $('manual-resume').hidden=!session||value;
    if(value){for(const id of ['preview-controls','preview-zoom-controls','preview-caption','preview-shortcuts'])$(id).hidden=true;zoom();void poll();}
    else if(timer){clearTimeout(timer);timer=null;}
  }
  function render(value:Session) {
    session=value;extras.checked=value.options.collectExtras;layout.value=value.options.layout;
    $('manual-session').hidden=false;$('manual-count').textContent=`${value.selectedIds.length} / ${value.marks.length}`;
    $('manual-location').textContent=value.url;$('manual-location').title=value.url;
    const next=JSON.stringify(value.marks);
    if(signature!==next) {
      signature=next;const rows=value.marks.map(mark=>{
        const row=document.createElement('div');row.className='manual-mark-row';row.dataset.markId=mark.id;row.dataset.selected=String(mark.selected);
        const box=document.createElement('input');box.type='checkbox';box.checked=mark.selected;box.setAttribute('aria-label',`导出 ${mark.name}`);box.addEventListener('change',()=>void update({id:mark.id,selected:box.checked}));
        const order=document.createElement('span');order.className='manual-order';order.textContent=mark.order?String(mark.order).padStart(2,'0'):'—';
        const name=document.createElement('input');name.type='text';name.value=mark.name;name.maxLength=150;name.setAttribute('aria-label',`重命名 ${mark.name}`);name.addEventListener('change',()=>void update({id:mark.id,name:name.value}));
        const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='×';remove.setAttribute('aria-label',`删除标记 ${mark.name}`);remove.addEventListener('click',()=>void update({id:mark.id,remove:true}));
        const scope=document.createElement('select');scope.setAttribute('aria-label',`${mark.name} 的捕获范围`);
        for(const [value,text]of [['viewport','当前页面'],['long','完整长页']]){const option=document.createElement('option');option.value=value;option.textContent=text;option.disabled=value==='long'&&!mark.longAvailable;scope.append(option);}scope.value=mark.mode;scope.addEventListener('change',()=>void update({id:mark.id,mode:scope.value}));
        row.append(box,order,name,remove,scope);if(mark.longError){const note=document.createElement('small');note.textContent=`长页不可用：${mark.longError}`;row.append(note);}return row;
      });$('manual-marks').replaceChildren(...rows);
    }
    $('manual-selection-help').textContent=layout.value==='selection'?'按勾选顺序导出，重新勾选会排到最后。':'按所属页面和功能分组；组件、图标分别集中排版。';
    const dialog=value.dialog;$('manual-dialog').hidden=!dialog;if(dialog){$('manual-dialog-message').textContent=dialog.message;$<HTMLInputElement>('manual-dialog-text').hidden=dialog.type!=='prompt';if(document.activeElement!==$('manual-dialog-text'))$<HTMLInputElement>('manual-dialog-text').value=dialog.defaultValue;}
    config.changed();
  }
  async function poll() {
    if(!session||!live||disposed||pending)return;
    const current=session.id;
    try {
      const frame=await request('frame',undefined,45000);if(!live||session?.id!==current)return;
      render(frame);if(frame.image){$<HTMLImageElement>('manual-image').src=frame.image;zoom();}
      const native=$<HTMLSelectElement>('manual-native-select');$('manual-select-panel').hidden=!frame.select;
      if(frame.select){const key=JSON.stringify(frame.select.options);if(native.dataset.options!==key){native.dataset.options=key;native.replaceChildren(...frame.select.options.map((o:any)=>{const option=document.createElement('option');option.value=o.value;option.textContent=o.label;option.disabled=o.disabled;return option;}));}native.value=frame.select.value;}
      $('manual-browser-status').textContent=frame.warning||`原网页正在运行 · 已记录 ${frame.observed} 个状态 · 已勾选 ${frame.selectedIds.length} 页`;
    } catch(error) { if(session?.id===current)tell(String((error as Error).message),true); }
    finally { if(live&&session?.id===current&&!disposed)timer=setTimeout(()=>void poll(),500); }
  }
  function enqueue(body:unknown) {
    if(!session||pending||!live)return;const current=session.id;
    events=events.catch(()=>{}).then(async()=>{if(session?.id!==current)return;const result=await request('input',body,20000);if(result.clipboard!==undefined)await navigator.clipboard.writeText(result.clipboard);}).catch(error=>tell(error.message,true));
  }
  async function update(body:unknown) {
    if(!session)return;
    try{await events;render(await request('update',body));config.edited();}
    catch(error){tell((error as Error).message,true);signature='';render(session);}
  }
  async function command<T>(fn:()=>Promise<T>) {
    if(pending)return;pending=true;if(timer){clearTimeout(timer);timer=null;}$('manual-surface').setAttribute('aria-busy','true');
    for(const el of document.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('#manual-panel button,#manual-panel input,#manual-panel select'))el.disabled=true;
    try{await events;return await fn();}catch(error){tell((error as Error).message,true);throw error;}
    finally{pending=false;$('manual-surface').setAttribute('aria-busy','false');for(const el of document.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('#manual-panel button,#manual-panel input,#manual-panel select'))el.disabled=false;config.changed();if(live)timer=setTimeout(()=>void poll(),300);}
  }
  $('manual-mark').addEventListener('click',()=>void command(async()=>{
    config.edited();tell('正在保存当前状态与长页快照…');
    const mode=document.querySelector<HTMLInputElement>('input[name="manual-scope"]:checked')!.value;
    render(await request('mark',{name:$<HTMLInputElement>('manual-name').value,mode},90000));$<HTMLInputElement>('manual-name').value='';tell(`已标记 ${session!.marks[session!.marks.length-1].name}，可继续操作原网页。`);
  }).catch(()=>{}));
  function saveOptions(){try{localStorage.setItem('h2f-manual-options',JSON.stringify(options()));}catch{}if(session)void update({options:options()});}
  extras.addEventListener('change',saveOptions);layout.addEventListener('change',saveOptions);
  $('manual-resume').addEventListener('click',()=>{config.edited();showLive(true);});
  const surface=$('manual-surface'),keyboard=$<HTMLTextAreaElement>('manual-keyboard');
  const point=(event:MouseEvent)=>{const r=surface.getBoundingClientRect();return{x:Math.max(0,Math.min(session!.viewport.width-1,(event.clientX-r.left)/scale)),y:Math.max(0,Math.min(session!.viewport.height-1,(event.clientY-r.top)/scale))};};
  const button=(event:MouseEvent)=>event.button===2?'right':event.button===1?'middle':'left';
  surface.addEventListener('pointerdown',event=>{if(!session||pending)return;event.preventDefault();keyboard.focus({preventScroll:true});dragging=true;surface.setPointerCapture(event.pointerId);enqueue({type:'down',...point(event),button:button(event),clickCount:event.detail===2?2:1});});
  surface.addEventListener('pointerup',event=>{if(!session||!dragging)return;event.preventDefault();enqueue({type:'up',...point(event),button:button(event),clickCount:event.detail===2?2:1});dragging=false;if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);});
  surface.addEventListener('pointercancel',event=>{if(dragging&&session)enqueue({type:'up',...point(event),button:'left'});dragging=false;});
  surface.addEventListener('pointermove',event=>{if(!session||pending||Date.now()-lastMove<90)return;lastMove=Date.now();enqueue({type:'move',...point(event)});});
  surface.addEventListener('contextmenu',event=>event.preventDefault());
  surface.addEventListener('wheel',event=>{if(!session||pending)return;event.preventDefault();if(event.ctrlKey||event.metaKey){fit=false;scale=Math.max(.1,Math.min(3,scale*Math.exp(-event.deltaY*.002)));zoom();return;}const multiplier=event.deltaMode===1?16:event.deltaMode===2?session.viewport.height:1;enqueue({type:'wheel',...point(event),deltaX:Math.max(-10000,Math.min(10000,event.deltaX*multiplier)),deltaY:Math.max(-10000,Math.min(10000,event.deltaY*multiplier))});},{passive:false});
  keyboard.addEventListener('compositionstart',()=>{composing=true;});
  keyboard.addEventListener('compositionend',()=>{composing=false;if(keyboard.value){enqueue({type:'text',text:keyboard.value});keyboard.value='';}});
  keyboard.addEventListener('input',()=>{if(!composing&&keyboard.value){enqueue({type:'text',text:keyboard.value});keyboard.value='';}});
  keyboard.addEventListener('paste',event=>{event.preventDefault();enqueue({type:'text',text:event.clipboardData?.getData('text/plain')||''});});
  keyboard.addEventListener('keydown',event=>{
    if(composing||event.isComposing||event.key==='Process'||event.keyCode===229)return;
    if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey)return;
    if(['Meta','Control','Alt','Shift','CapsLock'].includes(event.key))return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='v')return;
    event.preventDefault();
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){enqueue({type:'copy'});return;}
    const key=[event.ctrlKey?'Control':'',event.metaKey?'Meta':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.key===' '?'Space':event.key].filter(Boolean).join('+');enqueue({type:'key',key});if(event.key==='Escape')keyboard.blur();
  });
  for(const action of ['back','forward','reload'])$(`manual-${action}`).addEventListener('click',()=>enqueue({type:action}));
  $('manual-native-select').addEventListener('change',()=>enqueue({type:'select',value:$<HTMLSelectElement>('manual-native-select').value}));
  for(const action of ['accept','cancel'])$(`manual-dialog-${action}`).addEventListener('click',()=>enqueue({type:'dialog',accept:action==='accept',text:$<HTMLInputElement>('manual-dialog-text').value}));
  $('manual-actual').addEventListener('click',()=>{fit=false;scale=1;zoom();});$('manual-fit').addEventListener('click',()=>{fit=true;zoom();});new ResizeObserver(zoom).observe($('manual-viewport'));
  $('manual-plugin-help').hidden=!config.plugin;
  async function close() {
    if(!session)return;const previous=session;showLive(false);
    try{await config.request(`/api/manual/${previous.id}/close`,{},30000);}
    finally{session=null;signature='';document.body.classList.remove('manual-result');$('manual-session').hidden=true;config.changed();}
  }
  $('manual-close').addEventListener('click',()=>void close().catch(error=>tell(error.message,true)));
  window.addEventListener('beforeunload',()=>{disposed=true;if(timer)clearTimeout(timer);});
  return {
    get active(){return !!session;}, get count(){return session?.selectedIds.length||0;}, get working(){return pending;},
    async prepare(raw:any){
      if(config.plugin){config.openWorkbench(raw);return;}
      if(!session){await command(async()=>{
        const health=await config.request('/api/health');const version=/^(\d+)\.(\d+)/.exec(health.version||'');if(!version||Number(version[1])===0&&Number(version[2])<15)throw new Error('手动标记需要 v0.15.0 或以上助手，请退出旧助手后打开新版。');
        const active=await config.request('/api/manual/active');
        render(active.session||await config.request('/api/manual',{...raw,options:options()},90000));showLive(true);tell('原网页已打开。自行操作后，点击“标记当前状态”。');
      });return;}
      await command(async()=>{tell('正在生成勾选页面与设计素材…');const result=await request('export',{},90000);showLive(false);config.prepared(result);});
    }, close,
    sync(visible:boolean){$('manual-panel').hidden=!visible;if(!visible){document.body.classList.remove('manual-result');if(live)showLive(false);}},
  };
}

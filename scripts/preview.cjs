'use strict';
const fs=require('node:fs'),path=require('node:path');
const [folder]=process.argv.slice(2);if(!folder)throw Error('Usage: node preview.cjs output-directory');
const root=path.resolve(folder),actions={};
for(const name of ['base','idle','walk','peek','drag','send']){const p=path.join(root,name,'clip.json');if(fs.existsSync(p)){const c=JSON.parse(fs.readFileSync(p));actions[name]={...c,frames:c.frames.map(f=>name+'/'+f)};}}
if(!actions.base)throw Error('Missing base/clip.json');
if(actions.peek){actions.unpeek={...actions.peek,frames:[...actions.peek.frames].reverse(),loop:false};actions.edgehide={...actions.peek,frames:actions.peek.frames.slice(-1),loop:false};}actions.speak={...actions.base,loop:true,idleBreathing:false};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({version:1,format:'pet-doll-preview',actions},null,2));
const data=JSON.stringify(actions).replace(/</g,'\\u003c');
fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><meta charset="utf-8"><title>布娃娃动作预览</title><style>body{font:16px system-ui;background:#e6e4dd;text-align:center}canvas{width:min(80vw,512px);height:auto}button{margin:5px;padding:10px}input{width:260px}</style><h1>布娃娃动作预览</h1><div id="buttons"></div><canvas width="512" height="512"></canvas><div><button id="pause">暂停</button><input id="seek" type="range" min="0" value="0"><span id="status"></span></div><script>
const actions=${data},names={base:'基础形象',idle:'待机',walk:'走路',peek:'探头',unpeek:'缩回',drag:'抱起',send:'带包裹移动',edgehide:'边缘停留',speak:'说话（静态）'},cache={};let current='base',frame=0,last=0,paused=false;
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),seek=document.querySelector('#seek');
const ready=Promise.all(Object.values(actions).flatMap(c=>c.frames).filter((v,i,a)=>a.indexOf(v)===i).map(src=>new Promise((resolve,reject)=>{const im=new Image;im.onload=()=>{cache[src]=im;resolve()};im.onerror=()=>reject(Error('图片无法加载：'+src));im.src=src})));
for(const key of Object.keys(actions)){const b=document.createElement('button');b.textContent=names[key]||key;b.onclick=()=>{current=key;frame=0;last=0;seek.max=actions[key].frames.length-1};buttons.append(b)}
document.querySelector('#pause').onclick=e=>{paused=!paused;e.target.textContent=paused?'播放':'暂停'};seek.oninput=()=>{frame=+seek.value;paused=true};
function draw(t){const c=actions[current];if(!paused&&last&&t-last>=1000/c.fps){frame=frame+1<c.frames.length?frame+1:c.loop?0:frame;last=t}else if(!last)last=t;ctx.clearRect(0,0,512,512);const breathe=c.idleBreathing&&!paused?Math.sin(t/1000*Math.PI*2/4)*.003:0;ctx.save();ctx.translate(256,475);ctx.scale(1+breathe*.35,1+breathe);ctx.drawImage(cache[c.frames[frame]],-256,-475);ctx.restore();seek.value=frame;document.querySelector('#status').textContent=current+' '+(frame+1)+'/'+c.frames.length;requestAnimationFrame(draw)}
ready.then(()=>{seek.max=0;requestAnimationFrame(draw)}).catch(e=>document.querySelector('#status').textContent=e.message);
</script>`);
console.log(path.join(root,'index.html'));

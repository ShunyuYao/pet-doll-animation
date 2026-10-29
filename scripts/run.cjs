'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.env.PET_DOLL_NODE_MODULES){process.env.NODE_PATH=process.env.PET_DOLL_NODE_MODULES;require('node:module').Module._initPaths();}
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=require('node:child_process').spawnSync(require('electron'),[__filename,...process.argv.slice(2)],{env,stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
}
const {app,nativeImage}=require('electron');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'pet-doll-tools-'));app.setPath('userData',profile);app.dock?.hide();
const read=f=>fs.readFileSync(f);const save=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{mode:0o600});
(async()=>{await app.whenReady();
 const [mode,file]=process.argv.slice(2);if(!['prepare','compile','analyze'].includes(mode)||!file)throw Error('Usage: node run.cjs prepare|compile|analyze job.json');
 const input=JSON.parse(read(file)),root=path.dirname(path.resolve(file)),resolve=f=>path.resolve(root,f);
 const out=resolve(input.output);if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Output must be new or empty; preserve previous results.');fs.mkdirSync(out,{recursive:true,mode:0o700});
 const start=Date.now(),action=input.action,plan=input.plan;
 const sources=(input.sources||[]).map(f=>read(resolve(f))),baseBytes=input.base?read(resolve(input.base)):undefined;
 if(mode==='analyze'){
  const {analyzeAtlas}=require('./runtime/ai-atlas-layout');const r=analyzeAtlas(nativeImage,sources[0],{single:!!input.single});
  save(path.join(out,'layout.json'),r.report);r.poses.forEach((b,i)=>{if(b)fs.writeFileSync(path.join(out,`pose-${String(i+1).padStart(2,'0')}.png`),b);});
 }else if(mode==='prepare'){
  const {DEFAULT_WORKFLOW}=require('./runtime/ai-motion-workflow');const {validateMotionPlan}=require('./runtime/ai-motion-plan');if(action!=='base')validateMotionPlan(plan);
  const {createRequestBuilder,repairRequest}=require('./runtime/ai-motion-requests');
  const refs=(input.refs||[]).map(r=>({role:r.role,mime:r.mime,bytes:read(resolve(r.file))}));
  const ctx={action,plan,text:input.text,brief:input.brief,identityRefs:refs,baseBytes,nativeImage,recipe:DEFAULT_WORKFLOW.resolve(action,plan),workflow:DEFAULT_WORKFLOW};
  if(input.repairPhase!==undefined&&(!Number.isInteger(input.repairPhase)||input.repairPhase<0||input.repairPhase>11))throw Error('repairPhase must be 0..11');
  const jobs=input.repairPhase===undefined?await createRequestBuilder()(ctx):[repairRequest(ctx,input.repairPhase,input.neighbor?read(resolve(input.neighbor)):undefined)];
  const manifest=jobs.map((j,i)=>{const prefix=`request-${String(i+1).padStart(2,'0')}`;fs.writeFileSync(path.join(out,prefix+'.txt'),j.prompt);return {prompt:prefix+'.txt',size:j.size,quality:input.quality||'high',model:input.model||'gpt-image-2',refs:j.refs.map((r,k)=>{const file=prefix+`-ref-${k+1}.`+({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[r.mime]);fs.writeFileSync(path.join(out,file),r.bytes);return {file,role:r.role,mime:r.mime};})};});save(path.join(out,'requests.json'),manifest);
 }else{
  const {createStableProcessor}=require('./runtime/ai-stable-frames');
  const result=await createStableProcessor(nativeImage)({action,plan,sources,baseBytes,directory:out,poseSources:input.poseSources?.map(f=>read(resolve(f)))});
  result.frames=result.frames.map(f=>path.basename(f));result.image=path.basename(result.image);result.action=action;
  result.elapsedMs=Date.now()-start;save(path.join(out,'clip.json'),result);
 }
 console.log(JSON.stringify({mode,output:out,elapsedMs:Date.now()-start}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>{app.quit();fs.rmSync(profile,{recursive:true,force:true});});

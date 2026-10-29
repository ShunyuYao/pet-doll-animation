'use strict';
// Host-owned extension points, never executable code supplied by a draft,
// imported appearance, model response or private gateway configuration.
const HOST_ACTIONS=Object.freeze(['idle','walk','peek','drag','send']);
const BODY_PROFILES=Object.freeze([
  {id:'quadruped',description:'Four connected walking legs',locomotion:'gait',sourceMode:'sheet',gait:'quadruped',rigid:false},
  {id:'biped',description:'Two connected walking legs on an organic subject',locomotion:'gait',sourceMode:'phases',gait:'biped',rigid:false},
  {id:'rigid-biped',description:'Two walking legs on rigid equipment or a robot',locomotion:'gait',sourceMode:'phases',gait:'rigid-biped',rigid:true},
  {id:'legless',description:'No visible walking legs; natural floating locomotion',locomotion:'float',sourceMode:'sheet',gait:null,rigid:false},
  {id:'other',description:'Unknown or different structure; preserve visible anatomy without inventing legs',locomotion:'adaptive',sourceMode:'sheet',gait:null,rigid:false},
].map(Object.freeze));
const recipe=(id,action,request,processor,sourceCount,frameCount,fps,loop,selectors={})=>({id,revision:1,action,request,processor,sourceCount,frameCount,fps,loop,...selectors});
const BUILTIN_RECIPES=[
  recipe('base-single','base','base','base',1,1,1,false),
  recipe('idle-blink','idle','blink','blink',1,80,20,true,{idleModes:['local-blink']}),
  recipe('idle-signal','idle','none','signal',0,80,20,true,{idleModes:['local-signal']}),
  recipe('idle-static','idle','none','static',0,1,1,true,{idleModes:['static']}),
  recipe('side-peek','peek','side-peek','peek',1,42,24,false),
  recipe('held-sheet','drag','held-sheet','poses',1,12,12.5,true,{revision:2,atlasRecovery:true}),
  recipe('walk-float','walk','none','float',0,40,20,true,{locomotion:['float']}),
  ...['walk','send'].flatMap(action=>[
    recipe(action+'-phases',action,'gait-phases','cycle',12,24,20,true,{sourceModes:['phases']}),
    recipe(action+'-sheet',action,'gait-sheet','cycle',1,24,20,true,{revision:2,atlasRecovery:true}),
  ]),
];
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const validId=value=>typeof value==='string'&&ID.test(value);
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function createMotionWorkflow({profiles=[],recipes=[]}={}){
  const allProfiles=structuredClone([...BODY_PROFILES,...profiles]);
  const ids=new Set();
  for(const p of allProfiles){
    if(!p||!validId(p.id)||ids.has(p.id)||typeof p.description!=='string'||!p.description.trim()||p.description.length>1000||!['gait','float','adaptive'].includes(p.locomotion)||!['sheet','phases'].includes(p.sourceMode)||typeof p.rigid!=='boolean'||p.gait!==null&&!validId(p.gait))throw Error('主体结构策略不正确。');
    ids.add(p.id);
  }
  const allRecipes=structuredClone([...recipes,...BUILTIN_RECIPES]),recipeIds=new Set();
  for(const r of allRecipes){
    if(!r||!validId(r.id)||recipeIds.has(r.id)||!['base',...HOST_ACTIONS].includes(r.action)||!validId(r.request)||!validId(r.processor)||!Number.isInteger(r.revision)||r.revision<1||!Number.isInteger(r.sourceCount)||r.sourceCount<0||r.sourceCount>12||!Number.isInteger(r.frameCount)||r.frameCount<1||r.frameCount>80||!Number.isFinite(r.fps)||r.fps<=0||r.fps>60||typeof r.loop!=='boolean')throw Error('动作生成策略不正确。');
    if(r.atlasRecovery!==undefined&&(typeof r.atlasRecovery!=='boolean'||r.atlasRecovery&&(r.sourceCount!==1||!['poses','cycle'].includes(r.processor))))throw Error('图集恢复策略不正确。');
    const selectors={bodyPlans:ids,idleModes:new Set(['local-blink','local-signal','static']),locomotion:new Set(['gait','float','adaptive']),sourceModes:new Set(['sheet','phases'])};
    for(const [key,allowed]of Object.entries(selectors))if(r[key]!==undefined&&(!Array.isArray(r[key])||!r[key].length||r[key].some(v=>!allowed.has(v))))throw Error('动作策略的结构条件不正确。');
    recipeIds.add(r.id);
  }
  freeze(allProfiles);freeze(allRecipes);
  const profile=bodyPlan=>{const value=allProfiles.find(p=>p.id===bodyPlan);if(!value)throw Error('主体结构尚无处理策略，请重试理解。');return value;};
  const resolve=(action,plan)=>{
    if(!['base',...HOST_ACTIONS].includes(action))throw Error('动作不正确。');
    const p=action==='base'?null:profile(plan?.bodyPlan);
    const result=allRecipes.find(r=>r.action===action&&(!r.bodyPlans||r.bodyPlans.includes(p?.id))&&(!r.idleModes||r.idleModes.includes(plan?.idleMode))&&(!r.locomotion||r.locomotion.includes(p?.locomotion))&&(!r.sourceModes||r.sourceModes.includes(p?.sourceMode)));
    if(!result)throw Error('当前主体缺少动作生成策略。');return result;
  };
  return Object.freeze({id:'stable-motion-v3',version:2,profiles:allProfiles,recipes:allRecipes,profile,resolve,
    describe(action,plan){const r=resolve(action,plan);return{id:'stable-motion-v3',version:2,recipeId:r.id,recipeRevision:r.revision,profileId:action==='base'?null:plan.bodyPlan,requestKind:r.request,processorKind:r.processor};}});
}
const DEFAULT_WORKFLOW=createMotionWorkflow();
module.exports={HOST_ACTIONS,BODY_PROFILES,createMotionWorkflow,DEFAULT_WORKFLOW};

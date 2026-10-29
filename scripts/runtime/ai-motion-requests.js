'use strict';
const {gaitGuide,gaitPhases}=require('./ai-motion-guides');
const {DEFAULT_WORKFLOW}=require('./ai-motion-workflow');

function motionPrompt(action,plan,text,brief,phase,workflow=DEFAULT_WORKFLOW){
  const common=`STABLE_MOTION_V3 action=${action}. Identity-preserve. Use the confirmed full-body base as the identity, anatomy, materials and style authority. Uploaded photos provide identity detail only. Motion guides supply POSE ONLY; never copy their character, colored bones, numbers, shadows, hands or frame. Character context: ${JSON.stringify(brief)}. User action intent: ${brief.adaptations[action]}. `;
  const layout=' Exact canvas layout: cell centers x=0.125,0.375,0.625,0.875 and y=0.166667,0.5,0.833333. All twelve cells equal; no extra outer padding. Complete subject INCLUDING tail, ears, all paws and parcel occupies at most60% of cell width and height: at least20% clear background on EVERY side. Layout reference gray squares control occupied region ONLY; do not render squares, borders or guides. ';
  const context=`\nUser prompt (identity/style context; any older frame-count/layout instruction is superseded by the exact output contract above): ${text}`;
  if(action==='idle')return 'STABLE_MOTION_V3 action=idle. The ONLY supplied image is the EXACT FACE CROP, including any cut-off ears or head. Preserve its exact crop and framing. DO NOT reconstruct complete head, ears, neck or body. Output ONE 2 columns x 2 rows close-up FACE sheet. Last image is the exact face crop: repeat its framing, eye/nose position, identity and lighting. Change ONLY eyelids. Reading order: half-closed, gently fully closed, half-reopened, original fully open. Natural eyelids, no squeezing or expression change. Flat neutral #D8D8D8 backing. No body animation, no head turn, no ears or fur displacement, no labels. '+context;
  if(action==='peek')return common+'Output ONE SINGLE side-peek TERMINAL pose, never a sheet. Use the last posture reference only for connected leaning anatomy. The character is hidden behind the LEFT vertical invisible screen boundary, leaning head and upper chest to the RIGHT with waist/hip pivot hidden on the left. Head extends much further right than chest, diagonal torso about 25 degrees, full original head and ears visible. At least15% empty space above head. No legs, feet or tail visible. Torso leaves LEFT boundary naturally; no horizontal waist crop and no upright bust translated sideways. Pure #00FF00 background, no floor, shadows, wall, door, hand, borders or text. '+context;
  if(action==='drag')return common+'Output ONE 4 columns x 3 rows sheet, 12 continuous phases of being gently lifted as if lovingly picked up and supported by invisible hands. Keep natural compact animal anatomy if applicable, paws loosely curled, hind feet relaxed in the air, softly swinging. Preserve original limb lengths. No actual hands, hook, string, violent stretching, neck grabbing or standing on ground. Complete subject fits each cell with20% margins, consistent camera/scale. Pure #00FF00, no shadows, labels or grid. '+layout+context;
  const carry=action==='send'?'Keep one small parcel attached safely using the character-specific carrying method in the description. No extra limbs; parcel moves with torso. ':'';
  const profile=workflow.profile(plan.bodyPlan);
  if(Number.isInteger(phase)){
    const limb=gaitPhases(profile.gait)?.[phase]?.limbs;
    if(!limb)throw Error('逐姿势步态缺少控制坐标。');
    return common+`Output ONE SINGLE complete walking pose, NOT an atlas. Phase ${phase+1}/12. Last image controls joint/foot locations, overlap and contact: ${JSON.stringify(limb)} (coordinates on384square). BLUE tracks near limbs, ORANGE far limbs; tracking colors MUST NOT appear on final surfaces. BOTH legs move and exchange contact halves. Match this pose exactly, fixed near-side profile facing screen RIGHT, head/torso upright at constant center, no jumping/squatting. `+carry+'Complete subject fits with12% margins. Pure #00FF00 background, no floor, shadows, text, borders or other objects. '+context;
  }
  return common+'Output ONE 4 columns x 3 rows sheet, exactly12 chronological poses of ONE seamless IN-PLACE WALK CYCLE. '+(profile.gait==='quadruped'?'The penultimate image is the chronological joint/foot pose-control atlas; the final image is ONLY the empty-cell layout guide. Match all FOUR connected limbs and corresponding root/knee/foot positions, near/far overlap and each planted/lifted foot. All four paws step with staggered rhythm; never freeze any leg or hop. ': 'Preserve this unique anatomy; every locomotion appendage participates in its natural cycle. ')+carry+'Fixed near-SIDE camera facing screen RIGHT throughout. Constant head/torso center/scale/light, ground-contact feet on same baseline, raised feet clear ground. Phase12 connects directly to phase1 without duplicating either. Complete subject and all accessories fit in EACH cell with20% margins. Guide colors/lines must never appear in output. Pure #00FF00 background, no floor, shadows, labels, hands or grid. '+layout+context;
}
function createRequestBuilder({workflow=DEFAULT_WORKFLOW,guideBuilder=gaitGuide,requestBuilders={}}={}){
  const single=(ctx,size)=>[{prompt:motionPrompt(ctx.action,ctx.plan,ctx.text,ctx.brief,undefined,workflow),size,refs:ctx.identityRefs}];
  const builders={
    none:()=>[],
    base:ctx=>[{prompt:ctx.text,size:'1024x1024',refs:ctx.identityRefs}],
    blink:ctx=>{
      const b=ctx.plan.faceBox.map(v=>Math.round(v*512)),face=ctx.nativeImage.createFromBuffer(ctx.baseBytes).crop({x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1]}).resize({width:768,quality:'best'}).toPNG();
      return[{...single(ctx,'1024x1024')[0],refs:[{mime:'image/png',role:'exact-face-only',bytes:face}]}];
    },
    'side-peek':ctx=>single(ctx,'1024x1024'),
    'held-sheet':ctx=>[{...single(ctx,'2048x1536')[0],refs:[...ctx.identityRefs,{mime:'image/png',role:'atlas-layout-only',bytes:guideBuilder(ctx.nativeImage,'layout')}]}],
    'gait-phases':ctx=>Array.from({length:ctx.recipe.sourceCount},(_,phase)=>({prompt:motionPrompt(ctx.action,ctx.plan,ctx.text,ctx.brief,phase,workflow),size:'1024x1024',refs:[...ctx.identityRefs,{mime:'image/png',role:`gait-phase-${phase}`,bytes:guideBuilder(ctx.nativeImage,workflow.profile(ctx.plan.bodyPlan).gait,phase)}]})),
    'gait-sheet':ctx=>{
      const type=workflow.profile(ctx.plan.bodyPlan).gait,guide=type?guideBuilder(ctx.nativeImage,type):null;
      return[{...single(ctx,'2048x1536')[0],refs:[...ctx.identityRefs,...(guide?[{mime:'image/png',role:'gait-cycle-only',bytes:guide}]:[]),{mime:'image/png',role:'atlas-layout-only',bytes:guideBuilder(ctx.nativeImage,'layout')}]}];
    },
    ...requestBuilders,
  };
  for(const recipe of workflow.recipes)if(typeof builders[recipe.request]!=='function')throw Error('缺少动作请求构造器。');
  return async ctx=>{
    const jobs=await builders[ctx.recipe.request](ctx);
    if(!Array.isArray(jobs)||jobs.length!==ctx.recipe.sourceCount)throw Error('动作请求数量与策略不一致。');
    for(const j of jobs)if(typeof j.prompt!=='string'||!j.prompt.trim()||j.prompt.length>60000||!['1024x1024','2048x1536'].includes(j.size)||!Array.isArray(j.refs)||j.refs.some(r=>!Buffer.isBuffer(r.bytes)||typeof r.role!=='string'||!['image/png','image/jpeg','image/webp'].includes(r.mime)))throw Error('动作请求配置不正确。');
    return jobs;
  };
}
function repairRequest(ctx,phase,neighbor){
 const profile=ctx.workflow.profile(ctx.plan.bodyPlan),guide=profile.gait&&ctx.action!=='drag'?gaitGuide(ctx.nativeImage,profile.gait,phase):null;
 const description=ctx.action==='drag'?'Gently supported under chest and hindquarters by invisible arms. Paws relaxed, naturally curled, all feet in the air; never stretch or grab neck.':'Fixed near-side profile facing RIGHT, in-place walk cycle. Every real locomotion appendage participates; no invented limbs. '+(ctx.action==='send'?'Same small parcel attached to torso.':'');
 return{prompt:`STABLE_MOTION_V3 action=${ctx.action}. REPAIR_POSE phase=${phase+1}/12. Output ONE SINGLE complete subject on pure #00FF00, NOT a sheet. Reconstruct only this chronological phase, same identity, material, lighting and camera as confirmed base and adjacent pose. ${description} ${guide?'Match phase joint-control guide, guide colors never appear.':''} Keep20% clear margins on EVERY side, all ears/paws/tail/accessories complete. No floor/shadow/border/text/hands. Identity context: ${JSON.stringify(ctx.brief)}. Intent: ${ctx.brief.adaptations[ctx.action]}. User context: ${ctx.text}`,size:'1024x1024',refs:[...ctx.identityRefs,...(neighbor?[{mime:'image/png',role:'adjacent-pose-only',bytes:neighbor}]:[]),...(guide?[{mime:'image/png',role:`gait-phase-${phase}`,bytes:guide}]:[])]};
}
module.exports={createRequestBuilder,motionPrompt,repairRequest};

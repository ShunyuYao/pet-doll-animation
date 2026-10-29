'use strict';
const fs = require('node:fs'), path = require('node:path');
const { removeBackgroundGreen } = require('./ai-frames');
const { validateMotionPlan } = require('./ai-motion-plan');
const { DEFAULT_WORKFLOW } = require('./ai-motion-workflow');
const {analyzeAtlas,requireComplete}=require('./ai-atlas-layout');
const S = 512, BASELINE = Math.round(355 * S / 384), HEIGHT = 322 * S / 384, WIDTH = 330 * S / 384;
let runtime;
async function opencv() { if (!runtime) runtime = Promise.resolve(require('@techstark/opencv-js')).catch(e => { runtime = null; throw e; }); return runtime; }
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const sourceError = message => Object.assign(new Error(message), { code: 'COMPANION_SOURCE_REJECTED' });
function bounds(pixels, w, h, threshold = 128) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3] > threshold) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
function createStableProcessor(nativeImage, {workflow=DEFAULT_WORKFLOW,processors={}}={}) {
  function decode(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024 ** 2 || bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw Error('生成图片格式不正确。');
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    if (w < 4 || h < 3 || w > 8192 || h > 8192 || w * h > 32 * 1024 ** 2) throw Error('生成图片尺寸不正确。');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw Error('无法读取生成的图片。');
    return image;
  }
  function from(raw, w = S, h = S) { return nativeImage.createFromBitmap(Buffer.from(raw), { width: w, height: h }); }
  // Sources were already decoded with their own size budget. Archive validation
  // belongs to final 512px frames, not the model's larger original PNG.
  function flip(image) {
    const {width,height}=image.getSize(),raw=image.toBitmap(),out=Buffer.alloc(raw.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const a=(y*width+x)*4,b=(y*width+width-1-x)*4;raw.copy(out,b,a,a+4);
    }
    return from(out,width,height);
  }
  function clean(image) {
    const { width: w, height: h } = image.getSize();
    return from(removeBackgroundGreen(image.toBitmap(), w, h), w, h);
  }
  function tiles(image, columns, rows) {
    const { width: w, height: h } = image.getSize();
    return Array.from({ length: columns * rows }, (_, i) => {
      const x = Math.round(i % columns * w / columns), y = Math.round(Math.floor(i / columns) * h / rows);
      return image.crop({ x, y, width: Math.round((i % columns + 1) * w / columns) - x, height: Math.round((Math.floor(i / columns) + 1) * h / rows) - y });
    });
  }
  function normalize(images, targetHeight = HEIGHT, targetWidth = WIDTH, baseline = BASELINE) {
    const data = images.map(image => { const im = clean(image), size = im.getSize(), raw = im.toBitmap(), b = bounds(raw, size.width, size.height), full = bounds(raw,size.width,size.height,2); if (!b || !full) throw Error('生成结果没有完整主体，请重试。'); return { im, b, full }; });
    const scale = Math.min(targetHeight / Math.max(...data.map(x => x.b.height)), targetWidth / Math.max(...data.map(x => x.b.width)));
    return data.map(({ im, b, full }) => {
      const tile = im.crop(full).resize({ width: Math.max(1, Math.round(full.width * scale)), height: Math.max(1, Math.round(full.height * scale)), quality: 'best' });
      const size = tile.getSize(), raw = tile.toBitmap(), canvas = Buffer.alloc(S * S * 4);
      const left = Math.round(S / 2 - (b.x + b.width / 2) * scale + full.x * scale), top = Math.round(baseline - (b.y + b.height) * scale + full.y * scale);
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) if (x + left >= 0 && x + left < S && y + top >= 0 && y + top < S) raw.copy(canvas, ((y + top) * S + x + left) * 4, (y * size.width + x) * 4, (y * size.width + x + 1) * 4);
      return from(canvas);
    });
  }
  function rect(value) { const [x,y,r,b] = value.map(v => Math.round(v*S)); return { x,y,width:r-x,height:b-y }; }
  function regionMask(plan) {
    const mask = new Uint8Array(S*S);
    for (const region of plan.activeRegions) {
      const box = rect(region), cx = box.x + box.width/2, cy = box.y + box.height/2, rx = box.width/2, ry = box.height/2;
      for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
        const d = Math.sqrt(((x+.5-cx)/rx)**2 + ((y+.5-cy)/ry)**2);
        mask[y*S+x] = Math.max(mask[y*S+x], Math.round(255 * Math.min(1, Math.max(0, (1-d)*Math.min(rx,ry)/1.5))));
      }
    }
    return mask;
  }
  const gray = (cv, image, onNeutral = false) => {
    const size = image.getSize(), raw = image.toBitmap(), g = new cv.Mat(size.height,size.width,cv.CV_8UC1);
    for (let i=0;i<size.width*size.height;i++) { const p=i*4; g.data[i] = Math.round(.114*raw[p]+.587*raw[p+1]+.299*raw[p+2] + (onNeutral ? .55*(255-raw[p+3]) : 0)); }
    return g;
  };
  async function blink(base, sheet, plan) {
    const cv = await opencv(), box = rect(plan.faceBox), target = base.crop(box), mask = regionMask(plan), baseRaw = base.toBitmap();
    const template = gray(cv,target), fixed = new cv.Mat(box.height,box.width,cv.CV_8UC1), frames = [], registration = [];
    let fixedCount = 0;
    for (let y=0;y<box.height;y++) for(let x=0;x<box.width;x++){const p=(y+box.y)*S+x+box.x;fixed.data[y*box.width+x]=mask[p]===0&&baseRaw[p*4+3]>220?255:0;if(fixed.data[y*box.width+x])fixedCount++;}
    if (fixedCount < box.width * box.height * .15) { template.delete();fixed.delete();throw Error('眼部定位缺少稳定参照，请重新生成此动作。'); }
    try {
      for (const panel of tiles(sheet,2,2)) {
        const scaled=panel.resize({width:box.width,height:box.height,quality:'best'}), input=gray(cv,scaled), warp=cv.Mat.eye(2,3,cv.CV_32F), rgba=cv.matFromArray(box.height,box.width,cv.CV_8UC4,scaled.toBitmap()), aligned=new cv.Mat();
        try {
          const score=cv.findTransformECC(template,input,warp,cv.MOTION_AFFINE,new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_COUNT,100,1e-5),fixed,5);
          const m=Array.from(warp.data32F);
          if (!Number.isFinite(score)||score<.5||m.some(v=>!Number.isFinite(v))||m[0]<.65||m[0]>1.35||m[4]<.65||m[4]>1.35||Math.abs(m[2])>box.width*.3||Math.abs(m[5])>box.height*.3) throw sourceError('眨眼对齐未通过，请重试此动作。');
          cv.warpAffine(rgba,aligned,warp,new cv.Size(box.width,box.height),cv.INTER_CUBIC|cv.WARP_INVERSE_MAP,cv.BORDER_REPLICATE);
          const canvas=Buffer.from(baseRaw);
          for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){const p=(y+box.y)*S+x+box.x,amount=mask[p]/255;if(!amount)continue;const q=(y*box.width+x)*4;for(let c=0;c<3;c++)canvas[p*4+c]=Math.round(baseRaw[p*4+c]*(1-amount)+aligned.data[q+c]*baseRaw[p*4+3]/255*amount);}
          frames.push(from(canvas));registration.push({correlation:score,matrix:m});
        } finally {input.delete();warp.delete();rgba.delete();aligned.delete();}
      }
    } catch(e){if(typeof e?.message==='string'&&/[\u4e00-\u9fff]/.test(e.message))throw e;throw sourceError('眨眼对齐失败，请重试此动作。');}
    finally {template.delete();fixed.delete();}
    return { frames: [...Array(70).fill(base),frames[0],frames[1],frames[1],frames[2],frames[3],...Array(5).fill(base)], metadata:{registration,activeMask:mask} };
  }
  async function remap(image, coordinates) {
    const cv=await opencv(), input=cv.matFromArray(S,S,cv.CV_8UC4,image.toBitmap()), mx=new cv.Mat(S,S,cv.CV_32FC1), my=new cv.Mat(S,S,cv.CV_32FC1), output=new cv.Mat();
    try { for(let y=0;y<S;y++)for(let x=0;x<S;x++){const p=y*S+x,[sx,sy]=coordinates(x,y);mx.data32F[p]=sx;my.data32F[p]=sy;}cv.remap(input,output,mx,my,cv.INTER_CUBIC,cv.BORDER_CONSTANT);const raw=Buffer.from(output.data);for(let p=0;p<raw.length;p+=4)if(raw[p+3]<8)raw.fill(0,p,p+4);return from(raw); }
    finally {input.delete();mx.delete();my.delete();output.delete();}
  }
  async function middle(first, second) {
    const cv=await opencv(), a=gray(cv,first,true), b=gray(cv,second,true), flow=new cv.Mat();
    try {cv.calcOpticalFlowFarneback(a,b,flow,.5,4,25,5,7,1.5,0);const output=await remap(first,(x,y)=>{const p=(y*S+x)*2;return[x-.5*flow.data32F[p],y-.5*flow.data32F[p+1]]});const box=bounds(output.toBitmap(),S,S);return box?remap(output,(x,y)=>[x,y-(BASELINE-box.y-box.height)]):output;}
    finally {a.delete();b.delete();flow.delete();}
  }
  async function peek(source) {
    // Generate left-hidden preview terminal; transform in right-hidden canonical
    // space so the accepted V3 timing is reused exactly, then mirror back.
    const image=clean(flip(source)), size=image.getSize(), b=bounds(image.toBitmap(),size.width,size.height,2);
    if(!b)throw Error('探头结果没有可见主体，请重试。');
    const factor=Math.min(225*S/384/b.height,220*S/384/b.width), tile=image.crop(b).resize({width:Math.round(b.width*factor),height:Math.round(b.height*factor),quality:'best'}), raw=tile.toBitmap(), t=tile.getSize(), canvas=Buffer.alloc(S*S*4);
    const left=Math.round(S-t.width*.98), top=Math.round(100*S/384);
    for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)if(x+left<S&&y+top<S)raw.copy(canvas,((y+top)*S+x+left)*4,(y*t.width+x)*4,(y*t.width+x+1)*4);
    const key=from(canvas), keys=[[0,220,6,-6],[8,88,3,-5],[12,88,3,-5],[19,95,6,-2],[29,0,-3,7],[35,0,-3,7],[41,0,0,0]], result=[];
    for(let i=0;i<42;i++){
      if(i===0){result.push(from(Buffer.alloc(S*S*4)));continue;}
      const j=keys.findIndex((k,n)=>n<keys.length-1&&i>=k[0]&&i<=keys[n+1][0]),lo=keys[j],hi=keys[j+1],mix=ease((i-lo[0])/(hi[0]-lo[0]));
      const [dx,dy,degrees]=lo.slice(1).map((v,n)=>v+(hi[n+1]-v)*mix);const scale=S/384;
      const output=i===41?key:await remap(key,(xx,yy)=>{const x=xx-dx*scale,y=yy-dy*scale,weight=ease((258*scale-y)/(90*scale))*ease((S-x)/(24*scale)),a=degrees*Math.PI/180*weight,c=Math.cos(a),q=Math.sin(a),px=x-356*scale,py=y-249*scale;return[356*scale+c*px+q*py,249*scale-q*px+c*py]});
      result.push(flip(output));
      await new Promise(resolve=>setImmediate(resolve));
    }
    return result;
  }
  function completePoses(decoded,metadata){
    if(decoded.length!==1&&decoded.length!==12)throw Error('动作源姿势不完整，请重试。');
    const layouts=decoded.map(im=>analyzeAtlas(nativeImage,im.toPNG(),{single:decoded.length===12}));
    const rawPoses=layouts.flatMap(result=>requireComplete(result).map(b=>decode(b)));
    metadata.layout=layouts.map(result=>result.report);
    const poses=normalize(rawPoses);metadata.sourcePoses=poses.length;return poses;
  }
  const handlers={
    base:async({decoded})=>normalize(decoded),
    blink:async({base,decoded,plan,metadata})=>{const output=await blink(base,decoded[0],plan);Object.assign(metadata,output.metadata);return output.frames;},
    signal:async({base,plan,metadata,recipe})=>{
      const original=base.toBitmap(),mask=regionMask(plan);metadata.activeMask=mask;
      return Array.from({length:recipe.frameCount},(_,i)=>{const raw=Buffer.from(original),strength=Math.round((.64+.36*Math.cos(2*Math.PI*i/recipe.frameCount))*5)/5;for(let p=0;p<S*S;p++)if(mask[p])for(let c=0;c<3;c++)raw[p*4+c]=Math.round(original[p*4+c]*(1-mask[p]/255*(1-strength)));return from(raw);});
    },
    static:async({base})=>[base],
    peek:async({decoded})=>peek(decoded[0]),
    float:async({base,recipe,signal})=>{const frames=[];for(let i=0;i<recipe.frameCount;i++){signal?.throwIfAborted();frames.push(await remap(base,(x,y)=>[x,y+3*S/384*(1-Math.cos(2*Math.PI*i/recipe.frameCount))]));}return frames;},
    poses:async({decoded,metadata})=>completePoses(decoded,metadata),
    cycle:async({decoded,metadata,signal})=>{
      const poses=completePoses(decoded,metadata);
      if(new Set(poses.map(im=>require('node:crypto').createHash('sha256').update(im.toBitmap()).digest('hex'))).size<8)throw sourceError('步态姿势重复过多，请重试此动作。');
      const frames=[];for(let i=0;i<poses.length;i++){signal?.throwIfAborted();frames.push(poses[i],await middle(poses[i],poses[(i+1)%poses.length]));await new Promise(resolve=>setImmediate(resolve));}return frames;
    },
    ...processors,
  };
  const requirements={base:[[1],1],blink:[[1],80],signal:[[0],null],static:[[0],1],peek:[[1],42],float:[[0],null],poses:[[1,12],12],cycle:[[1,12],24]};
  for(const recipe of workflow.recipes){
    if(typeof handlers[recipe.processor]!=='function')throw Error('缺少动作帧处理器。');
    const limits=requirements[recipe.processor];
    if(!processors[recipe.processor]&&limits&&(!limits[0].includes(recipe.sourceCount)||limits[1]&&recipe.frameCount!==limits[1]))throw Error('动作策略与处理器契约不一致。');
  }
  return async function process({ bytes, sources, baseBytes, plan: rawPlan, action, directory, signal, poseSources }) {
    const plan=action==='base'?null:validateMotionPlan(rawPlan,{profiles:workflow.profiles}),recipe=workflow.resolve(action,plan);
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const sourceBuffers=sources|| (bytes?[bytes]:[]);
    if(sourceBuffers.length!==recipe.sourceCount)throw Error('动作源姿势数量与策略不一致。');
    const decoded=sourceBuffers.map(decode);
    sourceBuffers.forEach((b,i)=>fs.writeFileSync(path.join(directory,`source-${String(i+1).padStart(2,'0')}.png`),b,{mode:0o600}));
    const metadata={strategy:'stable-motion-v3',sourceSizes:decoded.map(im=>im.getSize())};
    const base=plan?decode(baseBytes):null;
    if(base&&(base.getSize().width!==S||base.getSize().height!==S))throw Error('基础形象尺寸不正确，请重做基础形象。');
    if(poseSources&&(!['cycle','poses'].includes(recipe.processor)||poseSources.length!==12))throw Error('动作补帧契约不正确。');
    const frames=await handlers[recipe.processor]({decoded:poseSources?poseSources.map(decode):decoded,base,plan,recipe,metadata,signal,tools:{normalize,remap,from,clean,bounds},nativeImage});
    if(!Array.isArray(frames)||frames.length!==recipe.frameCount||frames.some(im=>!im||im.isEmpty()||im.getSize().width!==S||im.getSize().height!==S))throw Error('动作处理结果与策略契约不一致。');
    const {fps,loop}=recipe,idleBreathing=action==='idle'&&plan.idleBreathing;
    metadata.workflow=workflow.describe(action,plan);
    signal?.throwIfAborted();
    const files=frames.map((im,i)=>{const file=path.join(directory,`${String(i+1).padStart(2,'0')}.png`);fs.writeFileSync(file,im.toPNG(),{mode:0o600});return file;});
    return {image:files[0],frames:files,fps,loop,idleBreathing,metadata};
  };
}
module.exports={createStableProcessor,bounds,S,BASELINE};

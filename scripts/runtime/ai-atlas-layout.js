'use strict';
const {removeBackgroundGreen}=require('./ai-frames');
const VERSION=1;
const rejected=message=>Object.assign(Error(message),{code:'COMPANION_SOURCE_REJECTED'});
function decode(nativeImage,bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>64*1024**2||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('生成图片格式不正确。');
 const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(w<4||h<3||w>8192||h>8192||w*h>32*1024**2)throw Error('生成图片尺寸不正确。');
 const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('无法读取生成的图片。');return image;
}
// Only isolated tiny specks are excluded from seam detection. Render pixels,
// whiskers and disconnected accessories are retained; no species templates.
function layoutMask(raw,w,h,minArea){
 const components=[];
 const mask=new Uint8Array(w*h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
 for(let start=0;start<w*h;start++){
  if(seen[start]||raw[start*4+3]<16)continue;
  let end=1,x0=w,y0=h,x1=0,y1=0;queue[0]=start;seen[start]=1;
  for(let head=0;head<end;head++){
   const p=queue[head],x=p%w,y=Math.floor(p/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
   for(const q of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1])if(q>=0&&!seen[q]&&raw[q*4+3]>=16){seen[q]=1;queue[end++]=q;}
  }
  if(end>=minArea){components.push({area:end,x:x0,y:y0,width:x1-x0+1,height:y1-y0+1});for(let i=0;i<end;i++)mask[queue[i]]=1;}
 }
 return{mask,components};
}
function seam(hist,expected,range){
 const lo=Math.max(1,Math.floor(expected-range)),hi=Math.min(hist.length-2,Math.ceil(expected+range));let best=null;
 for(let i=lo;i<=hi;i++)if(hist[i]===0){const start=i;while(i<=hi&&hist[i]===0)i++;const end=i;if(end-start>=3){const center=Math.round((start+end)/2),distance=Math.abs(center-expected);if(!best||distance<best.distance)best={cut:center,distance};}}
 return best?.cut??Math.round(expected);
}
function measure(mask,w,rect){
 let x0=rect.x+rect.width,y0=rect.y+rect.height,x1=-1,y1=-1,area=0;
 for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++)if(mask[y*w+x]){area++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 return area?{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,area}:null;
}
function analyzeAtlas(nativeImage,bytes,{single=false}={}){
 const image=decode(nativeImage,bytes),{width:w,height:h}=image.getSize(),raw=removeBackgroundGreen(image.toBitmap(),w,h);
 const {mask,components}=layoutMask(raw,w,h,Math.max(8,Math.round(w*h/(single?1:12)*.0005)));
 const cleaned=nativeImage.createFromBitmap(raw,{width:w,height:h});
 const rowHist=new Uint32Array(h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rowHist[y]+=mask[y*w+x];
 const ys=single?[0,h]:[0,seam(rowHist,h/3,h/9),seam(rowHist,2*h/3,h/9),h],slots=[];
 for(let row=0;row<ys.length-1;row++){
  const y=ys[row],height=ys[row+1]-y,hist=new Uint32Array(w);
  for(let yy=y;yy<y+height;yy++)for(let x=0;x<w;x++)hist[x]+=mask[yy*w+x];
  const xs=single?[0,w]:[0,...[1,2,3].map(i=>seam(hist,i*w/4,w/12)),w];
  for(let col=0;col<xs.length-1;col++){
   const rect={x:xs[col],y,width:xs[col+1]-xs[col],height},box=measure(mask,w,rect);let reason=null;
   if(!box||box.area<Math.max(16,w*h/(single?1:12)*.003))reason='missing';
   else if(box.x-rect.x<2||box.y-rect.y<2||rect.x+rect.width-box.x-box.width<2||rect.y+rect.height-box.y-box.height<2)reason='touching-or-cut';
   const pieces=components.filter(c=>c.x+c.width/2>=rect.x&&c.x+c.width/2<rect.x+rect.width&&c.y+c.height/2>=rect.y&&c.y+c.height/2<rect.y+rect.height).sort((a,b)=>b.area-a.area);
   if(!reason&&pieces.length>1&&pieces[1].area>pieces[0].area*.35)reason='ambiguous-subjects';
   slots.push({phase:slots.length,rect,box,reason});
  }
 }
 if(!single){
  const usable=slots.filter(s=>!s.reason),median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  if(usable.length>=6){const mw=median(usable.map(s=>s.box.width)),mh=median(usable.map(s=>s.box.height));for(const s of usable)if(s.box.width>mw*1.65||s.box.height>mh*1.65||s.box.width<mw*.5||s.box.height<mh*.5)s.reason='scale-outlier';}
 }
 const poses=slots.map(s=>s.reason?null:cleaned.crop(s.rect).toPNG());
 return{poses,report:{version:VERSION,size:{width:w,height:h},slots,rejected:slots.filter(s=>s.reason).map(s=>s.phase)}};
}
function requireComplete(result){if(result.report.rejected.length)throw rejected('部分动作姿势缺失、连在一起或被裁切，请重试；完整姿势仍保留。');return result.poses;}
module.exports={VERSION,analyzeAtlas,requireComplete,decode};

'use strict';
const CONTRACT = require('./ai-gait-contract.json');
// Reviewed V3 pose coordinates are anatomy controllers, not identity assets.
function gaitPhases(bodyPlan) { return CONTRACT[bodyPlan === 'rigid-biped' ? 'biped' : bodyPlan] || null; }
function gaitGuide(nativeImage, bodyPlan, phase) {
  if(bodyPlan==='layout')return atlasLayoutGuide(nativeImage);
  const phases = gaitPhases(bodyPlan);
  if (!phases) return null;
  const single = Number.isInteger(phase), size = single ? 384 : 1536, height = single ? 384 : 1152;
  const pixels = Buffer.alloc(size * height * 4, 255);
  const colors = [[110, 130, 30, 255], [30, 120, 230, 255], [230, 80, 35, 255], [190, 40, 190, 255]];
  const dot = (x, y, radius, color, ox, oy) => {
    for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= radius ** 2 && xx >= 0 && xx < 384 && yy >= 0 && yy < 384) pixels.set(color, ((yy + oy) * size + xx + ox) * 4);
  };
  const line = (a, b, color, ox, oy) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let k = 0; k <= n; k++) dot(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, 5, color, ox, oy); };
  for (const i of single ? [phase] : phases.map((_, i) => i)) {
    const ox = single ? 0 : i % 4 * 384, oy = single ? 0 : Math.floor(i / 4) * 384;
    const p = phases[i];
    const limbs = Object.values(p.limbs);
    // Body spine connects the limb roots; near/far colors track limb identity.
    if (bodyPlan === 'quadruped') line([115, 180], [258, 180], [170,170,170,255], ox, oy);
    else {
      line([192,100], [192,226], [170,170,170,255], ox, oy);
      for(const [j,limb] of limbs.entries()) {
        const offset=(limb.foot[0]-192)*-.65,color=colors[j?2:1];
        line([192,135],[192+offset*.45,182],color,ox,oy);
        line([192+offset*.45,182],[192+offset,225],color,ox,oy);
      }
    }
    limbs.forEach((limb, j) => { const c = bodyPlan === 'quadruped' ? [colors[0], colors[1], colors[3], colors[2]][j] : colors[j ? 2 : 1]; line(limb.root, limb.knee, c, ox, oy); line(limb.knee, limb.foot, c, ox, oy); dot(...limb.foot, 8, c, ox, oy); });
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height }).toPNG();
}
module.exports = { gaitPhases, gaitGuide };

// Layout reference intentionally contains no identity. All twelve safe regions
// occupy 60% of a cell, leaving 20% clear on each side. Never shipped as frames.
function atlasLayoutGuide(nativeImage){
 const width=1024,height=768,raw=Buffer.alloc(width*height*4,255);
 for(let i=0;i<12;i++){const ox=i%4*256,oy=Math.floor(i/4)*256;
  for(let y=51;y<205;y++)for(let x=51;x<205;x++){
   const p=((oy+y)*width+ox+x)*4,c=(x<54||x>201||y<54||y>201)?100:235;raw[p]=raw[p+1]=raw[p+2]=c;
  }
 }
 return nativeImage.createFromBitmap(raw,{width,height}).toPNG();
}
module.exports.atlasLayoutGuide=atlasLayoutGuide;

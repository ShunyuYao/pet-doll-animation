'use strict';
// Coordinates belong to the confirmed, normalized base, never to a species template.
const { BODY_PROFILES } = require('./ai-motion-workflow');
const BODY_PLANS = Object.freeze(BODY_PROFILES.map(p=>p.id));
function validateMotionPlan(value, { profiles = BODY_PROFILES } = {}) {
  const fail = () => { throw Error('动作区域理解不完整，请重试；已有素材仍保留。'); };
  const profile=value&&profiles.find(p=>p.id===value.bodyPlan);
  if (!profile || !['local-blink', 'local-signal', 'static'].includes(value.idleMode) || typeof value.idleBreathing !== 'boolean') fail();
  const rect = v => {
    if (!Array.isArray(v) || v.length !== 4 || v.some(x => !Number.isFinite(x) || x < 0 || x > 1) || v[2] - v[0] < .008 || v[3] - v[1] < .008) fail();
    return [...v];
  };
  if (!Array.isArray(value.activeRegions) || value.activeRegions.length > 4) fail();
  const regions = value.activeRegions.map(rect);
  if (value.idleMode === 'static' && regions.length || value.idleMode !== 'static' && !regions.length) fail();
  if (regions.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0) > .06) fail();
  const faceBox = value.idleMode === 'local-blink' ? rect(value.faceBox) : null;
  if (faceBox && (regions.length > 2 || regions.some(r => r[0] <= faceBox[0] || r[1] <= faceBox[1] || r[2] >= faceBox[2] || r[3] >= faceBox[3]) || (faceBox[2] - faceBox[0]) * (faceBox[3] - faceBox[1]) > .5)) fail();
  if (profile.rigid && value.idleBreathing) fail();
  return { version: 1, bodyPlan: value.bodyPlan, idleMode: value.idleMode, idleBreathing: value.idleBreathing, activeRegions: regions, ...(faceBox ? { faceBox } : {}) };
}
module.exports={validateMotionPlan,BODY_PLANS};

// Drives one rig: picks the pose for the current animation, crossfades it
// against the outgoing one, layers metric-driven modifiers on top, and pushes
// the result to the SVG. One instance per mascot.

import { neutralPose, lerpPose } from './mark.js';
import { anims, applyModifiers } from './anims.js';

const DEFAULT_BLEND_MS = 180;

export function createPlayer(mark, fallback = 'idle', getConfig = null) {
  // Three reusable buffers — nothing is allocated on the frame path.
  const bufCur = neutralPose();
  const bufPrev = neutralPose();
  const bufOut = neutralPose();

  let curName = fallback;
  let curStart = 0;
  let prevName = null;
  let prevStart = 0;
  let blendStart = 0;
  let blendDur = DEFAULT_BLEND_MS;
  let onFinish = null;

  function poseInto(name, elapsed, metrics, buf) {
    neutralPose(buf);
    const anim = anims[name];
    if (anim) anim.pose(elapsed, metrics, buf);
    return buf;
  }

  return {
    get current() {
      return curName;
    },

    /**
     * Switches animation. `blend` of 0 snaps instantly — useful for physics
     * transitions where a crossfade would look like a glitch.
     */
    play(name, { now = performance.now(), blend = DEFAULT_BLEND_MS, then = null } = {}) {
      if (!anims[name]) return;
      if (name === curName && anims[name].loop) return;
      prevName = curName;
      prevStart = curStart;
      curName = name;
      curStart = now;
      blendStart = now;
      blendDur = blend;
      onFinish = then;
    },

    update(now, metrics) {
      const anim = anims[curName];
      const elapsed = now - curStart;

      // One-shot animations hand control back when their duration is up.
      if (anim && !anim.loop && anim.dur && elapsed >= anim.dur) {
        const cb = onFinish;
        onFinish = null;
        if (cb) cb();
        else this.play(fallback, { now });
        return this.update(now, metrics);
      }

      poseInto(curName, elapsed, metrics, bufCur);

      let pose = bufCur;
      const blendK = blendDur > 0 ? (now - blendStart) / blendDur : 1;
      if (prevName && blendK < 1) {
        poseInto(prevName, now - prevStart, metrics, bufPrev);
        pose = lerpPose(bufPrev, bufCur, blendK, bufOut);
      } else {
        prevName = null;
      }

      applyModifiers(pose, metrics, now, getConfig ? getConfig().effects : null);
      mark.apply(pose);
      return pose;
    },
  };
}

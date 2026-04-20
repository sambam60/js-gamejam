// Bug rendering. Simulation (AI, physics, spawning, damage) lives in
// src/sim/bugs.ts and runs inside LocalSession/NetworkSession. This module is
// now a pure view over the snapshot array that game.js receives each frame.

window.BugSystem = (function () {
  // Dimensions come from the sim constants via the TS bundle
  // (src/client/legacy-bridge.ts → window.ShapescapeSession.entityDimensions).
  // Fallback is only hit if the bridge hasn't loaded yet.
  function dims() {
    const d = window.ShapescapeSession && window.ShapescapeSession.entityDimensions;
    return { w: (d && d.bugWidth) || 14, h: (d && d.bugHeight) || 12 };
  }

  // State id used by the sword-hurt visual flash. Kept in sync with
  // src/sim/bugs.ts STATES.HURT so the sprite switches palette on hit.
  const STATE_HURT = 5;

  function renderBug(ctx, bug, cam, H, frameTick) {
    const { w: BUG_W, h: BUG_H } = dims();
    const t = frameTick * 0.12 + (bug.phase || 0);

    const pulse = Math.sin(t) * 0.15;
    const pulse2 = Math.sin(t * 1.7 + 1.0) * 0.1;
    const scaleX = 1.0 + pulse;
    const scaleY = 1.0 - pulse * 0.5 + pulse2;

    const screenX = bug.x - cam;
    const screenY = H - bug.y - BUG_H;
    const cx = screenX + BUG_W / 2;
    const cy = screenY + BUG_H / 2;

    const isHurt = (bug.hurtTimer || 0) > 0 || bug.state === STATE_HURT;
    const hurtFlash = isHurt && (Math.floor((bug.hurtTimer || 0) / 3) % 2 === 0);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX * (bug.direction === -1 ? -1 : 1), scaleY);

    ctx.shadowColor = isHurt ? 'rgba(255,100,50,0.5)' : 'rgba(51,255,51,0.3)';
    ctx.shadowBlur = 8 + Math.sin(t * 2) * 3;

    const bw = BUG_W;
    const bh = BUG_H;
    const g = Math.floor(120 + Math.sin(t) * 40);
    ctx.fillStyle = hurtFlash ? '#ff6633' : `rgb(10,${g},10)`;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    const innerPulse = Math.sin(t * 2.3) * 0.4 + 0.5;
    ctx.fillStyle = hurtFlash
      ? 'rgba(255,200,100,0.4)'
      : `rgba(0,255,0,${(0.15 + innerPulse * 0.2).toFixed(2)})`;
    const subSize = bw * 0.35;
    const offX = Math.sin(t * 1.5) * 2;
    const offY = Math.cos(t * 1.8) * 1.5;
    ctx.fillRect(-subSize / 2 + offX, -subSize / 2 + offY, subSize, subSize);
    ctx.fillRect(subSize * 0.3 - offX, subSize * 0.2 - offY, subSize * 0.6, subSize * 0.6);

    const g2 = Math.floor(80 + Math.sin(t * 0.7) * 30);
    ctx.strokeStyle = hurtFlash ? '#ff9944' : `rgb(0,${g2},0)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    const eyeY = -bh * 0.15 + Math.sin(t * 1.4) * 0.5;
    ctx.shadowBlur = 0;
    ctx.fillStyle = hurtFlash ? '#ff3300' : '#88ff88';
    ctx.fillRect(-3, eyeY - 1, 2, 2);
    ctx.fillRect(2, eyeY - 1, 2, 2);

    ctx.restore();

    // scuttling legs — slow during idle/attack, fast otherwise. We can't tell
    // sub-states apart from the snapshot so any non-hurt state scuttles fast.
    ctx.save();
    ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
    ctx.lineWidth = 1;
    const legAnimSpeed = isHurt ? 0.6 : 3.0;
    for (let i = 0; i < 3; i++) {
      const legPhase = frameTick * legAnimSpeed * 0.12 + (bug.phase || 0) + i * 2.1;
      const legSwing = Math.sin(legPhase) * 3;
      const legBaseY = screenY + BUG_H;
      const lx = screenX + 2 + i * 4;
      ctx.beginPath();
      ctx.moveTo(lx, legBaseY - 1);
      ctx.lineTo(lx - 3 + legSwing, legBaseY + 3);
      ctx.stroke();
      const rx = screenX + BUG_W - 2 - i * 4;
      ctx.beginPath();
      ctx.moveTo(rx, legBaseY - 1);
      ctx.lineTo(rx + 3 - legSwing, legBaseY + 3);
      ctx.stroke();
    }
    ctx.restore();

    const hp = bug.hp;
    const maxHp = bug.maxHp;
    if (typeof hp === 'number' && typeof maxHp === 'number' && hp < maxHp) {
      const barW = BUG_W + 4;
      const barH = 2;
      const barX = screenX - 2;
      const barY = screenY - 6;
      ctx.fillStyle = '#001a00';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#22aa22';
      ctx.fillRect(barX, barY, barW * (hp / maxHp), barH);
    }
  }

  return {
    renderAll: function (ctx, bugs, cam, H, frameTick) {
      if (!bugs) return;
      for (const b of bugs) renderBug(ctx, b, cam, H, frameTick);
    },
  };
})();

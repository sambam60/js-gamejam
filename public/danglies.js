// Dangly rendering. Simulation (AI state machine, physics, arm reach, damage)
// lives in src/sim/danglies.ts and runs inside LocalSession/NetworkSession.
// This module draws whatever the snapshot hands us each frame.

window.DanglySystem = (function () {
  // Dimensions come from the sim constants via the TS bundle
  // (src/client/legacy-bridge.ts → window.ShapescapeSession.entityDimensions).
  function dims() {
    const d = window.ShapescapeSession && window.ShapescapeSession.entityDimensions;
    return { w: (d && d.danglyWidth) || 18, h: (d && d.danglyHeight) || 34 };
  }

  // State ids mirrored from src/sim/danglies.ts. Only used for visual branches
  // (charge glow, arm extension, hurt flash) — no game logic happens here.
  const STATE_CHARGE = 4;
  const STATE_ATTACK = 5;
  const STATE_HURT = 6;

  function renderDangly(ctx, d, cam, H, frameTick) {
    const { w: DANGLY_W, h: DANGLY_H } = dims();
    const t = frameTick * 0.1 + (d.phase || 0);

    const pulse = Math.sin(t) * 0.1;
    const pulse2 = Math.sin(t * 1.5 + 1.0) * 0.07;
    const scaleX = 1.0 + pulse * 0.5;
    const scaleY = 1.0 - pulse * 0.3 + pulse2;

    const screenX = d.x - cam;
    const screenY = H - d.y - DANGLY_H;
    const cx = screenX + DANGLY_W / 2;
    const cy = screenY + DANGLY_H / 2;

    const hurtTimer = d.hurtTimer || 0;
    const isHurt = hurtTimer > 0 || d.state === STATE_HURT;
    const hurtFlash = isHurt && (Math.floor(hurtTimer / 3) % 2 === 0);
    const isCharging = d.state === STATE_CHARGE || d.state === STATE_ATTACK;
    const chargeProgress = d.chargeProgress || 0;
    const armExtend = d.armExtend || 0;
    const attackPulse = d.attackPulse || 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX * (d.direction === -1 ? -1 : 1), scaleY);

    const glowIntensity = isCharging ? 0.4 + chargeProgress * 0.4 : 0.3;
    ctx.shadowColor = isHurt ? 'rgba(255,100,50,0.5)' : `rgba(51,255,51,${glowIntensity})`;
    ctx.shadowBlur = 8 + Math.sin(t * 2) * 3 + (isCharging ? chargeProgress * 8 : 0);

    const bh = DANGLY_H;

    const headSize = 10;
    const headBob = Math.sin(t * 1.2) * 1.5;
    const g = Math.floor(120 + Math.sin(t) * 40);
    ctx.fillStyle = hurtFlash ? '#ff6633' : `rgb(10,${g},10)`;
    ctx.fillRect(-headSize / 2, -bh / 2 + headBob, headSize, headSize);

    const g2 = Math.floor(80 + Math.sin(t * 0.7) * 30);
    ctx.strokeStyle = hurtFlash ? '#ff9944' : `rgb(0,${g2},0)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-headSize / 2, -bh / 2 + headBob, headSize, headSize);

    const eyeY = -bh / 2 + headBob + headSize * 0.4 + Math.sin(t * 1.4) * 0.5;
    ctx.shadowBlur = 0;
    ctx.fillStyle = hurtFlash ? '#ff3300' : '#88ff88';
    ctx.fillRect(-3, eyeY - 1, 2, 2);
    ctx.fillRect(2, eyeY - 1, 2, 2);

    const torsoW = 8;
    const torsoH = 14;
    const torsoY = -bh / 2 + headSize + headBob * 0.5;
    const gTorso = Math.floor(100 + Math.sin(t * 0.8) * 30);
    ctx.fillStyle = hurtFlash ? '#ff6633' : `rgb(8,${gTorso},8)`;
    ctx.fillRect(-torsoW / 2, torsoY, torsoW, torsoH);

    const innerPulse = isCharging
      ? 0.3 + chargeProgress * 0.5 + Math.sin(attackPulse * 2) * 0.2
      : Math.sin(t * 2.3) * 0.3 + 0.3;
    ctx.fillStyle = hurtFlash
      ? 'rgba(255,200,100,0.4)'
      : `rgba(0,255,0,${innerPulse.toFixed(2)})`;
    const subW = torsoW * 0.5;
    const subH = torsoH * 0.4;
    const offX = Math.sin(t * 1.5) * 1.5;
    const offY = Math.cos(t * 1.8) * 1;
    ctx.fillRect(-subW / 2 + offX, torsoY + torsoH * 0.3 + offY, subW, subH);

    ctx.strokeStyle = hurtFlash ? '#ff9944' : `rgb(0,${g2},0)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-torsoW / 2, torsoY, torsoW, torsoH);

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
    ctx.lineWidth = 1.5;
    const legTop = screenY + DANGLY_H * 0.7;
    const legBottom = screenY + DANGLY_H;
    const legSpread = 5;
    const legAnim = Math.sin(frameTick * 0.08 + (d.phase || 0)) * ((d.vx || 0) !== 0 ? 4 : 1.5);

    ctx.beginPath();
    ctx.moveTo(cx - 2, legTop);
    ctx.lineTo(cx - legSpread + legAnim, legBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + 2, legTop);
    ctx.lineTo(cx + legSpread - legAnim, legBottom);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const shoulderY = screenY + DANGLY_H * 0.35;

    if (isCharging || armExtend > 0) {
      const armLen = 6 + armExtend;
      const adx = d.armDirX || 0;
      // sim uses y-up, screen uses y-down.
      const ady = -(d.armDirY || 0);
      const wobbleL = Math.sin(frameTick * 0.15 + (d.phase || 0)) * 3;
      const wobbleR = Math.sin(frameTick * 0.15 + (d.phase || 0) + 1.5) * 3;
      const px = -ady;
      const py = adx;

      const chargePulseAlpha = isCharging
        ? 0.4 + Math.sin(attackPulse * 3) * 0.3
        : 0.3;
      ctx.strokeStyle = hurtFlash ? '#cc5522' : `rgba(34,170,34,${chargePulseAlpha.toFixed(2)})`;
      ctx.lineWidth = 2;

      const tipLX = cx + adx * armLen + px * wobbleL;
      const tipLY = shoulderY + ady * armLen + py * wobbleL;
      const tipRX = cx + adx * armLen + px * wobbleR;
      const tipRY = shoulderY + ady * armLen + py * wobbleR;

      ctx.beginPath();
      ctx.moveTo(cx - 4, shoulderY);
      ctx.quadraticCurveTo(
        cx + adx * armLen * 0.5 + px * wobbleL * 0.6 - 2,
        shoulderY + ady * armLen * 0.5 + py * wobbleL * 0.6,
        tipLX, tipLY
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + 4, shoulderY);
      ctx.quadraticCurveTo(
        cx + adx * armLen * 0.5 + px * wobbleR * 0.6 + 2,
        shoulderY + ady * armLen * 0.5 + py * wobbleR * 0.6,
        tipRX, tipRY
      );
      ctx.stroke();

      if (d.state === STATE_ATTACK) {
        const clawGlow = 3 + Math.sin(attackPulse * 4) * 2;
        ctx.fillStyle = hurtFlash ? '#ff6633' : `rgba(51,255,51,${(0.5 + Math.sin(attackPulse * 5) * 0.3).toFixed(2)})`;
        ctx.fillRect(tipLX - clawGlow / 2, tipLY - clawGlow / 2, clawGlow, clawGlow);
        ctx.fillRect(tipRX - clawGlow / 2, tipRY - clawGlow / 2, clawGlow, clawGlow);
      }

      if (d.state === STATE_CHARGE) {
        const ringRadius = 10 + chargeProgress * 30;
        const ringAlpha = 0.1 + Math.sin(attackPulse * 2) * 0.08;
        ctx.strokeStyle = `rgba(51,255,51,${ringAlpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, screenY + DANGLY_H * 0.4, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
      ctx.lineWidth = 1.5;
      const restWobble = Math.sin(frameTick * 0.06 + (d.phase || 0)) * 2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, shoulderY);
      ctx.lineTo(cx - 6, shoulderY + 8 + restWobble);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 4, shoulderY);
      ctx.lineTo(cx + 6, shoulderY + 8 - restWobble);
      ctx.stroke();
    }
    ctx.restore();

    const hp = d.hp;
    const maxHp = d.maxHp;
    if (typeof hp === 'number' && typeof maxHp === 'number' && hp < maxHp) {
      const barW = DANGLY_W + 8;
      const barH = 2;
      const barX = screenX - 4;
      const barY = screenY - 6;
      ctx.fillStyle = '#001a00';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#22aa22';
      ctx.fillRect(barX, barY, barW * (hp / maxHp), barH);
    }
  }

  return {
    renderAll: function (ctx, danglies, cam, H, frameTick) {
      if (!danglies) return;
      for (const d of danglies) renderDangly(ctx, d, cam, H, frameTick);
    },
  };
})();

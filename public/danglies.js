// dangly enemies — tall gangly humanoid figures that stand still to charge
// and stretch their arms toward the player. Slower than bug jellys,
// but human-height with long reach. Same green undulating-square aesthetic.
// Can jump slowly during chase.

window.DanglySystem = (function () {

  const DANGLY_W = 18;
  const DANGLY_H = 34;
  const DANGLY_GRAVITY = 0.25;
  const DANGLY_MOVE_SPEED = 0.45;
  const DANGLY_CHASE_SPEED = 0.7;
  const DANGLY_JUMP_VEL = 8.5;
  const DANGLY_JUMP_COOLDOWN = 200;
  const DANGLY_DAMAGE = 10;
  const DANGLY_DAMAGE_COOLDOWN = 90;
  const DANGLY_DETECT_RANGE = 200;
  const DANGLY_ATTACK_RANGE = 80;
  const DANGLY_SPAWN_INTERVAL = 22000;
  const DANGLY_MAX_ALIVE = 5;
  const DANGLY_ARM_MAX_REACH = 75;
  const DANGLY_CHARGE_FRAMES = 80;

  const STATES = { IDLE: 0, WANDER: 1, CHASE: 2, JUMP: 3, CHARGE: 4, ATTACK: 5, HURT: 6 };

  function createDangly(x, y) {
    return {
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      onGround: false,
      hp: 35,
      maxHP: 35,
      state: STATES.IDLE,
      stateTimer: 80 + Math.floor(Math.random() * 60),
      direction: Math.random() < 0.5 ? -1 : 1,
      damageCooldown: 0,
      phase: Math.random() * Math.PI * 2,
      hurtTimer: 0,
      jumpCooldown: 0,
      chargeProgress: 0,
      armExtend: 0,
      attackPulse: 0,
      armDirX: 0,
      armDirY: 0,
    };
  }

  function updateAI(d, playerX, playerBottom) {
    const dcx = d.x + DANGLY_W / 2;
    const dcy = d.y + DANGLY_H / 2;
    const pcx = playerX + 16;
    const pcy = playerBottom + 16;
    const dx = pcx - dcx;
    const dy = pcy - dcy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (d.hurtTimer > 0) {
      d.hurtTimer--;
      d.chargeProgress = 0;
      d.armExtend = 0;
      if (d.hurtTimer <= 0) d.state = STATES.CHASE;
      return;
    }

    d.stateTimer--;

    switch (d.state) {
      case STATES.IDLE:
        d.vx = 0;
        d.chargeProgress = 0;
        d.armExtend = 0;
        if (dist < DANGLY_DETECT_RANGE) {
          d.state = STATES.CHASE;
          d.stateTimer = 120 + Math.floor(Math.random() * 60);
          break;
        }
        if (d.stateTimer <= 0) {
          d.state = STATES.WANDER;
          d.direction = Math.random() < 0.5 ? -1 : 1;
          d.stateTimer = 100 + Math.floor(Math.random() * 120);
        }
        break;

      case STATES.WANDER:
        d.vx = d.direction * DANGLY_MOVE_SPEED;
        d.chargeProgress = 0;
        d.armExtend = 0;
        if (dist < DANGLY_DETECT_RANGE) {
          d.state = STATES.CHASE;
          d.stateTimer = 120 + Math.floor(Math.random() * 60);
          break;
        }
        if (d.stateTimer <= 0) {
          d.state = STATES.IDLE;
          d.stateTimer = 50 + Math.floor(Math.random() * 80);
        }
        break;

      case STATES.CHASE:
        d.direction = dx > 0 ? 1 : -1;
        d.vx = d.direction * DANGLY_CHASE_SPEED;
        d.chargeProgress = 0;
        d.armExtend = 0;
        if (dist < DANGLY_ATTACK_RANGE) {
          d.state = STATES.CHARGE;
          d.stateTimer = DANGLY_CHARGE_FRAMES;
          d.chargeProgress = 0;
          d.vx = 0;
          break;
        }
        if (d.onGround && d.jumpCooldown <= 0) {
          if (dy > 25 || Math.random() < 0.006) {
            d.vy = DANGLY_JUMP_VEL;
            d.onGround = false;
            d.jumpCooldown = DANGLY_JUMP_COOLDOWN;
            d.state = STATES.JUMP;
            d.stateTimer = 50;
            break;
          }
        }
        if (dist > DANGLY_DETECT_RANGE * 2.5) {
          d.state = STATES.WANDER;
          d.stateTimer = 60;
        }
        break;

      case STATES.JUMP:
        d.direction = dx > 0 ? 1 : -1;
        d.vx = d.direction * DANGLY_CHASE_SPEED * 0.5;
        d.chargeProgress = 0;
        d.armExtend = 0;
        if (d.onGround || d.stateTimer <= 0) {
          d.state = dist < DANGLY_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
          d.stateTimer = 30;
        }
        break;

      case STATES.CHARGE:
        d.vx = 0;
        d.direction = dx > 0 ? 1 : -1;
        d.chargeProgress = Math.min(1, d.chargeProgress + 1 / DANGLY_CHARGE_FRAMES);
        d.armExtend = d.chargeProgress * DANGLY_ARM_MAX_REACH;
        d.attackPulse += 0.15 + d.chargeProgress * 0.25;
        if (dist > 0.1) {
          d.armDirX = dx / dist;
          d.armDirY = dy / dist;
        }
        if (d.stateTimer <= 0) {
          d.state = STATES.ATTACK;
          d.stateTimer = 30;
          d.armExtend = DANGLY_ARM_MAX_REACH;
        }
        break;

      case STATES.ATTACK:
        d.vx = 0;
        d.armExtend = DANGLY_ARM_MAX_REACH * (0.7 + 0.3 * Math.sin(d.attackPulse));
        d.attackPulse += 0.35;
        if (dist > 0.1) {
          d.armDirX = dx / dist;
          d.armDirY = dy / dist;
        }
        if (d.stateTimer <= 0) {
          d.armExtend = 0;
          d.chargeProgress = 0;
          d.state = dist < DANGLY_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
          d.stateTimer = 40;
        }
        break;

      case STATES.HURT:
        d.vx = 0;
        d.armExtend = 0;
        d.chargeProgress = 0;
        break;
    }
  }

  function renderDangly(ctx, d, cam, H, frameTick) {
    const t = frameTick * 0.1 + d.phase;

    const pulse = Math.sin(t) * 0.1;
    const pulse2 = Math.sin(t * 1.5 + 1.0) * 0.07;
    const scaleX = 1.0 + pulse * 0.5;
    const scaleY = 1.0 - pulse * 0.3 + pulse2;

    const screenX = d.x - cam;
    const screenY = H - d.y - DANGLY_H;
    const cx = screenX + DANGLY_W / 2;
    const cy = screenY + DANGLY_H / 2;

    const isHurt = d.hurtTimer > 0;
    const hurtFlash = isHurt && (Math.floor(d.hurtTimer / 3) % 2 === 0);
    const isCharging = d.state === STATES.CHARGE || d.state === STATES.ATTACK;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX * (d.direction === -1 ? -1 : 1), scaleY);

    const glowIntensity = isCharging ? 0.4 + d.chargeProgress * 0.4 : 0.3;
    ctx.shadowColor = isHurt ? 'rgba(255,100,50,0.5)' : `rgba(51,255,51,${glowIntensity})`;
    ctx.shadowBlur = 8 + Math.sin(t * 2) * 3 + (isCharging ? d.chargeProgress * 8 : 0);

    const bh = DANGLY_H;

    // head
    const headSize = 10;
    const headBob = Math.sin(t * 1.2) * 1.5;
    const g = Math.floor(120 + Math.sin(t) * 40);
    ctx.fillStyle = hurtFlash ? '#ff6633' : `rgb(10,${g},10)`;
    ctx.fillRect(-headSize / 2, -bh / 2 + headBob, headSize, headSize);

    const g2 = Math.floor(80 + Math.sin(t * 0.7) * 30);
    ctx.strokeStyle = hurtFlash ? '#ff9944' : `rgb(0,${g2},0)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(-headSize / 2, -bh / 2 + headBob, headSize, headSize);

    // eyes
    const eyeY = -bh / 2 + headBob + headSize * 0.4 + Math.sin(t * 1.4) * 0.5;
    ctx.shadowBlur = 0;
    ctx.fillStyle = hurtFlash ? '#ff3300' : '#88ff88';
    ctx.fillRect(-3, eyeY - 1, 2, 2);
    ctx.fillRect(2, eyeY - 1, 2, 2);

    // torso
    const torsoW = 8;
    const torsoH = 14;
    const torsoY = -bh / 2 + headSize + headBob * 0.5;
    const gTorso = Math.floor(100 + Math.sin(t * 0.8) * 30);
    ctx.fillStyle = hurtFlash ? '#ff6633' : `rgb(8,${gTorso},8)`;
    ctx.fillRect(-torsoW / 2, torsoY, torsoW, torsoH);

    const innerPulse = isCharging
      ? 0.3 + d.chargeProgress * 0.5 + Math.sin(d.attackPulse * 2) * 0.2
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

    // legs
    ctx.save();
    ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
    ctx.lineWidth = 1.5;
    const legTop = screenY + DANGLY_H * 0.7;
    const legBottom = screenY + DANGLY_H;
    const legSpread = 5;
    const legAnim = Math.sin(frameTick * 0.08 + d.phase) * (d.vx !== 0 ? 4 : 1.5);

    ctx.beginPath();
    ctx.moveTo(cx - 2, legTop);
    ctx.lineTo(cx - legSpread + legAnim, legBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + 2, legTop);
    ctx.lineTo(cx + legSpread - legAnim, legBottom);
    ctx.stroke();
    ctx.restore();

    // arms — reach toward the player when charging/attacking
    ctx.save();
    const shoulderY = screenY + DANGLY_H * 0.35;

    if (isCharging || d.armExtend > 0) {
      const armLen = 6 + d.armExtend;
      // screen-space direction to player (armDirX is world-x, armDirY is world-y-up)
      const adx = d.armDirX;
      const ady = -d.armDirY; // flip y: world y-up -> screen y-down
      const wobbleL = Math.sin(frameTick * 0.15 + d.phase) * 3;
      const wobbleR = Math.sin(frameTick * 0.15 + d.phase + 1.5) * 3;
      // perpendicular for wobble
      const px = -ady;
      const py = adx;

      const chargePulseAlpha = isCharging
        ? 0.4 + Math.sin(d.attackPulse * 3) * 0.3
        : 0.3;
      ctx.strokeStyle = hurtFlash ? '#cc5522' : `rgba(34,170,34,${chargePulseAlpha.toFixed(2)})`;
      ctx.lineWidth = 2;

      // both arms reach toward player, offset slightly from shoulders
      const tipLX = cx + adx * armLen + px * wobbleL;
      const tipLY = shoulderY + ady * armLen + py * wobbleL;
      const tipRX = cx + adx * armLen + px * wobbleR;
      const tipRY = shoulderY + ady * armLen + py * wobbleR;

      // left arm (offset shoulder left)
      ctx.beginPath();
      ctx.moveTo(cx - 4, shoulderY);
      ctx.quadraticCurveTo(
        cx + adx * armLen * 0.5 + px * wobbleL * 0.6 - 2,
        shoulderY + ady * armLen * 0.5 + py * wobbleL * 0.6,
        tipLX, tipLY
      );
      ctx.stroke();

      // right arm (offset shoulder right)
      ctx.beginPath();
      ctx.moveTo(cx + 4, shoulderY);
      ctx.quadraticCurveTo(
        cx + adx * armLen * 0.5 + px * wobbleR * 0.6 + 2,
        shoulderY + ady * armLen * 0.5 + py * wobbleR * 0.6,
        tipRX, tipRY
      );
      ctx.stroke();

      // claw tips glow during attack
      if (d.state === STATES.ATTACK) {
        const clawGlow = 3 + Math.sin(d.attackPulse * 4) * 2;
        ctx.fillStyle = hurtFlash ? '#ff6633' : `rgba(51,255,51,${(0.5 + Math.sin(d.attackPulse * 5) * 0.3).toFixed(2)})`;
        ctx.fillRect(tipLX - clawGlow / 2, tipLY - clawGlow / 2, clawGlow, clawGlow);
        ctx.fillRect(tipRX - clawGlow / 2, tipRY - clawGlow / 2, clawGlow, clawGlow);
      }

      // charge pulse ring
      if (d.state === STATES.CHARGE) {
        const ringRadius = 10 + d.chargeProgress * 30;
        const ringAlpha = 0.1 + Math.sin(d.attackPulse * 2) * 0.08;
        ctx.strokeStyle = `rgba(51,255,51,${ringAlpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, screenY + DANGLY_H * 0.4, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // arms at rest — dangling down
      ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
      ctx.lineWidth = 1.5;
      const restWobble = Math.sin(frameTick * 0.06 + d.phase) * 2;
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

    // health bar
    if (d.hp < d.maxHP) {
      const barW = DANGLY_W + 8;
      const barH = 2;
      const barX = screenX - 4;
      const barY = screenY - 6;
      ctx.fillStyle = '#001a00';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#22aa22';
      ctx.fillRect(barX, barY, barW * (d.hp / d.maxHP), barH);
    }
  }

  return {
    maybeSpawn: function (danglies, playerX, lastSpawnTime, now) {
      if (danglies.length >= DANGLY_MAX_ALIVE) return lastSpawnTime;
      if (now - lastSpawnTime < DANGLY_SPAWN_INTERVAL) return lastSpawnTime;
      const side = Math.random() < 0.5 ? -1 : 1;
      const spawnX = playerX + side * (300 + Math.random() * 250);
      danglies.push(createDangly(spawnX, 0));
      return now;
    },

    updateAll: function (danglies, playerX, playerBottom, squares, H, frameTick) {
      for (let i = danglies.length - 1; i >= 0; i--) {
        const d = danglies[i];
        if (d.hp <= 0) { danglies.splice(i, 1); continue; }

        updateAI(d, playerX, playerBottom);

        d.vy -= DANGLY_GRAVITY;
        d.x += d.vx;
        d.y += d.vy;
        if (d.damageCooldown > 0) d.damageCooldown--;
        if (d.jumpCooldown > 0) d.jumpCooldown--;
        d.onGround = false;

        if (d.y <= 0) {
          d.y = 0;
          d.vy = 0;
          d.onGround = true;
        }

        if (d.vy <= 0) {
          for (const s of squares) {
            if (d.x + DANGLY_W > s.x && d.x < s.x + s.width) {
              const surfTop = s.y + s.height;
              if (d.y <= surfTop && d.y >= s.y && d.y - d.vy >= surfTop - 1) {
                d.y = surfTop;
                d.vy = 0;
                d.onGround = true;
              }
            }
          }
        }

        if (Math.abs(d.x - playerX) > 1000) {
          danglies.splice(i, 1);
        }
      }
    },

    renderAll: function (ctx, danglies, cam, H, frameTick) {
      for (const d of danglies) {
        renderDangly(ctx, d, cam, H, frameTick);
      }
    },

    checkPlayerCollision: function (danglies, playerX, playerBottom, charW, charH) {
      let totalDmg = 0;
      for (const d of danglies) {
        if (d.damageCooldown > 0) continue;
        if (d.state !== STATES.ATTACK && d.state !== STATES.CHARGE) continue;

        // body collision
        const bodyHit = playerX < d.x + DANGLY_W && playerX + charW > d.x &&
                        playerBottom < d.y + DANGLY_H && playerBottom + charH > d.y;

        // arm collision — ellipse along direction toward player
        let armHit = false;
        if (d.armExtend > 10) {
          const dcx = d.x + DANGLY_W / 2;
          const dShoulderY = d.y + DANGLY_H * 0.65;
          const tipX = dcx + d.armDirX * d.armExtend;
          const tipY = dShoulderY + d.armDirY * d.armExtend;
          const pCenterX = playerX + charW / 2;
          const pCenterY = playerBottom + charH / 2;
          const atdx = pCenterX - tipX;
          const atdy = pCenterY - tipY;
          const tipDist = Math.sqrt(atdx * atdx + atdy * atdy);
          if (tipDist < charW * 0.7 + 8) armHit = true;
        }

        if (bodyHit || armHit) {
          totalDmg += DANGLY_DAMAGE;
          d.damageCooldown = DANGLY_DAMAGE_COOLDOWN;
        }
      }
      return totalDmg;
    },

    swordHitDanglies: function (danglies, pcx, pcy, range) {
      let kills = 0;
      for (const d of danglies) {
        const dcx = d.x + DANGLY_W / 2;
        const dcy = d.y + DANGLY_H / 2;
        const ddx = dcx - pcx, ddy = dcy - pcy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < range) {
          d.hp -= 10;
          d.hurtTimer = 15;
          d.state = STATES.HURT;
          d.chargeProgress = 0;
          d.armExtend = 0;
          if (dist > 1) {
            d.x += (ddx / dist) * 20;
            d.vy = 2;
          }
          if (d.hp <= 0) kills++;
        }
      }
      return kills;
    },
  };
})();

// bug enemies — small green things that scuttle around and bite the player
// they have a basic state machine: idle, wander, chase, jump, attack, hurt

window.BugSystem = (function () {

  const BUG_W = 14;
  const BUG_H = 12;
  const BUG_GRAVITY = 0.25;
  const BUG_MOVE_SPEED = 0.8;
  const BUG_CHASE_SPEED = 1.4;
  const BUG_JUMP_VEL = 5;
  const BUG_DAMAGE = 6;
  const BUG_DAMAGE_COOLDOWN = 80;
  const BUG_DETECT_RANGE = 180;
  const BUG_ATTACK_RANGE = 28;
  const BUG_SPAWN_INTERVAL = 16000;
  const BUG_MAX_ALIVE = 8;

  const STATES = { IDLE: 0, WANDER: 1, CHASE: 2, JUMP: 3, ATTACK: 4, HURT: 5 };

  function createBug(x, y) {
    return {
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      onGround: false,
      hp: 18,
      maxHP: 18,
      state: STATES.IDLE,
      stateTimer: 60 + Math.floor(Math.random() * 60),
      direction: Math.random() < 0.5 ? -1 : 1,
      damageCooldown: 0,
      phase: Math.random() * Math.PI * 2,
      jumpCooldown: 0,
      hurtTimer: 0,
    };
  }

  // AI state machine
  function updateAI(bug, playerX, playerBottom) {
    const bcx = bug.x + BUG_W / 2;
    const bcy = bug.y + BUG_H / 2;
    const pcx = playerX + 16;
    const pcy = playerBottom + 16;
    const dx = pcx - bcx;
    const dy = pcy - bcy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (bug.hurtTimer > 0) {
      bug.hurtTimer--;
      if (bug.hurtTimer <= 0) bug.state = STATES.CHASE;
      return;
    }

    bug.stateTimer--;

    switch (bug.state) {
      case STATES.IDLE:
        bug.vx = 0;
        if (dist < BUG_DETECT_RANGE) {
          bug.state = STATES.CHASE;
          bug.stateTimer = 120 + Math.floor(Math.random() * 60);
          break;
        }
        if (bug.stateTimer <= 0) {
          bug.state = STATES.WANDER;
          bug.direction = Math.random() < 0.5 ? -1 : 1;
          bug.stateTimer = 80 + Math.floor(Math.random() * 100);
        }
        break;

      case STATES.WANDER:
        bug.vx = bug.direction * BUG_MOVE_SPEED;
        if (dist < BUG_DETECT_RANGE) {
          bug.state = STATES.CHASE;
          bug.stateTimer = 120 + Math.floor(Math.random() * 60);
          break;
        }
        if (bug.stateTimer <= 0) {
          bug.state = STATES.IDLE;
          bug.stateTimer = 40 + Math.floor(Math.random() * 80);
        }
        break;

      case STATES.CHASE:
        bug.direction = dx > 0 ? 1 : -1;
        bug.vx = bug.direction * BUG_CHASE_SPEED;
        if (dist < BUG_ATTACK_RANGE) {
          bug.state = STATES.ATTACK;
          bug.stateTimer = 30;
          break;
        }
        if (bug.onGround && bug.jumpCooldown <= 0) {
          if (dy > 30 || Math.random() < 0.012) {
            bug.vy = BUG_JUMP_VEL;
            bug.onGround = false;
            bug.jumpCooldown = 60;
            bug.state = STATES.JUMP;
            bug.stateTimer = 40;
            break;
          }
        }
        if (dist > BUG_DETECT_RANGE * 2) {
          bug.state = STATES.WANDER;
          bug.stateTimer = 60;
        }
        break;

      case STATES.JUMP:
        bug.direction = dx > 0 ? 1 : -1;
        bug.vx = bug.direction * BUG_CHASE_SPEED * 0.7;
        if (bug.onGround || bug.stateTimer <= 0) {
          bug.state = dist < BUG_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
          bug.stateTimer = 30;
        }
        break;

      case STATES.ATTACK:
        bug.vx = 0;
        if (bug.stateTimer <= 0) {
          bug.state = dist < BUG_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
          bug.stateTimer = 40;
        }
        break;

      case STATES.HURT:
        bug.vx = 0;
        break;
    }
  }

  // draw a single bug
  function renderBug(ctx, bug, cam, H, frameTick) {
    const t = frameTick * 0.12 + bug.phase;

    const pulse = Math.sin(t) * 0.15;
    const pulse2 = Math.sin(t * 1.7 + 1.0) * 0.1;
    const scaleX = 1.0 + pulse;
    const scaleY = 1.0 - pulse * 0.5 + pulse2;

    const screenX = bug.x - cam;
    const screenY = H - bug.y - BUG_H;
    const cx = screenX + BUG_W / 2;
    const cy = screenY + BUG_H / 2;

    const isHurt = bug.hurtTimer > 0;
    const hurtFlash = isHurt && (Math.floor(bug.hurtTimer / 3) % 2 === 0);

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

    // scuttling legs
    ctx.save();
    ctx.strokeStyle = hurtFlash ? '#cc5522' : '#22aa22';
    ctx.lineWidth = 1;
    const legAnimSpeed = (bug.state === STATES.IDLE || bug.state === STATES.ATTACK) ? 0.6 : 3.0;
    for (let i = 0; i < 3; i++) {
      const legPhase = frameTick * legAnimSpeed * 0.12 + bug.phase + i * 2.1;
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

    if (bug.hp < bug.maxHP) {
      const barW = BUG_W + 4;
      const barH = 2;
      const barX = screenX - 2;
      const barY = screenY - 6;
      ctx.fillStyle = '#001a00';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#22aa22';
      ctx.fillRect(barX, barY, barW * (bug.hp / bug.maxHP), barH);
    }
  }

  // exported functions used by game.js
  return {
    maybeSpawn: function (bugs, playerX, lastSpawnTime, now) {
      if (bugs.length >= BUG_MAX_ALIVE) return lastSpawnTime;
      if (now - lastSpawnTime < BUG_SPAWN_INTERVAL) return lastSpawnTime;
      const side = Math.random() < 0.5 ? -1 : 1;
      const spawnX = playerX + side * (250 + Math.random() * 200);
      bugs.push(createBug(spawnX, 0));
      return now;
    },

    updateAll: function (bugs, playerX, playerBottom, squares, H, frameTick) {
      for (let i = bugs.length - 1; i >= 0; i--) {
        const b = bugs[i];
        if (b.hp <= 0) { bugs.splice(i, 1); continue; }

        updateAI(b, playerX, playerBottom);

        // world-space physics (y=0 ground, y+ up)
        b.vy -= BUG_GRAVITY;
        b.x += b.vx;
        b.y += b.vy;
        if (b.jumpCooldown > 0) b.jumpCooldown--;
        if (b.damageCooldown > 0) b.damageCooldown--;
        b.onGround = false;

        if (b.y <= 0) {
          b.y = 0;
          b.vy = 0;
          b.onGround = true;
        }

        // land on platforms (only when falling)
        if (b.vy <= 0) {
          for (const s of squares) {
            if (b.x + BUG_W > s.x && b.x < s.x + s.width) {
              const surfTop = s.y + s.height;
              if (b.y <= surfTop && b.y >= s.y && b.y - b.vy >= surfTop - 1) {
                b.y = surfTop;
                b.vy = 0;
                b.onGround = true;
              }
            }
          }
        }

        if (Math.abs(b.x - playerX) > 900) {
          bugs.splice(i, 1);
        }
      }
    },

    renderAll: function (ctx, bugs, cam, H, frameTick) {
      for (const b of bugs) {
        renderBug(ctx, b, cam, H, frameTick);
      }
    },

    checkPlayerCollision: function (bugs, playerX, playerBottom, charW, charH) {
      let totalDmg = 0;
      for (const b of bugs) {
        if (b.damageCooldown > 0) continue;
        if (playerX < b.x + BUG_W && playerX + charW > b.x &&
            playerBottom < b.y + BUG_H && playerBottom + charH > b.y) {
          totalDmg += BUG_DAMAGE;
          b.damageCooldown = BUG_DAMAGE_COOLDOWN;
          b.state = STATES.ATTACK;
          b.stateTimer = 20;
        }
      }
      return totalDmg;
    },

    swordHitBugs: function (bugs, pcx, pcy, range) {
      let kills = 0;
      for (const b of bugs) {
        const bcx = b.x + BUG_W / 2;
        const bcy = b.y + BUG_H / 2;
        const ddx = bcx - pcx, ddy = bcy - pcy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < range) {
          b.hp -= 10;
          b.hurtTimer = 15;
          b.state = STATES.HURT;
          if (d > 1) {
            b.x += (ddx / d) * 30;
            b.vy = 3;
          }
          if (b.hp <= 0) kills++;
        }
      }
      return kills;
    },
  };
})();

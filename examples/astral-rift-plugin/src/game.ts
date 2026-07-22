import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

import backgroundUrl from "../assets/cosmic-rift.webp";
import playerUrl from "../assets/player-ship.webp";
import bossUrl from "../assets/void-seraph.webp";

type Pattern = "aimed" | "spiral" | "ring" | "lances" | "collapse";
type CombatEffect = {
  view: Graphics | Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  drag: number;
  spin: number;
  grow: number;
};
type Bolt = { view: Graphics; x: number; y: number; vx: number; vy: number; damage: number; life: number };
type Orb = { view: Graphics; x: number; y: number; vx: number; vy: number; radius: number; damage: number; life: number; near: boolean };
type Laser = { view: Graphics; angle: number; time: number; hit: boolean };
type Star = { view: Graphics; x: number; y: number; speed: number; twinkle: number };

const previewSaves = new Map<string, unknown>();
const api = window.MobileTavernPlugin ?? {
  exit: async () => undefined,
  ready: async () => ({ apiVersion: 1 }),
  save: async (slot: string, data: unknown) => previewSaves.set(slot, structuredClone(data)),
  load: async (slot: string) => previewSaves.get(slot) ?? null,
};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const W = 1280;
const H = 720;
const app = new Application();
const scene = new Container();
const world = new Container();
const ambientLayer = new Container();
const trailLayer = new Container();
const dangerLayer = new Container();
const projectileLayer = new Container();
const actorLayer = new Container();
const fxLayer = new Container();
const stars: Star[] = [];
const effects: CombatEffect[] = [];
const bolts: Bolt[] = [];
const orbs: Orb[] = [];
const lasers: Laser[] = [];
const input = { x: 0, y: 0, active: false };

let background: Sprite;
let player: Sprite;
let boss: Sprite;
let playerGlow: Graphics;
let bossGlow: Graphics;
let bossHalo: Graphics;
let bossBaseScale = 1;
let ultimateBeam: Graphics;
let flash: Graphics;
let playing = false;
let paused = false;
let pausedByLifecycle = false;
let ending = false;
let victory = false;
let endingTimer = 0;
let elapsed = 0;
let playerX = 230;
let playerY = 360;
let playerHp = 100;
let playerInvulnerable = 0;
let dashTimer = 0;
let bossX = 1015;
let bossY = 360;
let bossHp = 2400;
let bossMaxHp = 2400;
let bossInvulnerable = 0;
let phase = 1;
let phaseTransition = 0;
let pattern: Pattern = "aimed";
let patternTimer = 150;
let shotTimer = 0;
let patternAngle = 0;
let score = 0;
let best = 0;
let combo = 0;
let comboWindow = 0;
let ultimateCharge = 0;
let ultimateTimer = 0;
let overdriveTimer = 0;
let overdriveCooldown = 0;
let dashCooldown = 0;
let fireTimer = 0;
let shake = 0;
let worldBaseX = 0;
let worldBaseY = 0;
let worldScale = 1;
let dialogueTimer = 0;
let audioContext: AudioContext | undefined;

const phaseLines = [
  ["虚空炽天使", "渺小的光，也敢穿过终焉？"],
  ["星梭", "神若挡在航线上——就击穿神。"],
  ["虚空炽天使", "展开第二翼。让群星学会恐惧。"],
  ["星梭", "能量越界。终焉协议，准备。"],
  ["虚空炽天使", "六翼归一。与这片宇宙一同沉没。"],
];

async function loadTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return Texture.from(image);
}

function createStarfield(): void {
  for (let index = 0; index < 120; index += 1) {
    const size = index % 11 === 0 ? 2.2 : .55 + Math.random() * 1.25;
    const view = new Graphics().circle(0, 0, size).fill({ color: index % 7 === 0 ? 0xc084ff : 0xbaf8ff, alpha: .28 + Math.random() * .65 });
    view.blendMode = "add";
    ambientLayer.addChild(view);
    stars.push({ view, x: Math.random() * W, y: Math.random() * H, speed: .18 + Math.random() * 1.5, twinkle: Math.random() * Math.PI * 2 });
  }
  for (let index = 0; index < 5; index += 1) {
    const ring = new Graphics().ellipse(0, 0, 170 + index * 34, 74 + index * 13).stroke({ color: index % 2 ? 0x44efff : 0xb14bff, width: 1.2, alpha: .08 + index * .012 });
    ring.position.set(1055, 315);
    ring.rotation = -.3 + index * .11;
    ring.label = `rift-${index}`;
    ring.blendMode = "add";
    ambientLayer.addChild(ring);
  }
}

function createActors(playerTexture: Texture, bossTexture: Texture): void {
  playerGlow = new Graphics().ellipse(0, 0, 86, 28).fill({ color: 0x42eaff, alpha: .2 });
  playerGlow.blendMode = "add";
  player = new Sprite(playerTexture);
  player.anchor.set(.5);
  player.width = 210;
  player.height = playerTexture.height / playerTexture.width * player.width;
  bossGlow = new Graphics().circle(0, 0, 155).fill({ color: 0xb427ff, alpha: .105 });
  bossGlow.blendMode = "add";
  bossHalo = new Graphics()
    .circle(0, 0, 178).stroke({ color: 0xd754ff, width: 2, alpha: .22 })
    .circle(0, 0, 202).stroke({ color: 0x5cecff, width: 1, alpha: .13 })
    .circle(0, 0, 225).stroke({ color: 0xa652ff, width: 1, alpha: .09 });
  bossHalo.blendMode = "add";
  boss = new Sprite(bossTexture);
  boss.anchor.set(.5);
  boss.width = 430;
  boss.height = bossTexture.height / bossTexture.width * boss.width;
  bossBaseScale = boss.scale.x;
  ultimateBeam = new Graphics();
  ultimateBeam.blendMode = "add";
  ultimateBeam.visible = false;
  actorLayer.addChild(playerGlow, player, bossGlow, bossHalo, boss);
  fxLayer.addChild(ultimateBeam);
  flash = new Graphics().rect(0, 0, W, H).fill({ color: 0xffffff });
  flash.alpha = 0;
  flash.blendMode = "add";
  fxLayer.addChild(flash);
}

function layout(): void {
  if (!background) return;
  const backgroundScale = Math.max(app.screen.width / background.texture.width, app.screen.height / background.texture.height);
  background.scale.set(backgroundScale);
  background.position.set(app.screen.width / 2, app.screen.height / 2);
  worldScale = Math.min(app.screen.width / W, app.screen.height / H);
  world.scale.set(worldScale);
  worldBaseX = (app.screen.width - W * worldScale) / 2;
  worldBaseY = (app.screen.height - H * worldScale) / 2;
  world.position.set(worldBaseX, worldBaseY);
}

function tone(frequency: number, duration: number, type: OscillatorType = "sine", volume = .035, slide = 0): void {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function particleBurst(x: number, y: number, color: number, count: number, speed = 7, size = 2.5): void {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = speed * (.25 + Math.random() * .85);
    const view = new Graphics().circle(0, 0, size * (.4 + Math.random())).fill({ color, alpha: .9 });
    view.position.set(x, y);
    view.blendMode = "add";
    fxLayer.addChild(view);
    effects.push({ view, life: 22 + Math.random() * 24, maxLife: 46, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, drag: .95, spin: 0, grow: -.008, });
  }
}

function shockwave(x: number, y: number, color: number, radius = 12, life = 34): void {
  const view = new Graphics().circle(0, 0, radius).stroke({ color, width: 3, alpha: .9 });
  view.position.set(x, y);
  view.blendMode = "add";
  fxLayer.addChild(view);
  effects.push({ view, life, maxLife: life, vx: 0, vy: 0, drag: 1, spin: 0, grow: .075 });
}

function afterimage(): void {
  const view = new Sprite(player.texture);
  view.anchor.set(.5);
  view.position.set(playerX, playerY);
  view.rotation = player.rotation;
  view.scale.copyFrom(player.scale);
  view.tint = dashTimer > 0 ? 0xb7ffff : 0x8d55ff;
  view.alpha = .34;
  view.blendMode = "add";
  trailLayer.addChild(view);
  effects.push({ view, life: 18, maxLife: 18, vx: -2.5, vy: 0, drag: .9, spin: 0, grow: -.008 });
}

function spawnBolt(offset = 0, angle = 0, damage = 5): void {
  const view = new Graphics()
    .roundRect(-19, -3, 38, 6, 3).fill({ color: 0x9dffff, alpha: .95 })
    .roundRect(-28, -7, 56, 14, 7).fill({ color: 0x3cecff, alpha: .12 });
  view.blendMode = "add";
  view.position.set(playerX + 74, playerY + offset);
  projectileLayer.addChild(view);
  const speed = overdriveTimer > 0 ? 24 : 20;
  bolts.push({ view, x: view.x, y: view.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage, life: 90 });
}

function spawnOrb(angle: number, speed: number, radius = 7, damage = 12, color = 0xe34cff): void {
  const view = new Graphics()
    .circle(0, 0, radius * 2.5).fill({ color, alpha: .1 })
    .circle(0, 0, radius).fill({ color, alpha: .95 })
    .circle(-radius * .25, -radius * .25, radius * .28).fill({ color: 0xffffff, alpha: .9 });
  view.blendMode = "add";
  view.position.set(bossX, bossY);
  projectileLayer.addChild(view);
  orbs.push({ view, x: bossX, y: bossY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius, damage, life: 360, near: false });
}

function aimedAngle(): number {
  return Math.atan2(playerY - bossY, playerX - bossX);
}

function createLaser(angle = aimedAngle()): void {
  const view = new Graphics();
  view.position.set(bossX, bossY);
  view.blendMode = "add";
  dangerLayer.addChild(view);
  lasers.push({ view, angle, time: 92, hit: false });
  $("warning").classList.add("visible");
  tone(130, .75, "sawtooth", .025, 90);
}

function setPattern(next?: Pattern): void {
  const pools: Record<number, Pattern[]> = {
    1: ["aimed", "spiral", "ring"],
    2: ["aimed", "spiral", "ring", "lances"],
    3: ["spiral", "ring", "lances", "collapse"],
  };
  pattern = next ?? pools[phase][Math.floor(Math.random() * pools[phase].length)];
  patternTimer = pattern === "spiral" ? 190 : pattern === "collapse" ? 220 : 160;
  shotTimer = 0;
  $("intent").textContent = ({ aimed: "追光", spiral: "螺旋葬仪", ring: "星环崩落", lances: "裁决射线", collapse: "终焉坍缩" } as Record<Pattern, string>)[pattern];
}

function updatePattern(delta: number): void {
  if (bossInvulnerable > 0 || phaseTransition > 0) return;
  patternTimer -= delta;
  shotTimer -= delta;
  if (pattern === "aimed" && shotTimer <= 0) {
    const center = aimedAngle();
    const count = phase === 3 ? 7 : 5;
    for (let index = 0; index < count; index += 1) spawnOrb(center + (index - (count - 1) / 2) * .13, 4.2 + phase * .45, 7, 11 + phase);
    shotTimer = phase === 3 ? 30 : 42;
    tone(95, .12, "square", .012, -24);
  }
  if (pattern === "spiral" && shotTimer <= 0) {
    patternAngle += .2 + phase * .025;
    spawnOrb(patternAngle, 3.2 + phase * .35, 6, 10, 0xd757ff);
    spawnOrb(patternAngle + Math.PI, 3.2 + phase * .35, 6, 10, 0x8f68ff);
    if (phase === 3) spawnOrb(-patternAngle * .72, 3.8, 5, 9, 0xff3dba);
    shotTimer = phase === 3 ? 3.5 : 5;
  }
  if (pattern === "ring" && shotTimer <= 0) {
    const count = phase === 1 ? 18 : phase === 2 ? 24 : 30;
    const offset = patternAngle += .14;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count + offset;
      if (Math.abs(normalizeAngle(angle - aimedAngle())) < .16) continue;
      spawnOrb(angle, 3 + phase * .34, phase === 3 ? 6 : 7, 10 + phase);
    }
    shockwave(bossX, bossY, 0xec66ff, 46, 45);
    shotTimer = phase === 3 ? 52 : 66;
  }
  if (pattern === "lances" && shotTimer <= 0) {
    createLaser();
    if (phase === 3) createLaser(aimedAngle() + (Math.random() > .5 ? .36 : -.36));
    shotTimer = phase === 3 ? 82 : 108;
  }
  if (pattern === "collapse" && shotTimer <= 0) {
    const center = aimedAngle();
    for (let index = -3; index <= 3; index += 1) spawnOrb(center + index * .105, 5.3, 7, 13, index % 2 ? 0xff4fbd : 0xa966ff);
    for (let index = 0; index < 18; index += 1) spawnOrb(patternAngle + index * Math.PI * 2 / 18, 2.7, 5, 9, 0x714dff);
    patternAngle += .22;
    shotTimer = 58;
    shake = Math.max(shake, 6);
  }
  if (patternTimer <= 0) setPattern();
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function distanceToRay(px: number, py: number, ox: number, oy: number, angle: number): number {
  const dx = px - ox;
  const dy = py - oy;
  const projection = dx * Math.cos(angle) + dy * Math.sin(angle);
  if (projection < 0 || projection > 1700) return 9999;
  return Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));
}

function updateLasers(delta: number): void {
  for (let index = lasers.length - 1; index >= 0; index -= 1) {
    const laser = lasers[index];
    laser.time -= delta;
    laser.view.clear();
    laser.view.position.set(bossX, bossY);
    const active = laser.time <= 28;
    if (active) {
      const pulse = 28 + Math.sin(laser.time * .9) * 8;
      laser.view
        .moveTo(0, 0).lineTo(1700, 0).stroke({ color: 0xff3bd8, width: pulse + 24, alpha: .11 })
        .moveTo(0, 0).lineTo(1700, 0).stroke({ color: 0xd652ff, width: pulse, alpha: .68 })
        .moveTo(0, 0).lineTo(1700, 0).stroke({ color: 0xffffff, width: 5, alpha: .95 });
      if (!laser.hit && distanceToRay(playerX, playerY, bossX, bossY, laser.angle) < 25) {
        laser.hit = true;
        damagePlayer(24);
      }
      shake = Math.max(shake, 2.4);
    } else {
      const alpha = .25 + Math.sin(laser.time * .55) * .2;
      laser.view.moveTo(0, 0).lineTo(1700, 0).stroke({ color: 0xff5ddf, width: 2, alpha });
    }
    laser.view.rotation = laser.angle;
    if (laser.time <= 0) {
      laser.view.destroy();
      lasers.splice(index, 1);
    }
  }
  if (!lasers.some((laser) => laser.time > 28)) $("warning").classList.remove("visible");
}

function updateProjectiles(delta: number): void {
  for (let index = bolts.length - 1; index >= 0; index -= 1) {
    const bolt = bolts[index];
    bolt.x += bolt.vx * delta;
    bolt.y += bolt.vy * delta;
    bolt.life -= delta;
    bolt.view.position.set(bolt.x, bolt.y);
    bolt.view.rotation = Math.atan2(bolt.vy, bolt.vx);
    if (Math.hypot(bolt.x - bossX, bolt.y - bossY) < 128 && bossInvulnerable <= 0) {
      damageBoss(bolt.damage, bolt.x, bolt.y);
      bolt.life = 0;
    }
    if (bolt.life <= 0 || bolt.x > W + 70 || bolt.y < -50 || bolt.y > H + 50) {
      bolt.view.destroy();
      bolts.splice(index, 1);
    }
  }
  for (let index = orbs.length - 1; index >= 0; index -= 1) {
    const orb = orbs[index];
    orb.x += orb.vx * delta;
    orb.y += orb.vy * delta;
    orb.life -= delta;
    orb.view.position.set(orb.x, orb.y);
    orb.view.rotation += .04 * delta;
    const distance = Math.hypot(orb.x - playerX, orb.y - playerY);
    if (distance < orb.radius + 23) {
      if (playerInvulnerable > 0) {
        particleBurst(orb.x, orb.y, 0x8effff, 7, 4, 2);
        score += 30;
      } else {
        damagePlayer(orb.damage);
      }
      orb.life = 0;
    } else if (!orb.near && distance < 47) {
      orb.near = true;
      score += 80;
      combo = Math.min(120, combo + 2);
      comboWindow = 170;
      ultimateCharge = Math.min(100, ultimateCharge + 2.4);
      shockwave(playerX, playerY, 0x58f7ff, 16, 18);
    }
    if (orb.life <= 0 || orb.x < -80 || orb.x > W + 80 || orb.y < -80 || orb.y > H + 80) {
      orb.view.destroy();
      orbs.splice(index, 1);
    }
  }
}

function damageBoss(amount: number, x: number, y: number): void {
  if (bossInvulnerable > 0 || ending) return;
  bossHp = Math.max(0, bossHp - amount);
  combo = Math.min(120, combo + 1);
  comboWindow = 190;
  const multiplier = Math.min(8, 1 + combo / 20);
  score += Math.round(12 * multiplier);
  ultimateCharge = Math.min(100, ultimateCharge + amount * .045);
  if (Math.random() < .34) particleBurst(x, y, Math.random() > .45 ? 0x79f7ff : 0xf05cff, 3, 3.2, 1.7);
  if (bossHp <= bossMaxHp * .66 && phase === 1) enterPhase(2);
  if (bossHp <= bossMaxHp * .32 && phase === 2) enterPhase(3);
  if (bossHp <= 0) beginEnding(true);
}

function damagePlayer(amount: number): void {
  if (playerInvulnerable > 0 || ending) return;
  playerHp = Math.max(0, playerHp - amount);
  playerInvulnerable = 64;
  combo = 0;
  comboWindow = 0;
  ultimateCharge = Math.min(100, ultimateCharge + 12);
  particleBurst(playerX, playerY, 0x68eeff, 28, 8, 3);
  shockwave(playerX, playerY, 0xff6ddc, 18, 30);
  shake = 13;
  flash.alpha = .48;
  tone(72, .34, "sawtooth", .055, -40);
  showDialogue("星梭", playerHp > 0 ? "装甲破损。航线不变。" : "光……还没有熄灭。", 150);
  if (playerHp <= 0) beginEnding(false);
}

function enterPhase(next: number): void {
  phase = next;
  phaseTransition = 150;
  bossInvulnerable = 120;
  clearEnemyProjectiles();
  $("phase-name").textContent = next === 2 ? "万象蚀灭" : "六翼归一";
  $("phase-banner").classList.remove("visible");
  void $("phase-banner").offsetWidth;
  $("phase-banner").classList.add("visible");
  showDialogue(phaseLines[next + 1][0], phaseLines[next + 1][1], 260);
  particleBurst(bossX, bossY, next === 2 ? 0x974fff : 0xff43db, 70, 12, 4);
  for (let ring = 0; ring < 4; ring += 1) shockwave(bossX, bossY, ring % 2 ? 0x5ceeff : 0xe44fff, 45 + ring * 20, 48 + ring * 8);
  shake = 18;
  flash.alpha = .6;
  tone(next === 2 ? 90 : 62, 1.1, "sawtooth", .055, next === 2 ? 220 : 480);
  setPattern(next === 3 ? "collapse" : "lances");
}

function clearEnemyProjectiles(): void {
  for (const orb of orbs) {
    particleBurst(orb.x, orb.y, 0x8e6dff, 2, 2.5, 1.5);
    orb.view.destroy();
  }
  orbs.length = 0;
  for (const laser of lasers) laser.view.destroy();
  lasers.length = 0;
  $("warning").classList.remove("visible");
}

function activateOverdrive(): void {
  if (!playing || paused || ending || overdriveCooldown > 0) return;
  overdriveTimer = 300;
  overdriveCooldown = 720;
  particleBurst(playerX, playerY, 0x75f8ff, 34, 9, 2.6);
  shockwave(playerX, playerY, 0x6cf8ff, 28, 38);
  showDialogue("星梭", "脉冲增幅，全部解锁。", 140);
  tone(260, .55, "sawtooth", .045, 620);
}

function activateDash(): void {
  if (!playing || paused || ending || dashCooldown > 0) return;
  dashTimer = 30;
  dashCooldown = 230;
  playerInvulnerable = Math.max(playerInvulnerable, 48);
  const directionX = Math.abs(input.x) + Math.abs(input.y) > .15 ? input.x : 1;
  const directionY = Math.abs(input.x) + Math.abs(input.y) > .15 ? input.y : 0;
  playerX = Math.max(70, Math.min(870, playerX + directionX * 120));
  playerY = Math.max(105, Math.min(625, playerY + directionY * 120));
  afterimage();
  shockwave(playerX, playerY, 0xa985ff, 22, 30);
  for (const orb of orbs) if (Math.hypot(orb.x - playerX, orb.y - playerY) < 115) orb.life = 0;
  tone(520, .22, "triangle", .04, -320);
}

function activateUltimate(): void {
  if (!playing || paused || ending || ultimateCharge < 100 || ultimateTimer > 0) return;
  ultimateCharge = 0;
  ultimateTimer = 155;
  playerInvulnerable = 175;
  clearEnemyProjectiles();
  ultimateBeam.visible = true;
  showDialogue("星梭", "终焉协议——把宇宙，重新点亮。", 220);
  $("phase-name").textContent = "奇点贯穿";
  $("phase-banner").classList.remove("visible");
  void $("phase-banner").offsetWidth;
  $("phase-banner").classList.add("visible");
  shake = 18;
  flash.alpha = .8;
  tone(88, 1.45, "sawtooth", .065, 880);
}

function updatePlayer(delta: number): void {
  const speed = dashTimer > 0 ? 15 : 6.3;
  playerX += input.x * speed * delta;
  playerY += input.y * speed * delta;
  playerX = Math.max(72, Math.min(870, playerX));
  playerY = Math.max(100, Math.min(625, playerY));
  player.position.set(playerX, playerY);
  playerGlow.position.set(playerX - 36, playerY);
  playerGlow.scale.set(1 + Math.sin(elapsed * .18) * .12, .75 + Math.abs(input.x) * .25);
  const targetRotation = input.y * .19;
  player.rotation += (targetRotation - player.rotation) * .16 * delta;
  player.alpha = playerInvulnerable > 0 && Math.floor(playerInvulnerable / 4) % 2 === 0 ? .5 : 1;
  if ((Math.abs(input.x) + Math.abs(input.y) > .12 || dashTimer > 0) && Math.floor(elapsed) % (dashTimer > 0 ? 2 : 5) === 0) afterimage();
  fireTimer -= delta;
  if (fireTimer <= 0 && phaseTransition < 118) {
    if (overdriveTimer > 0) {
      spawnBolt(-18, -.045, 5.2);
      spawnBolt(0, 0, 6.2);
      spawnBolt(18, .045, 5.2);
      fireTimer = 3.2;
    } else {
      spawnBolt(-8, 0, 5.3);
      spawnBolt(8, 0, 5.3);
      fireTimer = 7;
    }
  }
  if (ultimateTimer > 0) updateUltimate(delta);
}

function updateUltimate(delta: number): void {
  ultimateTimer = Math.max(0, ultimateTimer - delta);
  const fade = Math.min(1, ultimateTimer / 18, (155 - ultimateTimer) / 18);
  const width = 54 + Math.sin(ultimateTimer * .55) * 12;
  ultimateBeam.clear()
    .moveTo(playerX + 55, playerY).lineTo(W + 100, playerY).stroke({ color: 0x4defff, width: width + 62, alpha: .08 * fade })
    .moveTo(playerX + 55, playerY).lineTo(W + 100, playerY).stroke({ color: 0x965cff, width: width + 22, alpha: .44 * fade })
    .moveTo(playerX + 55, playerY).lineTo(W + 100, playerY).stroke({ color: 0xa9ffff, width, alpha: .86 * fade })
    .moveTo(playerX + 55, playerY).lineTo(W + 100, playerY).stroke({ color: 0xffffff, width: 9, alpha: fade });
  if (Math.abs(playerY - bossY) < 138) damageBoss(4.6 * delta, bossX - 105, bossY + (Math.random() - .5) * 120);
  if (Math.floor(ultimateTimer) % 4 === 0) particleBurst(bossX - 90, playerY + (Math.random() - .5) * width, Math.random() > .5 ? 0x56efff : 0xeb5cff, 3, 7, 2.5);
  shake = Math.max(shake, 5.5);
  if (ultimateTimer <= 0) ultimateBeam.visible = false;
}

function updateBoss(delta: number): void {
  const motion = phaseTransition > 0 ? .25 : 1;
  bossY = 350 + Math.sin(elapsed * (.012 + phase * .002)) * (phase === 3 ? 74 : 48) * motion;
  bossX = 1015 + Math.cos(elapsed * .009) * 24;
  const pulse = 1 + Math.sin(elapsed * .08) * .025 + (phaseTransition > 0 ? Math.sin(phaseTransition * .3) * .08 : 0);
  boss.position.set(bossX, bossY);
  boss.scale.set(bossBaseScale * pulse);
  boss.rotation += (phase === 3 ? .0026 : .0008) * delta;
  bossGlow.position.set(bossX, bossY);
  bossGlow.scale.set(1.05 + Math.sin(elapsed * .06) * .14);
  bossGlow.alpha = .09 + phase * .045;
  bossHalo.position.set(bossX, bossY);
  bossHalo.rotation -= (.002 + phase * .0015) * delta;
  bossHalo.scale.set(1 + Math.sin(elapsed * .04) * .04);
  if (phaseTransition > 0 && Math.floor(phaseTransition) % 5 === 0) particleBurst(bossX + (Math.random() - .5) * 220, bossY + (Math.random() - .5) * 220, phase === 2 ? 0x8f5dff : 0xff4fd7, 2, 5, 2);
}

function updateAmbient(delta: number): void {
  for (const star of stars) {
    star.x -= star.speed * delta * (1 + phase * .2);
    star.twinkle += .035 * delta;
    if (star.x < -8) { star.x = W + Math.random() * 80; star.y = Math.random() * H; }
    star.view.position.set(star.x, star.y);
    star.view.alpha = .25 + (Math.sin(star.twinkle) + 1) * .3;
  }
  for (const child of ambientLayer.children) {
    if (child.label?.startsWith("rift-")) child.rotation += .0007 * (Number(child.label.slice(-1)) % 2 ? 1 : -1) * delta;
  }
}

function updateEffects(delta: number): void {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    effect.life -= delta;
    effect.vx *= Math.pow(effect.drag, delta);
    effect.vy *= Math.pow(effect.drag, delta);
    effect.view.x += effect.vx * delta;
    effect.view.y += effect.vy * delta;
    effect.view.rotation += effect.spin * delta;
    const alpha = Math.max(0, effect.life / effect.maxLife);
    effect.view.alpha = Math.min(effect.view.alpha, alpha);
    if (effect.grow !== 0) effect.view.scale.x = effect.view.scale.y = Math.max(.02, effect.view.scale.x + effect.grow * delta);
    if (effect.life <= 0) {
      effect.view.destroy();
      effects.splice(index, 1);
    }
  }
  flash.alpha *= Math.pow(.82, delta);
}

function showDialogue(speaker: string, text: string, hold = 220): void {
  $("dialogue").querySelector("span")!.textContent = speaker;
  $("dialogue-text").textContent = text;
  $("dialogue").classList.add("visible");
  dialogueTimer = hold;
}

function updateHud(): void {
  $("player-hp").style.width = `${playerHp}%`;
  $("boss-hp").style.width = `${bossHp / bossMaxHp * 100}%`;
  $("phase").textContent = `PHASE 0${phase}`;
  $("timer").textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}`;
  $("score").textContent = String(Math.floor(score)).padStart(6, "0");
  const multiplier = Math.min(8, 1 + combo / 20);
  $("combo").textContent = `×${multiplier.toFixed(1)}  ${combo ? `${combo} HIT` : "SYNC"}`;
  $("status").textContent = playerInvulnerable > 0 ? "相位偏移" : overdriveTimer > 0 ? "脉冲超载" : playerHp < 35 ? "装甲临界" : "核心稳定";
  const rank = score > 90000 ? "SSS" : score > 60000 ? "SS" : score > 38000 ? "S" : score > 22000 ? "A" : score > 9000 ? "B" : "C";
  $("rank").textContent = `RANK ${rank}`;
  $("ultimate-charge").textContent = ultimateCharge >= 100 ? "READY" : `${Math.floor(ultimateCharge)}%`;
  $("ultimate").classList.toggle("ready", ultimateCharge >= 100);
  $("ultimate").toggleAttribute("disabled", ultimateCharge < 100 || ultimateTimer > 0);
  setCooldown("overdrive", overdriveCooldown, 720);
  setCooldown("dash", dashCooldown, 230);
}

function setCooldown(id: string, value: number, maximum: number): void {
  const button = $<HTMLButtonElement>(id);
  button.toggleAttribute("disabled", value > 0);
  const fill = button.querySelector("i") as HTMLElement;
  fill.style.height = `${value > 0 ? (1 - value / maximum) * 100 : 100}%`;
}

function beginEnding(won: boolean): void {
  if (ending) return;
  ending = true;
  victory = won;
  endingTimer = 130;
  playerInvulnerable = 999;
  clearEnemyProjectiles();
  if (won) {
    bossInvulnerable = 999;
    for (let index = 0; index < 7; index += 1) {
      window.setTimeout(() => {
        if (!ending) return;
        const x = bossX + (Math.random() - .5) * 230;
        const y = bossY + (Math.random() - .5) * 230;
        particleBurst(x, y, index % 2 ? 0x6ff7ff : 0xf04cff, 32, 12, 4);
        shockwave(x, y, index % 2 ? 0xa8ffff : 0xff82e9, 24, 42);
        shake = 16;
      }, index * 95);
    }
    showDialogue("虚空炽天使", "原来……光也有重量。", 260);
    tone(48, 1.8, "sawtooth", .07, 720);
  } else {
    particleBurst(playerX, playerY, 0x73f4ff, 70, 14, 4);
    player.visible = false;
  }
}

function finishEnding(): void {
  playing = false;
  best = Math.max(best, Math.floor(score));
  void api.save("astral-record", { best });
  $("result-kicker").textContent = victory ? "MISSION COMPLETE" : "SIGNAL LOST";
  $("result-title").textContent = victory ? "奇点，已贯穿。" : "星光暂时熄灭。";
  $("result-copy").textContent = victory
    ? `最终得分 ${Math.floor(score).toLocaleString()}。虚空炽天使已从这条时间线中抹除。`
    : `本次同步得分 ${Math.floor(score).toLocaleString()}。记录航线，再次点燃星核。`;
  $("result-screen").classList.add("visible");
}

function clearCombat(): void {
  for (const bolt of bolts) bolt.view.destroy();
  for (const orb of orbs) orb.view.destroy();
  for (const laser of lasers) laser.view.destroy();
  for (const effect of effects) effect.view.destroy();
  bolts.length = 0;
  orbs.length = 0;
  lasers.length = 0;
  effects.length = 0;
  $("warning").classList.remove("visible");
}

function reset(): void {
  clearCombat();
  elapsed = 0;
  playerX = 225;
  playerY = 360;
  playerHp = 100;
  playerInvulnerable = 120;
  dashTimer = 0;
  bossX = 1015;
  bossY = 360;
  bossHp = bossMaxHp = 2400;
  bossInvulnerable = 95;
  phase = 1;
  phaseTransition = 90;
  patternAngle = 0;
  score = 0;
  combo = 0;
  comboWindow = 0;
  ultimateCharge = 0;
  ultimateTimer = 0;
  overdriveTimer = 0;
  overdriveCooldown = 0;
  dashCooldown = 0;
  fireTimer = 18;
  shake = 0;
  dialogueTimer = 0;
  ending = false;
  endingTimer = 0;
  playing = true;
  paused = false;
  player.visible = true;
  boss.visible = true;
  boss.alpha = 1;
  boss.rotation = 0;
  boss.scale.set(bossBaseScale);
  ultimateBeam.visible = false;
  $("start-screen").classList.remove("visible");
  $("result-screen").classList.remove("visible");
  $("pause").textContent = "Ⅱ";
  setPattern("aimed");
  showDialogue(phaseLines[0][0], phaseLines[0][1], 250);
  updateHud();
}

function bindControls(): void {
  const joystick = $("joystick");
  const stick = $("stick");
  const update = (event: PointerEvent) => {
    const bounds = joystick.getBoundingClientRect();
    const dx = event.clientX - bounds.left - bounds.width / 2;
    const dy = event.clientY - bounds.top - bounds.height / 2;
    const limit = bounds.width * .29;
    const distance = Math.min(limit, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    input.x = Math.cos(angle) * distance / limit;
    input.y = Math.sin(angle) * distance / limit;
    stick.style.transform = `translate(${input.x * limit}px, ${input.y * limit}px)`;
  };
  joystick.addEventListener("pointerdown", (event) => {
    joystick.setPointerCapture(event.pointerId);
    input.active = true;
    update(event);
  });
  joystick.addEventListener("pointermove", (event) => { if (input.active) update(event); });
  const release = () => {
    input.active = false;
    input.x = 0;
    input.y = 0;
    stick.style.transform = "";
  };
  joystick.addEventListener("pointerup", release);
  joystick.addEventListener("pointercancel", release);
  $("overdrive").addEventListener("pointerdown", activateOverdrive);
  $("dash").addEventListener("pointerdown", activateDash);
  $("ultimate").addEventListener("pointerdown", activateUltimate);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Shift") activateDash();
    if (event.key.toLowerCase() === "e") activateOverdrive();
    if (event.key === " ") activateUltimate();
  });
}

async function boot(): Promise<void> {
  await app.init({ resizeTo: window, preference: "webgl", backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
  $("pixi-stage").appendChild(app.canvas);
  app.stage.addChild(scene);
  const [backgroundTexture, playerTexture, bossTexture] = await Promise.all([loadTexture(backgroundUrl), loadTexture(playerUrl), loadTexture(bossUrl)]);
  background = new Sprite(backgroundTexture);
  background.anchor.set(.5);
  scene.addChild(background, world);
  world.addChild(ambientLayer, trailLayer, dangerLayer, projectileLayer, actorLayer, fxLayer);
  createStarfield();
  createActors(playerTexture, bossTexture);
  layout();
  window.addEventListener("resize", layout);
  bindControls();

  $("start").addEventListener("click", () => {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    reset();
    tone(120, .8, "sawtooth", .045, 480);
  });
  $("restart").addEventListener("click", reset);
  $("leave").addEventListener("click", () => void api.exit());
  $("pause").addEventListener("click", () => {
    paused = !paused;
    $("pause").textContent = paused ? "▶" : "Ⅱ";
  });

  app.ticker.add((ticker) => {
    const delta = Math.min(ticker.deltaTime, 2);
    updateAmbient(delta);
    updateEffects(delta);
    shake *= Math.pow(.82, delta);
    world.position.set(worldBaseX + (Math.random() - .5) * shake * worldScale, worldBaseY + (Math.random() - .5) * shake * worldScale);
    if (!playing || paused || pausedByLifecycle) return;
    elapsed += delta;
    playerInvulnerable = Math.max(0, playerInvulnerable - delta);
    bossInvulnerable = Math.max(0, bossInvulnerable - delta);
    phaseTransition = Math.max(0, phaseTransition - delta);
    dashTimer = Math.max(0, dashTimer - delta);
    dashCooldown = Math.max(0, dashCooldown - delta);
    overdriveTimer = Math.max(0, overdriveTimer - delta);
    overdriveCooldown = Math.max(0, overdriveCooldown - delta);
    comboWindow = Math.max(0, comboWindow - delta);
    if (comboWindow <= 0) combo = Math.max(0, combo - delta * .35);
    dialogueTimer = Math.max(0, dialogueTimer - delta);
    if (dialogueTimer <= 0) $("dialogue").classList.remove("visible");

    if (ending) {
      endingTimer -= delta;
      boss.alpha = victory ? Math.max(0, endingTimer / 130) : boss.alpha;
      boss.scale.x += .004 * delta;
      boss.scale.y += .004 * delta;
      if (endingTimer <= 0) finishEnding();
      updateHud();
      return;
    }

    updatePlayer(delta);
    updateBoss(delta);
    updatePattern(delta);
    updateLasers(delta);
    updateProjectiles(delta);
    updateHud();
  });

  window.addEventListener("mobile-tavern:lifecycle", ((event: CustomEvent<"pause" | "resume">) => {
    pausedByLifecycle = event.detail === "pause";
    if (pausedByLifecycle) void api.save("astral-checkpoint", { score: Math.floor(score), phase, playerHp });
  }) as EventListener);

  best = ((await api.load("astral-record")) as { best?: number } | null)?.best ?? 0;
  $("record").textContent = best ? `最高同步记录 ${best.toLocaleString()}` : "尚无作战记录";
  await api.ready();
  document.documentElement.dataset.pixiReady = "true";
}

void boot();

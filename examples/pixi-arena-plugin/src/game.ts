import "pixi.js/unsafe-eval";
import { Application, Container, Graphics } from "pixi.js";

type Fighter = {
  root: Container;
  body: Graphics;
  sword: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  hp: number;
  posture: number;
  flash: number;
  trail: number;
};
type Effect = { view: Graphics; life: number; vx: number; vy: number; scale: number };

const previewSaves = new Map<string, unknown>();
const api = window.MobileTavernPlugin ?? {
  exit: () => undefined,
  ready: async () => ({ apiVersion: 1 }),
  save: async (slot: string, data: unknown) => previewSaves.set(slot, structuredClone(data)),
  load: async (slot: string) => previewSaves.get(slot) ?? null,
};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new Application();
const world = new Container();
const stage = new Container();
const effects: Effect[] = [];
const input = { x: 0, y: 0, active: false };
let player: Fighter;
let master: Fighter;
let playing = false;
let paused = false;
let elapsed = 0;
let score = 0;
let best = 0;
let attackTimer = 0;
let combo = 0;
let dashTimer = 0;
let dashCooldown = 0;
let parryTimer = 0;
let parryCooldown = 0;
let enemyPhase: "observe" | "telegraph" | "lunge" | "recover" = "observe";
let enemyTimer = 100;
let dialogueTimer = 0;
let pausedByLifecycle = false;

function makeFighter(color: number, accent: number, isMaster = false): Fighter {
  const root = new Container();
  const body = new Graphics();
  const sword = new Graphics();
  const aura = new Graphics().circle(0, 9, 23).fill({ color: isMaster ? 0xbc4e3c : 0x648d72, alpha: .13 });
  body.roundRect(-14, -25, 28, 46, 8).fill({ color }).poly([-22, 18, 0, 38, 22, 18, 13, 10, -13, 10]).fill({ color: accent });
  body.circle(0, -34, 10).fill({ color: 0xe7c39b }).poly([-15, -42, 0, -57, 15, -42, 8, -35, -8, -35]).fill({ color: isMaster ? 0xe4e0cf : 0x182c29 });
  body.moveTo(-8, -8).lineTo(-29, 10).stroke({ color: accent, width: 5, alpha: .75 });
  sword.moveTo(8, -10).lineTo(46, -34).stroke({ color: 0xf5edd0, width: 3 }).moveTo(8, -10).lineTo(46, -34).stroke({ color: 0xffffff, width: 1 });
  root.addChild(aura, body, sword);
  world.addChild(root);
  return { root, body, sword, x: 0, y: 0, vx: 0, vy: 0, face: 1, hp: 100, posture: 0, flash: 0, trail: 0 };
}

function drawArena() {
  const backdrop = new Graphics().rect(-900, -650, 2600, 1700).fill({ color: 0x081310 });
  backdrop.rect(-900, -650, 2600, 510).fill({ color: 0x112b25, alpha: .9 });
  backdrop.rect(-900, 300, 2600, 750).fill({ color: 0x0d1c18 });
  world.addChild(backdrop);
  for (let index = 0; index < 34; index += 1) {
    const x = -700 + index * 76 + (index % 3) * 19;
    const height = 340 + (index % 7) * 45;
    const bamboo = new Graphics();
    bamboo.moveTo(x, 360).lineTo(x + (index % 2 ? -35 : 35), 360 - height).stroke({ color: index % 2 ? 0x1b4437 : 0x173a31, width: 13, alpha: .88 });
    for (let joint = 1; joint < 5; joint += 1) bamboo.moveTo(x - 7, 360 - joint * height / 5).lineTo(x + 7, 360 - joint * height / 5).stroke({ color: 0x547661, width: 2, alpha: .5 });
    const leafX = x + (index % 2 ? -28 : 28);
    bamboo.ellipse(leafX, 360 - height * .62, 55, 10).fill({ color: 0x345d46, alpha: .8 }).ellipse(leafX + 24, 360 - height * .7, 43, 8).fill({ color: 0x244a38, alpha: .8 });
    world.addChild(bamboo);
  }
  const bridge = new Graphics().ellipse(350, 350, 760, 185).fill({ color: 0x12211c, alpha: .9 }).ellipse(350, 333, 620, 128).fill({ color: 0x20352b, alpha: .55 });
  for (let plank = 0; plank < 19; plank += 1) bridge.moveTo(-210 + plank * 61, 255).lineTo(-225 + plank * 61, 405).stroke({ color: 0x48604d, width: 1, alpha: .45 });
  world.addChild(bridge);
}

function rain() {
  const layer = new Container();
  for (let index = 0; index < 105; index += 1) {
    const drop = new Graphics().moveTo(0, 0).lineTo(-5, 22).stroke({ color: 0xa8d7ce, width: 1, alpha: .3 + (index % 4) * .08 });
    drop.position.set(-700 + Math.random() * 2100, -600 + Math.random() * 1150);
    drop.label = String(2 + Math.random() * 4);
    layer.addChild(drop);
  }
  world.addChild(layer);
  return layer;
}

function spark(x: number, y: number, color: number, count = 12, strong = false) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const view = new Graphics().circle(0, 0, strong ? 3 : 1.7 + Math.random() * 1.5).fill({ color });
    view.position.set(x, y); world.addChild(view);
    effects.push({ view, life: 1, vx: Math.cos(angle) * (strong ? 6 : 2 + Math.random() * 3), vy: Math.sin(angle) * (strong ? 6 : 2 + Math.random() * 3), scale: 1 });
  }
}

function slash(x: number, y: number, face: number, color: number, big = false) {
  const view = new Graphics().arc(0, 0, big ? 78 : 48, face > 0 ? -.9 : Math.PI - .9, face > 0 ? 1.3 : Math.PI + 1.3).stroke({ color, width: big ? 8 : 5, alpha: .94 });
  view.position.set(x, y); world.addChild(view); effects.push({ view, life: .48, vx: 0, vy: 0, scale: big ? 1.35 : 1.12 });
}

function screenShake(power = 7) { stage.x = (Math.random() - .5) * power; stage.y = (Math.random() - .5) * power; }
function distance(a: Fighter, b: Fighter) { return Math.hypot(a.x - b.x, a.y - b.y); }
function say(speaker: string, text: string) { $("speech").querySelector(".speaker")!.textContent = speaker; $("speech-text").textContent = text; dialogueTimer = 240; }

function updateHud() {
  $("player-hp").style.width = `${Math.max(0, player.hp)}%`;
  $("boss-hp").style.width = `${Math.max(0, master.hp)}%`;
  $("player-posture").textContent = dashCooldown > 0 ? `轻功回气 ${Math.ceil(dashCooldown / 12)}` : `气势 ${Math.round(player.hp)}`;
  $("boss-posture").textContent = master.posture > 0 ? `破绽 ${Math.round(master.posture)}` : "气势如山";
  const seconds = Math.floor(elapsed / 60); $("timer").textContent = `00:${String(seconds).padStart(2, "0")}`;
  const labels = { observe: "观势", telegraph: "孤鸿落", lunge: "剑啸", recover: "收剑" };
  $("intent").textContent = labels[enemyPhase];
  $("intent-bar").style.transform = `scaleX(${enemyPhase === "telegraph" ? Math.min(1, enemyTimer / 75) : enemyPhase === "lunge" ? 1 : .12})`;
  $("attack").classList.toggle("cooldown", attackTimer > 0);
  $("dash").classList.toggle("cooldown", dashCooldown > 0);
  $("parry").classList.toggle("cooldown", parryCooldown > 0);
}

function hit(target: Fighter, amount: number, posture = 0) {
  target.hp = Math.max(0, target.hp - amount); target.posture = Math.min(100, target.posture + posture); target.flash = 8;
  spark(target.x, target.y - 15, target === master ? 0xf2c171 : 0xd9e8c1, 15, true); screenShake(9); updateHud();
  if (target.hp <= 0) finish(target === master);
}

function startAttack() {
  if (!playing || paused || attackTimer > 0 || dashTimer > 0) return;
  combo = combo >= 3 ? 1 : combo + 1; attackTimer = 15 + combo * 3;
  player.vx += player.face * (combo === 3 ? 4.8 : 2.4); slash(player.x + player.face * 24, player.y - 5, player.face, combo === 3 ? 0xf5c96f : 0xdce9bd, combo === 3);
  if (distance(player, master) < 102) { hit(master, combo === 3 ? 12 : 6, combo === 3 ? 28 : 9); score += combo * 10; if (master.posture >= 100) { master.posture = 0; hit(master, 16); say("沈孤鸿", "好一记破势。再来。"); } }
  else say("无名剑客", combo === 3 ? "断！" : "喝！");
}

function startDash() {
  if (!playing || paused || dashCooldown > 0 || dashTimer > 0) return;
  dashTimer = 20; dashCooldown = 150; player.vx = player.face * 15; player.vy *= .25; player.trail = 24; slash(player.x, player.y, player.face, 0xa6e2cf, true); say("无名剑客", "踏雨无痕！");
}

function startParry() {
  if (!playing || paused || parryCooldown > 0) return;
  parryTimer = 22; parryCooldown = 86; player.flash = 10; spark(player.x, player.y - 15, 0xf0d68c, 14); say("无名剑客", "听雨。 ");
}

function enemyLogic(delta: number) {
  const range = distance(player, master); enemyTimer -= delta;
  if (enemyPhase === "observe") {
    master.face = player.x > master.x ? 1 : -1;
    if (range > 180) master.vx += master.face * .18 * delta;
    if (enemyTimer <= 0 && range < 420) { enemyPhase = "telegraph"; enemyTimer = 76; say("沈孤鸿", "看清了，这一剑很重。 "); }
  } else if (enemyPhase === "telegraph" && enemyTimer <= 0) {
    enemyPhase = "lunge"; enemyTimer = 19; master.vx = master.face * 17; master.trail = 24; slash(master.x, master.y, master.face, 0xdf7654, true);
  } else if (enemyPhase === "lunge") {
    if (range < 86 && enemyTimer < 11) {
      if (parryTimer > 0) { enemyPhase = "recover"; enemyTimer = 70; master.vx *= -.25; master.posture = Math.min(100, master.posture + 48); spark(player.x, player.y, 0xffe8a5, 28, true); say("沈孤鸿", "……竟接住了。 "); score += 55; }
      else if (dashTimer <= 0) { hit(player, 17); say("沈孤鸿", "剑已至。 "); }
    }
    if (enemyTimer <= 0) { enemyPhase = "recover"; enemyTimer = 44; }
  } else if (enemyPhase === "recover" && enemyTimer <= 0) { enemyPhase = "observe"; enemyTimer = 80 + Math.random() * 60; }
}

function reset() {
  player.hp = 100; player.posture = 0; player.x = 100; player.y = 340; player.vx = player.vy = 0; player.face = 1;
  master.hp = 100; master.posture = 0; master.x = 590; master.y = 300; master.vx = master.vy = 0; master.face = -1;
  elapsed = score = attackTimer = combo = dashTimer = dashCooldown = parryTimer = parryCooldown = 0; enemyPhase = "observe"; enemyTimer = 85; playing = true; paused = false;
  $("start-screen").classList.remove("visible"); $("result-screen").classList.remove("visible"); $("hint").style.opacity = "1"; say("沈孤鸿", "出剑。让我看看你走到了哪一步。 "); updateHud();
}

function finish(victory: boolean) {
  if (!playing) return; playing = false; best = Math.max(best, score); void api.save("rain-sword-record", { best });
  $("result-kicker").textContent = victory ? "剑意初成" : "雨未停";
  $("result-title").textContent = victory ? "这一剑，胜了。" : "再来。剑不该停在这里。";
  $("result-copy").textContent = victory ? `你以 ${score} 点剑意破开守关人的气势。` : `本次试剑获得 ${score} 点剑意，下一次会更接近那一剑。`;
  $("result-screen").classList.add("visible");
}

function bindJoystick() {
  const pad = $("joystick"); const stick = $("stick");
  const set = (event: PointerEvent) => { const rect = pad.getBoundingClientRect(); const dx = event.clientX - rect.left - rect.width / 2; const dy = event.clientY - rect.top - rect.height / 2; const length = Math.min(32, Math.hypot(dx, dy)); const angle = Math.atan2(dy, dx); input.x = Math.cos(angle) * length / 32; input.y = Math.sin(angle) * length / 32; stick.style.transform = `translate(${input.x * 25}px, ${input.y * 25}px)`; };
  pad.addEventListener("pointerdown", (event) => { pad.setPointerCapture(event.pointerId); input.active = true; set(event); });
  pad.addEventListener("pointermove", (event) => { if (input.active) set(event); });
  const clear = () => { input.active = false; input.x = input.y = 0; stick.style.transform = ""; }; pad.addEventListener("pointerup", clear); pad.addEventListener("pointercancel", clear);
}

async function boot() {
  await app.init({ resizeTo: window, preference: "webgl", backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
  $("pixi-stage").appendChild(app.canvas); app.canvas.setAttribute("aria-label", "夜雨竹林 PixiJS 战斗画布"); app.stage.addChild(stage); stage.addChild(world);
  drawArena(); const rainLayer = rain(); player = makeFighter(0x23453d, 0x6d9374); master = makeFighter(0x5a2b25, 0xb94f3d, true); reset(); playing = false; $("start-screen").classList.add("visible");
  bindJoystick(); $("start").addEventListener("click", reset); $("restart").addEventListener("click", reset); $("attack").addEventListener("click", startAttack); $("dash").addEventListener("click", startDash); $("parry").addEventListener("click", startParry); $("leave").addEventListener("click", () => api.exit());
  $("pause").addEventListener("click", () => { paused = !paused; $("pause").textContent = paused ? "▶" : "Ⅱ"; });
  app.canvas.addEventListener("pointerdown", (event) => { if (!playing || paused) return; const rect = app.canvas.getBoundingClientRect(); const targetX = (event.clientX - rect.left) / rect.width * app.screen.width + player.x - app.screen.width / 2; const targetY = (event.clientY - rect.top) / rect.height * app.screen.height + player.y - app.screen.height / 2; input.x = Math.sign(targetX - player.x); input.y = Math.sign(targetY - player.y); });
  app.ticker.add((ticker) => {
    const delta = Math.min(ticker.deltaTime, 2); for (const drop of rainLayer.children) { drop.y += Number(drop.label) * delta; drop.x -= 1.8 * delta; if (drop.y > 520) { drop.y = -560; drop.x += 850; } }
    if (!playing || paused || pausedByLifecycle) return;
    elapsed += delta; attackTimer = Math.max(0, attackTimer - delta); dashTimer = Math.max(0, dashTimer - delta); dashCooldown = Math.max(0, dashCooldown - delta); parryTimer = Math.max(0, parryTimer - delta); parryCooldown = Math.max(0, parryCooldown - delta);
    player.vx += input.x * (dashTimer > 0 ? .18 : .62) * delta; player.vy += input.y * (dashTimer > 0 ? .18 : .62) * delta; if (Math.abs(input.x) > .1) player.face = input.x > 0 ? 1 : -1;
    enemyLogic(delta);
    for (const fighter of [player, master]) { fighter.x += fighter.vx * delta; fighter.y += fighter.vy * delta; fighter.vx *= dashTimer > 0 && fighter === player ? .91 : .82; fighter.vy *= .82; fighter.x = Math.max(-280, Math.min(980, fighter.x)); fighter.y = Math.max(180, Math.min(465, fighter.y)); fighter.root.position.set(fighter.x, fighter.y); fighter.root.scale.x = fighter.face; fighter.body.tint = fighter.flash > 0 ? 0xffffff : 0xffffff; fighter.flash = Math.max(0, fighter.flash - delta); fighter.sword.rotation = (fighter === player && attackTimer > 0 ? -attackTimer / 18 * fighter.face : 0); if (fighter.trail > 0) { fighter.trail -= delta; const ghost = new Graphics().circle(0, 0, 20).fill({ color: fighter === player ? 0x9bd8c5 : 0xdb7658, alpha: .18 }); ghost.position.set(fighter.x - fighter.face * 15, fighter.y + 8); world.addChildAt(ghost, 2); effects.push({ view: ghost, life: .35, vx: -fighter.face * 1.5, vy: 0, scale: 1.4 }); } }
    const cameraX = app.screen.width / 2 - (player.x + master.x) / 2; const cameraY = app.screen.height * .58 - (player.y + master.y) / 2; world.position.set(cameraX, cameraY); stage.x *= .72; stage.y *= .72;
    for (let index = effects.length - 1; index >= 0; index -= 1) { const effect = effects[index]; effect.life -= .035 * delta; effect.view.x += effect.vx * delta; effect.view.y += effect.vy * delta; effect.view.scale.set(effect.scale += .015 * delta); effect.view.alpha = Math.max(0, effect.life); if (effect.life <= 0) { effect.view.destroy(); effects.splice(index, 1); } }
    dialogueTimer -= delta; if (dialogueTimer <= 0 && elapsed > 140 && Math.random() < .004) say("沈孤鸿", enemyPhase === "observe" ? "别等雨停。" : "看剑。 "); if (elapsed > 170) $("hint").style.opacity = "0"; updateHud();
  });
  window.addEventListener("mobile-tavern:lifecycle", ((event: CustomEvent<"pause" | "resume">) => { pausedByLifecycle = event.detail === "pause"; }) as EventListener);
  const saved = await api.load("rain-sword-record") as { best?: number } | null; best = saved?.best ?? 0; $("record").textContent = best ? `旧日剑意 ${best}` : "首次交锋，胜负未定";
  await api.ready(); document.documentElement.dataset.pixiReady = "true";
}

void boot();

declare global { interface Window { MobileTavernPlugin?: { exit(): void | Promise<void>; ready(): Promise<{ apiVersion: number }>; save(slot: string, data: unknown): Promise<void>; load(slot: string): Promise<unknown | null>; }; } }

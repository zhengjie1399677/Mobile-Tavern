import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";

import backgroundUrl from "../assets/rain-bamboo-bg.webp";
import heroSheetUrl from "../assets/hero-sheet.webp";
import masterSheetUrl from "../assets/master-sheet.webp";

type Pose = "idle" | "move" | "attack1" | "attack2" | "guard" | "hurt";
type Fighter = {
  root: Container;
  sprite: Sprite;
  textures: Record<Pose, Texture>;
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  hp: number;
  posture: number;
  invulnerable: number;
  poseTimer: number;
  trail: number;
};
type Effect = { view: Graphics | Sprite; life: number; vx: number; vy: number; scale: number };
type EnemyPhase = "circle" | "approach" | "feint" | "telegraph" | "lunge" | "retreat" | "recover";

const previewSaves = new Map<string, unknown>();
const api = window.MobileTavernPlugin ?? {
  exit: () => undefined,
  ready: async () => ({ apiVersion: 1 }),
  save: async (slot: string, data: unknown) => previewSaves.set(slot, structuredClone(data)),
  load: async (slot: string) => previewSaves.get(slot) ?? null,
};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new Application();
const scene = new Container();
const world = new Container();
const effects: Effect[] = [];
const input = { x: 0, y: 0, active: false };
const poseIndexes: Record<Pose, number> = { idle: 0, move: 1, attack1: 2, attack2: 3, guard: 4, hurt: 5 };
const conversations = {
  opening: [
    ["沈孤鸿", "出剑。让我看看，这场雨教会了你什么。"],
    ["无名剑客", "雨没有教我。它只是让我听得更清楚。"],
  ],
  idle: [
    ["沈孤鸿", "别只盯着剑尖。看我的肩，也看我的脚。"],
    ["沈孤鸿", "你在等破绽。我也在等你失去耐心。"],
    ["无名剑客", "竹叶落下之前，胜负还没有落下。"],
    ["沈孤鸿", "呼吸乱了半拍。你自己可曾听见？"],
  ],
  miss: [
    ["沈孤鸿", "追的是人，还是我的剑影？"],
    ["沈孤鸿", "剑先到了，心却还在原地。"],
  ],
  parry: [
    ["沈孤鸿", "……竟从雨声里听见了这一剑。"],
    ["无名剑客", "雨声有隙，你的剑也有。"],
  ],
  hurt: [
    ["沈孤鸿", "挨过这一剑，才算真正进了门。"],
    ["无名剑客", "还站着。那就还没有输。"],
  ],
};

let player: Fighter;
let master: Fighter;
let background: Sprite;
let rainLayer: Container;
let playing = false;
let paused = false;
let pausedByLifecycle = false;
let elapsed = 0;
let score = 0;
let best = 0;
let attackTimer = 0;
let combo = 0;
let comboWindow = 0;
let dashTimer = 0;
let dashCooldown = 0;
let parryTimer = 0;
let parryCooldown = 0;
let enemyPhase: EnemyPhase = "circle";
let enemyTimer = 90;
let enemyHitCommitted = false;
let dialogueTimer = 0;
let dialogueIndex = 0;
let playerWhiffs = 0;
let playerAttacks = 0;
let playerParries = 0;

function sheetTextures(base: Texture): Record<Pose, Texture> {
  const width = base.source.width / 6;
  return Object.fromEntries(Object.entries(poseIndexes).map(([pose, index]) => [pose, new Texture({
    source: base.source,
    frame: new Rectangle(Math.floor(index * width), 0, Math.ceil(width), base.source.height),
  })])) as Record<Pose, Texture>;
}

async function loadTexture(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return Texture.from(image);
}

function makeFighter(textures: Record<Pose, Texture>, face: number): Fighter {
  const root = new Container();
  const shadow = new Graphics().ellipse(0, -4, 45, 10).fill({ color: 0x020706, alpha: .42 });
  const sprite = new Sprite(textures.idle);
  sprite.anchor.set(.5, 1);
  sprite.scale.set(.38);
  root.addChild(shadow, sprite);
  world.addChild(root);
  return { root, sprite, textures, x: 0, y: 0, vx: 0, vy: 0, face, hp: 100, posture: 0, invulnerable: 0, poseTimer: 0, trail: 0 };
}

function pose(fighter: Fighter, next: Pose, duration = 0) {
  fighter.sprite.texture = fighter.textures[next];
  fighter.poseTimer = duration;
}

function layoutBackground() {
  if (!background) return;
  const scale = Math.max(app.screen.width / background.texture.width, app.screen.height / background.texture.height);
  background.scale.set(scale);
  background.position.set(app.screen.width / 2, app.screen.height / 2);
}

function makeRain() {
  const layer = new Container();
  for (let index = 0; index < 115; index += 1) {
    const drop = new Graphics().moveTo(0, 0).lineTo(-5, 24).stroke({ color: 0xb8ded8, width: index % 5 === 0 ? 1.5 : .8, alpha: .24 + index % 4 * .07 });
    drop.position.set(Math.random() * 1900, -100 + Math.random() * 900);
    drop.label = String(4 + Math.random() * 7);
    layer.addChild(drop);
  }
  scene.addChild(layer);
  return layer;
}

function ripple(x: number, y: number, color = 0x9bc9bf) {
  const view = new Graphics().ellipse(0, 0, 25, 7).stroke({ color, width: 1.4, alpha: .65 });
  view.position.set(x, y + 3);
  world.addChildAt(view, 0);
  effects.push({ view, life: .72, vx: 0, vy: 0, scale: .7 });
}

function spark(x: number, y: number, color: number, count = 12, strong = false) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const view = new Graphics().circle(0, 0, strong ? 3 : 1.5 + Math.random() * 1.4).fill({ color });
    view.position.set(x, y);
    world.addChild(view);
    effects.push({ view, life: 1, vx: Math.cos(angle) * (strong ? 6 : 2 + Math.random() * 3), vy: Math.sin(angle) * (strong ? 6 : 2 + Math.random() * 3), scale: 1 });
  }
}

function slash(x: number, y: number, face: number, color: number, big = false) {
  const view = new Graphics().arc(0, 0, big ? 88 : 56, face > 0 ? -.9 : Math.PI - .9, face > 0 ? 1.35 : Math.PI + 1.35).stroke({ color, width: big ? 8 : 5, alpha: .9 });
  view.position.set(x, y);
  world.addChild(view);
  effects.push({ view, life: .5, vx: 0, vy: 0, scale: big ? 1.35 : 1.1 });
}

function afterimage(fighter: Fighter) {
  const ghost = new Sprite(fighter.sprite.texture);
  ghost.anchor.set(.5, 1);
  ghost.scale.set(.38 * fighter.face, .38);
  ghost.tint = fighter === player ? 0x8cc7b7 : 0xb85b4b;
  ghost.alpha = .22;
  ghost.position.set(fighter.x - fighter.face * 12, fighter.y);
  world.addChildAt(ghost, 1);
  effects.push({ view: ghost, life: .38, vx: -fighter.face * 1.5, vy: 0, scale: 1 });
}

function screenShake(power = 7) {
  scene.x = (Math.random() - .5) * power;
  scene.y = (Math.random() - .5) * power;
}

function distance(a: Fighter, b: Fighter) { return Math.hypot(a.x - b.x, (a.y - b.y) * .75); }

function say(speaker: string, text: string, hold = 260) {
  $("speech").querySelector(".speaker")!.textContent = speaker;
  $("speech-text").textContent = text;
  dialogueTimer = hold;
}

function sayFrom(group: keyof typeof conversations) {
  const lines = conversations[group];
  const line = lines[dialogueIndex++ % lines.length];
  say(line[0], line[1]);
}

function updateHud() {
  $("player-hp").style.width = `${Math.max(0, player.hp)}%`;
  $("boss-hp").style.width = `${Math.max(0, master.hp)}%`;
  $("player-posture").textContent = player.invulnerable > 0 ? "稳住身形" : dashCooldown > 0 ? `轻功回气 ${Math.ceil(dashCooldown / 12)}` : "气息平稳";
  $("boss-posture").textContent = master.posture > 0 ? `破绽 ${Math.round(master.posture)}` : "气势如山";
  $("timer").textContent = `00:${String(Math.floor(elapsed / 60)).padStart(2, "0")}`;
  const labels: Record<EnemyPhase, string> = { circle: "游身", approach: "迫近", feint: "藏锋", telegraph: "孤鸿落", lunge: "剑啸", retreat: "回风", recover: "收剑" };
  $("intent").textContent = labels[enemyPhase];
  $("intent-bar").style.transform = `scaleX(${enemyPhase === "telegraph" ? 1 - Math.min(1, enemyTimer / 58) : enemyPhase === "lunge" ? 1 : .12})`;
  $("attack").classList.toggle("cooldown", attackTimer > 0);
  $("dash").classList.toggle("cooldown", dashCooldown > 0);
  $("parry").classList.toggle("cooldown", parryCooldown > 0);
}

function hit(target: Fighter, amount: number, posture = 0) {
  if (target.invulnerable > 0) return false;
  target.hp = Math.max(0, target.hp - amount);
  target.posture = Math.min(100, target.posture + posture);
  target.invulnerable = target === player ? 32 : 11;
  pose(target, "hurt", 20);
  spark(target.x, target.y - 70, target === master ? 0xf2c171 : 0xd9e8c1, 18, true);
  ripple(target.x, target.y, target === master ? 0xd69b78 : 0x9bc9bf);
  screenShake(target === player ? 8 : 6);
  updateHud();
  if (target.hp <= 0) finish(target === master);
  return true;
}

function startAttack() {
  if (!playing || paused || attackTimer > 0 || dashTimer > 0) return;
  combo = comboWindow > 0 ? combo % 3 + 1 : 1;
  comboWindow = 42;
  attackTimer = 14 + combo * 2;
  playerAttacks += 1;
  pose(player, combo === 3 ? "attack2" : "attack1", attackTimer);
  player.vx += player.face * (combo === 3 ? 5.2 : 3);
  slash(player.x + player.face * 45, player.y - 72, player.face, combo === 3 ? 0xf5c96f : 0xdce9bd, combo === 3);
  if (distance(player, master) < 124) {
    hit(master, combo === 3 ? 9 : 5, combo === 3 ? 24 : 8);
    score += combo * 12;
    if (master.posture >= 100) {
      master.posture = 0;
      hit(master, 14);
      enemyPhase = "recover";
      enemyTimer = 78;
      say("沈孤鸿", "好一记破势。你终于没有只看我的剑。", 320);
    }
  } else {
    playerWhiffs += 1;
    if (playerWhiffs === 2 || playerWhiffs % 4 === 0) sayFrom("miss");
  }
}

function startDash() {
  if (!playing || paused || dashCooldown > 0 || dashTimer > 0) return;
  dashTimer = 18;
  dashCooldown = 132;
  player.vx = player.face * 14;
  player.vy *= .25;
  player.trail = 20;
  pose(player, "move", 22);
  ripple(player.x, player.y);
  say("无名剑客", "踏雨无痕！", 150);
}

function startParry() {
  if (!playing || paused || parryCooldown > 0) return;
  parryTimer = 24;
  parryCooldown = 78;
  playerParries += 1;
  pose(player, "guard", 28);
  spark(player.x + player.face * 18, player.y - 80, 0xf0d68c, 12);
  if (playerParries === 1) say("无名剑客", "听雨。", 150);
}

function chooseEnemyAction(range: number) {
  const aggression = master.hp < 45 ? .18 : 0;
  const punishWhiffs = playerWhiffs >= 2 ? .2 : 0;
  const waryOfParry = playerParries >= 2 ? .18 : 0;
  const roll = Math.random();
  if (range > 330) {
    enemyPhase = "approach";
    enemyTimer = 48 + Math.random() * 34;
  } else if (range < 105) {
    enemyPhase = roll < .58 ? "retreat" : "feint";
    enemyTimer = 30 + Math.random() * 20;
  } else if (roll < .2 + waryOfParry) {
    enemyPhase = "feint";
    enemyTimer = 34 + Math.random() * 18;
  } else if (roll < .62 + aggression + punishWhiffs) {
    enemyPhase = "telegraph";
    enemyTimer = master.hp < 45 ? 42 : 56;
    pose(master, "guard", enemyTimer);
    if (dialogueTimer <= 0 && Math.random() < .5) say("沈孤鸿", playerWhiffs > 2 ? "既然收不住剑，我便替你收。" : "看清了。这一剑，很重。", 260);
  } else {
    enemyPhase = "circle";
    enemyTimer = 48 + Math.random() * 48;
  }
}

function enemyLogic(delta: number) {
  const range = distance(player, master);
  master.face = player.x > master.x ? 1 : -1;
  enemyTimer -= delta;
  if (enemyPhase === "circle") {
    const side = Math.sin(elapsed / 34) > 0 ? 1 : -1;
    master.vy += side * .16 * delta;
    if (range > 220) master.vx += master.face * .12 * delta;
    if (range < 150) master.vx -= master.face * .12 * delta;
    pose(master, Math.abs(master.vx) + Math.abs(master.vy) > .45 ? "move" : "idle");
    if (enemyTimer <= 0) chooseEnemyAction(range);
  } else if (enemyPhase === "approach") {
    master.vx += master.face * .28 * delta;
    master.vy += Math.sign(player.y - master.y) * .1 * delta;
    pose(master, "move");
    if (range < 190 || enemyTimer <= 0) chooseEnemyAction(range);
  } else if (enemyPhase === "retreat") {
    master.vx -= master.face * .34 * delta;
    master.vy += (Math.random() > .5 ? 1 : -1) * .08 * delta;
    pose(master, "move");
    if (enemyTimer <= 0 || range > 230) chooseEnemyAction(range);
  } else if (enemyPhase === "feint") {
    pose(master, "guard");
    if (enemyTimer > 17) master.vx += master.face * .2 * delta;
    else master.vx -= master.face * .35 * delta;
    if (enemyTimer <= 0) {
      if (attackTimer > 0 || playerWhiffs > 2) {
        enemyPhase = "telegraph";
        enemyTimer = 28;
      } else chooseEnemyAction(range);
    }
  } else if (enemyPhase === "telegraph" && enemyTimer <= 0) {
    enemyPhase = "lunge";
    enemyTimer = 18;
    enemyHitCommitted = false;
    master.vx = master.face * (master.hp < 45 ? 18 : 16);
    master.trail = 22;
    pose(master, master.hp < 45 ? "attack2" : "attack1", 24);
    slash(master.x, master.y - 72, master.face, 0xdf7654, true);
  } else if (enemyPhase === "lunge") {
    if (!enemyHitCommitted && range < 102 && enemyTimer < 13) {
      enemyHitCommitted = true;
      if (parryTimer > 0) {
        enemyPhase = "recover";
        enemyTimer = 78;
        master.vx *= -.35;
        master.posture = Math.min(100, master.posture + 44);
        pose(master, "hurt", 24);
        spark(player.x, player.y - 72, 0xffe8a5, 30, true);
        screenShake(11);
        score += 60;
        sayFrom("parry");
      } else if (dashTimer <= 0 && hit(player, master.hp < 45 ? 27 : 24)) {
        sayFrom("hurt");
      }
    }
    if (enemyTimer <= 0) {
      enemyPhase = "recover";
      enemyTimer = 42;
    }
  } else if (enemyPhase === "recover" && enemyTimer <= 0) {
    chooseEnemyAction(range);
  }
}

function reset() {
  player.hp = 100;
  player.posture = 0;
  player.x = 150;
  player.y = 370;
  player.vx = player.vy = 0;
  player.face = 1;
  player.invulnerable = 0;
  master.hp = 100;
  master.posture = 0;
  master.x = 650;
  master.y = 340;
  master.vx = master.vy = 0;
  master.face = -1;
  master.invulnerable = 0;
  elapsed = score = attackTimer = combo = comboWindow = dashTimer = dashCooldown = parryTimer = parryCooldown = 0;
  playerWhiffs = playerAttacks = playerParries = 0;
  enemyPhase = "circle";
  enemyTimer = 72;
  playing = true;
  paused = false;
  pose(player, "idle");
  pose(master, "idle");
  $("start-screen").classList.remove("visible");
  $("result-screen").classList.remove("visible");
  $("hint").style.opacity = "1";
  const opening = conversations.opening[Math.floor(Math.random() * conversations.opening.length)];
  say(opening[0], opening[1], 340);
  updateHud();
}

function finish(victory: boolean) {
  if (!playing) return;
  playing = false;
  best = Math.max(best, score);
  void api.save("rain-sword-record", { best });
  $("result-kicker").textContent = victory ? "剑意初成" : "雨未停";
  $("result-title").textContent = victory ? "这一剑，胜了。" : "再来。剑不该停在这里。";
  $("result-copy").textContent = victory ? `你以 ${score} 点剑意破开守关人的气势。` : `本次试剑获得 ${score} 点剑意。你至少看清了他的下一剑。`;
  $("result-screen").classList.add("visible");
}

function bindJoystick() {
  const pad = $("joystick");
  const stick = $("stick");
  const set = (event: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const length = Math.min(32, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    input.x = Math.cos(angle) * length / 32;
    input.y = Math.sin(angle) * length / 32;
    stick.style.transform = `translate(${input.x * 25}px, ${input.y * 25}px)`;
  };
  pad.addEventListener("pointerdown", (event) => { pad.setPointerCapture(event.pointerId); input.active = true; set(event); });
  pad.addEventListener("pointermove", (event) => { if (input.active) set(event); });
  const clear = () => { input.active = false; input.x = input.y = 0; stick.style.transform = ""; };
  pad.addEventListener("pointerup", clear);
  pad.addEventListener("pointercancel", clear);
}

function tickEffects(delta: number) {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    effect.life -= .035 * delta;
    effect.view.x += effect.vx * delta;
    effect.view.y += effect.vy * delta;
    effect.view.alpha = Math.max(0, effect.life);
    if (effect.view instanceof Graphics) effect.view.scale.set(effect.scale += .015 * delta);
    if (effect.life <= 0) {
      effect.view.destroy();
      effects.splice(index, 1);
    }
  }
}

function updateFighter(fighter: Fighter, delta: number) {
  fighter.x += fighter.vx * delta;
  fighter.y += fighter.vy * delta;
  fighter.vx *= dashTimer > 0 && fighter === player ? .91 : .82;
  fighter.vy *= .82;
  fighter.x = Math.max(40, Math.min(960, fighter.x));
  fighter.y = Math.max(275, Math.min(455, fighter.y));
  fighter.root.position.set(fighter.x, fighter.y);
  fighter.root.scale.x = fighter.face;
  fighter.invulnerable = Math.max(0, fighter.invulnerable - delta);
  fighter.poseTimer = Math.max(0, fighter.poseTimer - delta);
  fighter.sprite.alpha = fighter.invulnerable > 0 && Math.floor(fighter.invulnerable / 3) % 2 === 0 ? .65 : 1;
  if (fighter.poseTimer <= 0 && fighter === player) pose(fighter, Math.abs(input.x) + Math.abs(input.y) > .2 ? "move" : "idle");
  if (fighter.trail > 0) {
    fighter.trail -= delta;
    if (Math.floor(fighter.trail) % 3 === 0) afterimage(fighter);
  }
}

async function boot() {
  await app.init({ resizeTo: window, preference: "webgl", backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
  $("pixi-stage").appendChild(app.canvas);
  app.canvas.setAttribute("aria-label", "夜雨竹林 PixiJS 武侠战斗画布");
  app.stage.addChild(scene);
  const [backgroundTexture, heroTexture, masterTexture] = await Promise.all([
    loadTexture(backgroundUrl),
    loadTexture(heroSheetUrl),
    loadTexture(masterSheetUrl),
  ]);
  background = new Sprite(backgroundTexture);
  background.anchor.set(.5);
  scene.addChild(background, world);
  rainLayer = makeRain();
  player = makeFighter(sheetTextures(heroTexture), 1);
  master = makeFighter(sheetTextures(masterTexture), -1);
  layoutBackground();
  window.addEventListener("resize", layoutBackground);
  reset();
  playing = false;
  $("start-screen").classList.add("visible");
  bindJoystick();
  $("start").addEventListener("click", reset);
  $("restart").addEventListener("click", reset);
  $("attack").addEventListener("click", startAttack);
  $("dash").addEventListener("click", startDash);
  $("parry").addEventListener("click", startParry);
  $("leave").addEventListener("click", () => api.exit());
  $("pause").addEventListener("click", () => { paused = !paused; $("pause").textContent = paused ? "▶" : "Ⅱ"; });
  app.ticker.add((ticker) => {
    const delta = Math.min(ticker.deltaTime, 2);
    for (const drop of rainLayer.children) {
      drop.y += Number(drop.label) * delta;
      drop.x -= 2.2 * delta;
      if (drop.y > app.screen.height + 40) { drop.y = -40; drop.x = Math.random() * app.screen.width; }
    }
    scene.x *= .7;
    scene.y *= .7;
    if (!playing || paused || pausedByLifecycle) return;
    elapsed += delta;
    attackTimer = Math.max(0, attackTimer - delta);
    comboWindow = Math.max(0, comboWindow - delta);
    dashTimer = Math.max(0, dashTimer - delta);
    dashCooldown = Math.max(0, dashCooldown - delta);
    parryTimer = Math.max(0, parryTimer - delta);
    parryCooldown = Math.max(0, parryCooldown - delta);
    player.vx += input.x * (dashTimer > 0 ? .18 : .58) * delta;
    player.vy += input.y * (dashTimer > 0 ? .18 : .5) * delta;
    if (Math.abs(input.x) > .1) player.face = input.x > 0 ? 1 : -1;
    enemyLogic(delta);
    updateFighter(player, delta);
    updateFighter(master, delta);
    const scale = Math.min(1.08, Math.max(.8, 840 / Math.max(650, Math.abs(player.x - master.x) + 310)));
    world.scale.set(scale);
    world.position.set(app.screen.width / 2 - (player.x + master.x) / 2 * scale, app.screen.height * .73 - (player.y + master.y) / 2 * scale);
    tickEffects(delta);
    dialogueTimer -= delta;
    if (dialogueTimer <= 0 && elapsed > 180 && Math.random() < .004) sayFrom("idle");
    if (elapsed > 190) $("hint").style.opacity = "0";
    if (Math.random() < .02 && (Math.abs(player.vx) > 1.4 || Math.abs(master.vx) > 1.4)) ripple(Math.abs(player.vx) > Math.abs(master.vx) ? player.x : master.x, Math.abs(player.vx) > Math.abs(master.vx) ? player.y : master.y);
    updateHud();
  });
  window.addEventListener("mobile-tavern:lifecycle", ((event: CustomEvent<"pause" | "resume">) => { pausedByLifecycle = event.detail === "pause"; }) as EventListener);
  const saved = await api.load("rain-sword-record") as { best?: number } | null;
  best = saved?.best ?? 0;
  $("record").textContent = best ? `旧日剑意 ${best}` : "首次交锋，胜负未定";
  await api.ready();
  document.documentElement.dataset.pixiReady = "true";
}

void boot();

declare global {
  interface Window {
    MobileTavernPlugin?: {
      exit(): void | Promise<void>;
      ready(): Promise<{ apiVersion: number }>;
      save(slot: string, data: unknown): Promise<void>;
      load(slot: string): Promise<unknown | null>;
    };
  }
}

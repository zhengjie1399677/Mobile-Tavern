import { Application, Container, Graphics } from "pixi.js";

type Shot = { view: Graphics; vx: number; vy: number; friendly: boolean; radius: number };
type Spark = { view: Graphics; vx: number; vy: number; life: number };

const previewSaves = new Map<string, unknown>();
const api = window.MobileTavernPlugin ?? {
  exit: () => undefined,
  ready: async () => ({ apiVersion: 1 }),
  save: async (slot: string, data: unknown) => { previewSaves.set(slot, structuredClone(data)); },
  load: async (slot: string) => previewSaves.get(slot) ?? null,
  deleteSave: async (slot: string) => { previewSaves.delete(slot); },
};
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new Application();
const world = new Container();
const shots: Shot[] = [];
const sparks: Spark[] = [];
let player!: Graphics;
let boss!: Container;
let running = false;
let paused = false;
let playerHp = 100;
let bossHp = 100;
let energy = 0;
let score = 0;
let best = 0;
let playerCooldown = 0;
let bossCooldown = 0;
let elapsed = 0;

function ship(color: number) {
  return new Graphics().poly([-22, 15, 0, -27, 22, 15, 8, 10, 0, 23, -8, 10]).fill({ color }).stroke({ color: 0xffffff, width: 1.4, alpha: .7 });
}

function makeBoss() {
  const root = new Container();
  root.addChild(new Graphics().poly([-78, -12, -35, -32, 0, -18, 35, -32, 78, -12, 46, 4, 25, 28, 0, 12, -25, 28, -46, 4]).fill({ color: 0x28184c }).stroke({ color: 0xff5fa2, width: 3 }));
  root.addChild(new Graphics().circle(0, 0, 18).fill({ color: 0xff4b99 }).circle(0, 0, 8).fill({ color: 0xffd0e2 }));
  return root;
}

function addShot(x: number, y: number, vx: number, vy: number, friendly: boolean, radius = 5) {
  const color = friendly ? 0x83f4ff : 0xff4c9a;
  const view = new Graphics().circle(0, 0, radius).fill({ color }).circle(0, 0, radius * 2).fill({ color, alpha: .12 });
  view.position.set(x, y); world.addChild(view); shots.push({ view, vx, vy, friendly, radius });
}

function burst(x: number, y: number, color: number, count = 18) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 4.5;
    const view = new Graphics().circle(0, 0, 1 + Math.random() * 2.2).fill({ color });
    view.position.set(x, y); world.addChild(view);
    sparks.push({ view, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1 });
  }
}

function updateHud() {
  byId("player-hp").style.width = `${playerHp}%`;
  byId("boss-hp").style.width = `${bossHp}%`;
  byId("score").textContent = String(score).padStart(6, "0");
  byId("energy").textContent = `${Math.floor(energy)}%`;
  byId<HTMLButtonElement>("burst").disabled = energy < 100 || !running || paused;
}

function removeShot(index: number) { const [shot] = shots.splice(index, 1); shot.view.destroy(); }
function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }

function finish(victory: boolean) {
  running = false;
  best = Math.max(best, score);
  void api.save("pixi-record", { best });
  byId("result-title").textContent = victory ? "核心击破" : "连接中断";
  byId("result-copy").textContent = `本次战果 ${score}，最高记录 ${best}。`;
  byId("result-screen").classList.add("visible");
  updateHud();
}

function reset() {
  for (let i = shots.length - 1; i >= 0; i -= 1) removeShot(i);
  sparks.splice(0).forEach((spark) => spark.view.destroy());
  playerHp = 100; bossHp = 100; energy = 0; score = 0; elapsed = 0; playerCooldown = 0; bossCooldown = 32;
  player.position.set(app.screen.width / 2, app.screen.height * .78);
  boss.position.set(app.screen.width / 2, Math.max(105, app.screen.height * .2));
  byId("result-screen").classList.remove("visible"); running = true; paused = false; updateHud();
}

function fireBoss() {
  const base = Math.atan2(player.y - boss.y, player.x - boss.x);
  const count = bossHp < 45 ? 7 : 5;
  for (let i = 0; i < count; i += 1) {
    const angle = base + (i - (count - 1) / 2) * .18;
    addShot(boss.x, boss.y + 18, Math.cos(angle) * 3.1, Math.sin(angle) * 3.1, false, 5.5);
  }
}

function tick(ticker: { deltaTime: number }) {
  if (!running || paused) return;
  const delta = Math.min(ticker.deltaTime, 2); elapsed += delta; playerCooldown -= delta; bossCooldown -= delta;
  boss.x = app.screen.width / 2 + Math.sin(elapsed * .018) * Math.min(150, app.screen.width * .2);
  boss.rotation = Math.sin(elapsed * .025) * .04;
  if (playerCooldown <= 0) { addShot(player.x - 9, player.y - 16, 0, -8.5, true, 3.8); addShot(player.x + 9, player.y - 16, 0, -8.5, true, 3.8); playerCooldown = 9; }
  if (bossCooldown <= 0) { fireBoss(); bossCooldown = Math.max(30, 62 - (100 - bossHp) * .25); }
  for (let i = shots.length - 1; i >= 0; i -= 1) {
    const shot = shots[i]; shot.view.x += shot.vx * delta; shot.view.y += shot.vy * delta;
    const target = shot.friendly ? boss : player;
    if (distance(shot.view, target) < (shot.friendly ? 38 : 20) + shot.radius) {
      burst(shot.view.x, shot.view.y, shot.friendly ? 0x7cf4ff : 0xff4c9a, shot.friendly ? 5 : 14);
      if (shot.friendly) { bossHp = Math.max(0, bossHp - 1.4); score += 12; energy = Math.min(100, energy + 1.6); }
      else { playerHp = Math.max(0, playerHp - 7); energy = Math.min(100, energy + 7); }
      removeShot(i); updateHud();
      if (bossHp <= 0) finish(true); else if (playerHp <= 0) finish(false);
      continue;
    }
    if (shot.view.y < -30 || shot.view.y > app.screen.height + 30 || shot.view.x < -30 || shot.view.x > app.screen.width + 30) removeShot(i);
  }
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i]; spark.view.x += spark.vx * delta; spark.view.y += spark.vy * delta; spark.life -= .045 * delta; spark.view.alpha = spark.life;
    if (spark.life <= 0) { spark.view.destroy(); sparks.splice(i, 1); }
  }
}

function movePlayer(clientX: number, clientY: number) {
  if (!running || paused) return;
  const rect = app.canvas.getBoundingClientRect();
  player.x = Math.max(28, Math.min(app.screen.width - 28, (clientX - rect.left) * app.screen.width / rect.width));
  player.y = Math.max(app.screen.height * .42, Math.min(app.screen.height - 62, (clientY - rect.top) * app.screen.height / rect.height));
}

async function boot() {
  await app.init({ resizeTo: window, preference: "webgl", backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
  app.canvas.setAttribute("aria-label", "PixiJS WebGL 对战画布");
  byId("pixi-stage").appendChild(app.canvas); app.stage.addChild(world);
  player = ship(0x5be8ff); boss = makeBoss(); world.addChild(boss, player); app.ticker.add(tick);
  app.canvas.addEventListener("pointerdown", (event) => { app.canvas.setPointerCapture(event.pointerId); movePlayer(event.clientX, event.clientY); });
  app.canvas.addEventListener("pointermove", (event) => { if (event.buttons || event.pointerType === "touch") movePlayer(event.clientX, event.clientY); });
  byId("start").addEventListener("click", () => { byId("start-screen").classList.remove("visible"); reset(); });
  byId("restart").addEventListener("click", reset);
  byId("leave").addEventListener("click", () => api.exit());
  byId("pause").addEventListener("click", () => { paused = !paused; byId("pause").textContent = paused ? "▶" : "Ⅱ"; updateHud(); });
  byId("burst").addEventListener("click", () => { if (energy < 100 || !running) return; energy = 0; score += shots.filter((shot) => !shot.friendly).length * 30; for (let i = shots.length - 1; i >= 0; i -= 1) if (!shots[i].friendly) { burst(shots[i].view.x, shots[i].view.y, 0x8df7ff, 8); removeShot(i); } bossHp = Math.max(0, bossHp - 18); burst(boss.x, boss.y, 0xffffff, 45); if (bossHp <= 0) finish(true); updateHud(); });
  window.addEventListener("mobile-tavern:lifecycle", ((event: CustomEvent<"pause" | "resume">) => { paused = event.detail === "pause"; updateHud(); }) as EventListener);
  const saved = await api.load("pixi-record") as { best?: number } | null; best = saved?.best ?? 0;
  byId("record").textContent = best ? `最高战果 ${best}` : "尚无作战记录";
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
      deleteSave(slot: string): Promise<void>;
    };
  }
}

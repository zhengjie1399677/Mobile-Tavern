const previewSaves = new Map();
const api = window.MobileTavernPlugin ?? {
  exit: () => undefined,
  save: async (slot, data) => previewSaves.set(slot, structuredClone(data)),
  load: async (slot) => previewSaves.get(slot) ?? null,
  deleteSave: async (slot) => previewSaves.delete(slot),
};
const $ = (selector) => document.querySelector(selector);
const state = { playerHp: 100, playerShield: 0, enemyHp: 120, enemyShield: 0, energy: 1, turn: 1, wins: 0, best: null, busy: false, sound: true, intent: "strike", playing: false };
const skills = {
  strike: { cost: 0, gain: 1, damage: 16, label: "星闪" },
  guard: { cost: 2, shield: 24, label: "棱镜护盾" },
  nova: { cost: 4, damage: 36, pierce: .65, label: "超新星" },
};
const intents = {
  strike: { label: "敌方意图：裂隙斩 · 14 伤害", damage: 14 },
  heavy: { label: "敌方意图：蚀月重击 · 24 伤害", damage: 24 },
  guard: { label: "敌方意图：构筑 18 点护盾", shield: 18 },
  drain: { label: "敌方意图：汲取 · 10 伤害并恢复", damage: 10, heal: 8 },
};

const canvas = $("#fx");
const ctx = canvas.getContext("2d");
let particles = [];
let audio;

function resizeCanvas() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function burst(x, y, color, count = 34) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, size: 1 + Math.random() * 4, color });
  }
}

function animate() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.globalCompositeOperation = "lighter";
  particles = particles.filter((p) => p.life > 0.02);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vx *= .97; p.vy *= .97; p.life *= .94;
    ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(animate);
}

function tone(frequency, duration = .08, type = "sine") {
  if (!state.sound) return;
  audio ??= new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type; oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.06, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
}

function applyDamage(target, amount, pierce = 0) {
  const bypass = Math.round(amount * pierce);
  const blockable = amount - bypass;
  const blocked = Math.min(target === "player" ? state.playerShield : state.enemyShield, blockable);
  if (target === "player") {
    state.playerShield -= blocked; state.playerHp = Math.max(0, state.playerHp - (blockable - blocked) - bypass);
  } else {
    state.enemyShield -= blocked; state.enemyHp = Math.max(0, state.enemyHp - (blockable - blocked) - bypass);
  }
}

function chooseIntent() {
  const pool = state.enemyHp < 42 ? ["heavy", "drain", "guard"] : state.turn % 3 === 0 ? ["heavy", "guard"] : ["strike", "strike", "guard", "drain"];
  state.intent = pool[Math.floor(Math.random() * pool.length)];
  $("#intent").textContent = intents[state.intent].label;
}

function render() {
  $("#turn").textContent = state.turn;
  $("#playerHp").style.width = `${state.playerHp}%`; $("#playerHpText").textContent = `${state.playerHp} / 100`;
  $("#enemyHp").style.width = `${state.enemyHp / 1.2}%`; $("#enemyHpText").textContent = `${state.enemyHp} / 120`;
  $("#playerShield").style.width = `${Math.min(100, state.playerShield * 3)}%`;
  $("#enemyShield").style.width = `${Math.min(100, state.enemyShield * 3)}%`;
  $("#record").textContent = state.best ? `${state.best} 回合` : "--";
  $("#energyPips").innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < state.energy ? "on" : ""}"></i>`).join("");
  document.querySelectorAll(".skill").forEach((button) => { button.disabled = state.busy || skills[button.dataset.skill].cost > state.energy || !state.playing; });
}

function unitCenter(selector) {
  const rect = $(selector).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function useSkill(name) {
  const skill = skills[name];
  if (state.busy || skill.cost > state.energy || !state.playing) return;
  state.busy = true; state.energy -= skill.cost; state.energy = Math.min(5, state.energy + (skill.gain || 0));
  $("#message").textContent = skill.label;
  $(".player-unit").classList.add("acting"); tone(name === "nova" ? 160 : 440, .12, "triangle");
  await wait(260);
  if (skill.damage) {
    applyDamage("enemy", skill.damage, skill.pierce || 0);
    const point = unitCenter(".enemy-unit"); burst(point.x, point.y, name === "nova" ? "#ffbd8b" : "#73f7ff", name === "nova" ? 70 : 34);
    $("#enemyFighter").classList.add("damage");
  } else {
    state.playerShield = Math.min(40, state.playerShield + skill.shield); $(".player-unit").classList.add("guarding"); tone(660, .18);
  }
  render(); await wait(420); clearMotion();
  if (state.enemyHp <= 0) return finish(true);
  await enemyTurn();
}

async function enemyTurn() {
  const move = intents[state.intent];
  $("#message").textContent = state.intent === "guard" ? "敌方展开壁垒" : "敌方发动攻击";
  $(".enemy-unit").classList.add("acting"); tone(95, .16, "sawtooth"); await wait(330);
  if (move.damage) {
    applyDamage("player", move.damage);
    const point = unitCenter(".player-unit"); burst(point.x, point.y, "#ff607d", state.intent === "heavy" ? 58 : 28);
    $("#playerFighter").classList.add("damage");
  }
  if (move.shield) state.enemyShield = Math.min(36, state.enemyShield + move.shield);
  if (move.heal) state.enemyHp = Math.min(120, state.enemyHp + move.heal);
  render(); await wait(430); clearMotion();
  if (state.playerHp <= 0) return finish(false);
  state.turn += 1; state.busy = false; chooseIntent(); $("#message").textContent = "选择你的行动"; render();
  void saveRun();
}

function clearMotion() {
  document.querySelectorAll(".acting,.damage,.guarding").forEach((node) => node.classList.remove("acting", "damage", "guarding"));
}

async function finish(victory) {
  state.playing = false; state.busy = true;
  if (victory) { state.wins += 1; state.best = state.best ? Math.min(state.best, state.turn) : state.turn; }
  $("#resultTitle").textContent = victory ? "胜利" : "败北";
  $("#resultKicker").textContent = victory ? "ARENA SECURED" : "SIGNAL LOST";
  $("#resultText").textContent = victory ? "裂隙守卫的核心已经熄灭。" : "重整战术，下一次你会看得更远。";
  $("#resultTurns").textContent = state.turn; $("#resultWins").textContent = state.wins;
  $("#resultScreen").classList.add("visible");
  await api.save("profile", { wins: state.wins, best: state.best }); await api.deleteSave("run");
  tone(victory ? 720 : 110, .45, victory ? "sine" : "sawtooth"); render();
}

function reset() {
  Object.assign(state, { playerHp: 100, playerShield: 0, enemyHp: 120, enemyShield: 0, energy: 1, turn: 1, busy: false, playing: true });
  $("#resultScreen").classList.remove("visible"); $("#startScreen").classList.remove("visible"); chooseIntent(); render();
}

async function saveRun() {
  if (!state.playing) return;
  await api.save("run", { playerHp: state.playerHp, playerShield: state.playerShield, enemyHp: state.enemyHp, enemyShield: state.enemyShield, energy: state.energy, turn: state.turn, intent: state.intent });
}

async function boot() {
  const profile = await api.load("profile");
  if (profile) { state.wins = Number(profile.wins) || 0; state.best = Number(profile.best) || null; }
  const run = await api.load("run");
  if (run && run.playerHp > 0 && run.enemyHp > 0) {
    $("#continueHint").textContent = `检测到第 ${run.turn} 回合的战斗记录，进入后将继续战斗`;
    $("#start").addEventListener("click", () => { Object.assign(state, run, { busy: false, playing: true }); $("#startScreen").classList.remove("visible"); chooseIntent(); render(); }, { once: true });
  } else $("#start").addEventListener("click", reset, { once: true });
  render();
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
document.querySelectorAll(".skill").forEach((button) => button.addEventListener("click", () => void useSkill(button.dataset.skill)));
$("#restart").addEventListener("click", reset);
$("#leave").addEventListener("click", () => api.exit());
$("#sound").addEventListener("click", () => { state.sound = !state.sound; $("#sound").textContent = state.sound ? "♫" : "×"; });
window.addEventListener("resize", resizeCanvas);
window.addEventListener("mobile-tavern:lifecycle", (event) => { if (event.detail === "pause") void saveRun(); });
resizeCanvas(); animate(); void boot();

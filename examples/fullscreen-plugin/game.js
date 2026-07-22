const lines = [
  ["旁白", "这是一个运行在隔离全屏容器中的最小 Gal 示例。"],
  ["角色", "插件可以自由绘制自己的页面，但无法接触 Mobile Tavern 主应用。"],
  ["旁白", "存档通过受限宿主 API 写入独立数据库。"],
];

let index = 0;
const speaker = document.querySelector("#speaker");
const line = document.querySelector("#line");

function render() {
  speaker.textContent = lines[index][0];
  line.textContent = lines[index][1];
}

document.querySelector("#next").addEventListener("click", () => {
  index = (index + 1) % lines.length;
  render();
});

document.querySelector("#save").addEventListener("click", async () => {
  await window.MobileTavernPlugin.save("auto", { index });
  line.textContent = "存档已写入插件独立空间。";
});

document.querySelector("#load").addEventListener("click", async () => {
  const save = await window.MobileTavernPlugin.load("auto");
  if (save && Number.isInteger(save.index)) index = save.index % lines.length;
  render();
});

window.addEventListener("mobile-tavern:lifecycle", (event) => {
  if (event.detail === "pause") void window.MobileTavernPlugin.save("auto", { index });
});

render();

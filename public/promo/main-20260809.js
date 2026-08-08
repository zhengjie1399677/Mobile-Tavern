/* ==========================================================================
   Mobile Tavern - Modern SaaS Landing Page Interactions (Vanilla JS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. 动态聚光灯跟随后台效果
  const spotlight = document.getElementById('spotlight-glow');
  if (spotlight) {
    window.addEventListener('mousemove', (e) => {
      // 聚光灯轻微平滑滞后跟随鼠标坐标
      const x = e.clientX;
      const y = e.clientY;
      spotlight.style.left = `${x}px`;
      spotlight.style.top = `${y}px`;
    });
  }

  // 2. 云端下载统计展示（/stats 只读聚合，不含明细）
  const countEl = document.getElementById('download-count');
  if (countEl) {
    fetch('/stats', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('stats unavailable'))))
      .then((stats) => {
        countEl.textContent = String(stats.totalDownloads ?? 0);
      })
      .catch(() => {
        countEl.textContent = '-';
      });
  }

});

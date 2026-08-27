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

  // 2. 云端统计展示：页面访问与下载分开（/stats 只读聚合，不含明细）
  const visitEl = document.getElementById('page-visit-count');
  const countEl = document.getElementById('download-count');
  if (visitEl || countEl) {
    fetch('/stats', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('stats unavailable'))))
      .then((stats) => {
        if (visitEl) visitEl.textContent = String(stats.pageVisits?.total ?? 0);
        if (countEl) countEl.textContent = String(stats.downloads?.total ?? 0);
      })
      .catch(() => {
        if (visitEl) visitEl.textContent = '-';
        if (countEl) countEl.textContent = '-';
      });
  }

  // 3. 页面访问上报（与下载分开记录，sendBeacon 不阻塞页面卸载）
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/visit?page=tavern');
  } else {
    fetch('/visit?page=tavern', { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {});
  }

});

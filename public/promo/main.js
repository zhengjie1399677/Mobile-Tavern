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

});

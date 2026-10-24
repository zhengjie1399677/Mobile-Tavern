/* ==========================================================================
   Mobile Tavern - Modern SaaS Landing Page Interactions (Vanilla JS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // 1. 动态聚光灯跟随后台效果
  const spotlight = document.getElementById('spotlight-glow');
  if (spotlight) {
    window.addEventListener('mousemove', (e) => {
      spotlight.style.left = `${e.clientX}px`;
      spotlight.style.top = `${e.clientY}px`;
    });
  }

  // 数字动画递增辅助函数
  function animateValue(obj, start, end, duration) {
    if (!obj || isNaN(end) || end <= 0) return;
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const current = Math.floor(progress * (end - start) + start);
      obj.textContent = current.toLocaleString();
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        obj.textContent = end.toLocaleString();
      }
    };
    window.requestAnimationFrame(step);
  }

  // 2. 真实云端统计展示 (绝对不写死任何虚构假数据)
  const visitEl = document.getElementById('page-visit-count');
  const countEl = document.getElementById('download-count');
  if (visitEl || countEl) {
    fetch('/stats', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('stats unavailable'))))
      .then((stats) => {
        const totalVisits = Number(stats.pageVisits?.total ?? 0);
        const totalDl = Number(stats.downloads?.total ?? 0);
        if (visitEl) {
          if (totalVisits > 0) animateValue(visitEl, 0, totalVisits, 1000);
          else visitEl.textContent = '0';
        }
        if (countEl) {
          if (totalDl > 0) animateValue(countEl, 0, totalDl, 1000);
          else countEl.textContent = '0';
        }
      })
      .catch(() => {
        if (visitEl) visitEl.textContent = '-';
        if (countEl) countEl.textContent = '-';
      });
  }

  // 3. 页面访问上报
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/visit?page=tavern');
  } else {
    fetch('/visit?page=tavern', { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {});
  }

  // 4. 四大核心技术规范与教程 Tab 切换控制器
  const mountNode = document.getElementById('core-content-mount');
  const tabsNav = document.getElementById('core-tabs-nav');
  const tabIds = {
    quickstart: 'tpl-quickstart',
    plugins: 'tpl-plugins',
    agent: 'tpl-agent',
    css: 'tpl-css'
  };

  function renderCoreTab(targetKey = 'quickstart') {
    if (!mountNode) return;
    const tplId = tabIds[targetKey] || tabIds.quickstart;
    const tpl = document.getElementById(tplId);
    if (!tpl) return;

    mountNode.innerHTML = '';
    const clone = tpl.content.cloneNode(true);
    mountNode.appendChild(clone);

    if (tabsNav) {
      const btns = tabsNav.querySelectorAll('.tab-btn');
      btns.forEach((btn) => {
        if (btn.getAttribute('data-target') === targetKey) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  }

  if (tabsNav) {
    const btns = tabsNav.querySelectorAll('.tab-btn');
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target') || 'quickstart';
        renderCoreTab(target);
      });
    });
  }

  // 初始渲染 基础上手
  renderCoreTab('quickstart');

  // URL Hash 锚点自动联动
  if (window.location.hash) {
    const hashKey = window.location.hash.replace('#', '');
    if (tabIds[hashKey]) {
      renderCoreTab(hashKey);
    }
  }

  // 5. 移动端抽屉导航
  const hamburgerBtn = document.getElementById('btn-hamburger');
  const drawerOverlay = document.getElementById('mobile-drawer-overlay');
  const drawerNode = document.getElementById('mobile-drawer');
  const closeDrawerBtn = document.getElementById('btn-close-drawer');
  const drawerLinks = document.querySelectorAll('.drawer-link');

  function openDrawer() {
    drawerOverlay?.classList.add('is-active');
    drawerNode?.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawerOverlay?.classList.remove('is-active');
    drawerNode?.classList.remove('is-active');
    document.body.style.overflow = '';
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openDrawer);
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
  drawerLinks.forEach((l) => l.addEventListener('click', closeDrawer));

});

/* Dải "Giáo viên tiêu biểu" — tự trôi từ phải sang trái, chạy vòng liền mạch.
 *
 * Chuyển từ gói rời iPASS/section-giao-vien. Khác bản gốc ở 2 điểm, vì trang chủ được
 * support.js (React) dựng lại sau khi tải:
 *  - Bản sao để chạy vòng đã viết sẵn trong HTML (li[data-clone]), script KHÔNG sửa DOM.
 *  - Không giữ tham chiếu phần tử: mỗi khung hình tìm lại .teachers__viewport, và các sự kiện
 *    dừng/chạy gắn ở document (uỷ quyền), nên vẫn chạy sau khi React thay DOM.
 *
 * Dừng khi rê chuột, chạm, hoặc có phần tử trong dải nhận focus; không chạy khi máy bật giảm
 * chuyển động (khi đó CSS ẩn bản sao). Vùng cuộn thật (overflow-x) nên vẫn vuốt/lăn tay được.
 */
(() => {
  'use strict';

  const SPEED = 32;          // px mỗi giây
  const RESUME_DELAY = 1200; // rời chuột / thả tay bao lâu thì chạy tiếp
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let paused = false;
  let resumeTimer = 0;
  let lastTime = 0;
  let position = 0;      // vị trí cuộn chính xác (số lẻ)
  let lastApplied = -10; // scrollLeft thực tế sau lần đặt gần nhất
  let lastViewport = null;

  const parts = () => {
    const viewport = document.querySelector('.teachers__viewport');
    const track = viewport && viewport.querySelector('.teachers__track');
    if (!track) return null;
    const originals = track.querySelectorAll('.teachers__item:not([data-clone])');
    return originals.length >= 2 ? { viewport, track, originals } : null;
  };

  // bề rộng một vòng = từ mép trái thẻ gốc đầu tới mép phải thẻ gốc cuối, cộng một khoảng cách
  const loopWidth = ({ track, originals }) => {
    const first = originals[0].getBoundingClientRect();
    const last = originals[originals.length - 1].getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return last.right - first.left + gap;
  };

  const tick = now => {
    requestAnimationFrame(tick);
    if (!lastTime) { lastTime = now; return; }
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    // khoảng nhảy lớn (vừa chuyển tab về): bỏ một nhịp thay vì giật mạnh
    if (paused || reduceMotion.matches || dt <= 0 || dt > 0.1) return;

    const p = parts();
    if (!p) return;
    const span = loopWidth(p);
    if (span <= 0) return;
    // Trình duyệt làm tròn scrollLeft nên tự giữ vị trí lẻ; bước ~0,5px/khung hình mà cộng
    // thẳng vào scrollLeft thì bị làm tròn lên 1px → chạy nhanh gấp đôi. Nếu scrollLeft lệch
    // khỏi vị trí đã đặt (người dùng vuốt, hoặc React vừa thay DOM) thì lấy theo scrollLeft.
    if (p.viewport !== lastViewport || Math.abs(p.viewport.scrollLeft - lastApplied) > 1) {
      position = p.viewport.scrollLeft;
      lastViewport = p.viewport;
    }
    position += SPEED * dt;
    if (position >= span) position -= span; // hết một vòng → lùi về mốc tương đương, nội dung giống hệt
    p.viewport.scrollLeft = position;
    lastApplied = p.viewport.scrollLeft;
  };

  const pause = () => {
    paused = true;
    clearTimeout(resumeTimer);
  };
  const resumeLater = () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      paused = false;
      lastTime = 0;
    }, RESUME_DELAY);
  };
  const inStrip = node => !!(node && node.closest && node.closest('.teachers'));

  document.addEventListener('mouseover', event => { if (inStrip(event.target)) pause(); });
  document.addEventListener('mouseout', event => {
    if (inStrip(event.target) && !inStrip(event.relatedTarget)) resumeLater();
  });
  document.addEventListener('focusin', event => { if (inStrip(event.target)) pause(); });
  document.addEventListener('focusout', event => {
    if (inStrip(event.target) && !inStrip(event.relatedTarget)) resumeLater();
  });
  document.addEventListener('pointerdown', event => {
    if (event.target.closest && event.target.closest('.teachers__viewport')) pause();
  });
  // chạm/thả tay: chạy tiếp. Chuột thả ra mà vẫn đang nằm trên dải thì để hover giữ dừng.
  window.addEventListener('pointerup', event => {
    if (paused && (event.pointerType !== 'mouse' || !inStrip(event.target))) resumeLater();
  });
  document.addEventListener('visibilitychange', () => { lastTime = 0; });

  requestAnimationFrame(tick);
})();

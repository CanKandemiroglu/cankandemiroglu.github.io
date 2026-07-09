// Mobile nav + reveal-on-scroll + lightbox. Vanilla, no deps.
(function () {
  // ---- Mobile nav ----
  var toggle = document.querySelector('.nav__toggle');
  var list = document.querySelector('.nav__list');
  if (toggle && list) {
    toggle.addEventListener('click', function () {
      var open = list.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ---- Reveal on scroll ----
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  // ---- Lightbox (figure click-to-zoom) ----
  // Inject lightbox if there are figure viewers on the page.
  var viewers = document.querySelectorAll('.fig:not(.fig--placeholder) .fig__viewer');
  if (!viewers.length) return;

  var existing = document.querySelector('.lightbox');
  var lightbox = existing;
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.innerHTML = ''
      + '<button class="lightbox__close" aria-label="Close">×</button>'
      + '<img class="lightbox__img" alt="" />'
      + '<div class="lightbox__caption"></div>';
    document.body.appendChild(lightbox);
  }

  var lbImg   = lightbox.querySelector('.lightbox__img');
  var lbCap   = lightbox.querySelector('.lightbox__caption');
  var lbClose = lightbox.querySelector('.lightbox__close');

  function openLightbox(src, alt, captionHTML) {
    lbImg.src = src;
    lbImg.alt = alt || '';
    lbCap.innerHTML = captionHTML || '';
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }
  function closeLightbox() {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    lbImg.src = '';
    lbCap.innerHTML = '';
  }

  viewers.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var img = btn.querySelector('img');
      if (!img) return;
      var fig = btn.closest('figure');
      var cap = fig ? fig.querySelector('figcaption') : null;
      openLightbox(img.src, img.alt, cap ? cap.innerHTML : '');
    });
  });
  lbClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lightbox.classList.contains('is-open')) closeLightbox();
  });
})();

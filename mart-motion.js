/* Conyso Mart motion: sections, cards and list rows rise in as they scroll into view.
   Content is only hidden once this script runs and the reader allows motion, so a
   page without JavaScript (or with reduced motion) shows everything at once. */
(function () {
  // The home hero: photos from every brand, one fading into the next every five seconds.
  var slides = document.querySelector(".mart-vhero-slides");
  if (!slides) { return; }
  var imgs = slides.querySelectorAll("img"), at = 0, timer = null;
  imgs[0].classList.add("is-on");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || imgs.length < 2 || slides.offsetParent === null) { return; }
  function next() {
    imgs[at].classList.remove("is-on");
    at = (at + 1) % imgs.length;
    imgs[at].classList.add("is-on");
  }
  function play() { timer = setInterval(next, 5000); }
  play();
  var pause = document.querySelector(".mart-vhero-pause");
  if (pause) {
    pause.hidden = false;
    pause.addEventListener("click", function () {
      if (timer) { clearInterval(timer); timer = null; slides.classList.add("is-paused");
        pause.setAttribute("aria-label", "Play the slideshow"); pause.innerHTML = "&#9654;"; }
      else { play(); slides.classList.remove("is-paused");
        pause.setAttribute("aria-label", "Pause the slideshow"); pause.innerHTML = "&#10074;&#10074;"; }
    });
  }
})();

(function () {
  // The hero video is about 5 MB. Phones on mobile data get its poster; it only
  // loads on a wide screen with a fast connection and motion allowed.
  var v = document.querySelector("video[data-src]");
  // the poster too: a phone hides the desktop hero, so it should not download its 1200 px picture
  if (v && v.getAttribute("data-poster") && v.offsetParent !== null) { v.poster = v.getAttribute("data-poster"); }
  var c = navigator.connection || {};
  var slow = c.saveData || /(^|-)2g|3g/.test(c.effectiveType || "");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (v && !slow && !still && window.innerWidth >= 900) {
    v.src = v.getAttribute("data-src");
    v.autoplay = true;
    var p = v.play && v.play();
    if (p && p.catch) { p.catch(function () {}); }
    // moving pictures that last more than a few seconds get a pause control
    var pause = document.querySelector(".mart-vhero-pause");
    if (pause) {
      pause.hidden = false;
      pause.addEventListener("click", function () {
        if (v.paused) { v.play(); pause.setAttribute("aria-label", "Pause the video"); pause.innerHTML = "&#10074;&#10074;"; }
        else { v.pause(); pause.setAttribute("aria-label", "Play the video"); pause.innerHTML = "&#9654;"; }
      });
    }
  }
})();
(function () {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // decorative blocks only: products, prices, list rows and answers are never hidden while they load in
  var picks = "main > section:not(#favourites):not(.mart-aisles), .mart-way, .mart-photo, .mart-video";
  var els = Array.prototype.slice.call(document.querySelectorAll(picks));
  var fold = window.innerHeight;
  els = els.filter(function (el) { return el.getBoundingClientRect().top > fold * 0.9; });
  if (!els.length) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("mart-in"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  els.forEach(function (el, i) {
    el.classList.add("mart-rv");
    el.style.transitionDelay = (i % 4) * 60 + "ms";
    io.observe(el);
  });
})();

(function () {
  // scroll depth: hero photos drift a little slower than the page
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var layers = Array.prototype.slice.call(document.querySelectorAll(".mart-phero-art, .mart-vhero-media"));
  if (layers.length) {
    var ticking = false;
    var move = function () {
      var y = window.scrollY;
      layers.forEach(function (el) { el.style.setProperty("--mart-depth", Math.min(y, 600) * 0.18 + "px"); });
      ticking = false;
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(move); } }, { passive: true });
  }
  // pointer tilt on product cards, for a mouse only
  if (!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches)) return;
  document.addEventListener("pointermove", function (e) {
    var card = e.target.closest && e.target.closest(".mart-card");
    if (!card) return;
    var r = card.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--ry", (x * 8).toFixed(2) + "deg");
    card.style.setProperty("--rx", (-y * 8).toFixed(2) + "deg");
  });
  document.addEventListener("pointerout", function (e) {
    var card = e.target.closest && e.target.closest(".mart-card");
    if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty("--rx"); card.style.removeProperty("--ry"); }
  });
})();
(function () {
  // product photos: zoom where the mouse points; tap or click opens a full-screen viewer
  var zones = document.querySelectorAll("[data-zoom]");
  if (!zones.length) return;
  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var imgs = [];
  Array.prototype.forEach.call(zones, function (z) {
    Array.prototype.forEach.call(z.querySelectorAll("img"), function (img) { imgs.push(img); });
  });
  imgs.forEach(function (img, i) {
    img.classList.add("mart-zoomable");
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "Open photo " + (i + 1) + " full screen");
    if (fine) {
      img.addEventListener("pointermove", function (e) {
        var r = img.getBoundingClientRect();
        img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100).toFixed(1) + "% " + ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%";
        img.classList.add("is-zoomed");
      });
      img.addEventListener("pointerleave", function () { img.classList.remove("is-zoomed"); });
    }
    img.addEventListener("click", function () { open(i); });
    img.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); } });
  });
  var box, shown = 0, opener = null;
  function big(src) { return src.replace(/([?&])width=\d+/, "$1width=1600"); }
  function draw() {
    var img = imgs[shown];
    box.querySelector("img").src = big(img.currentSrc || img.src);
    box.querySelector("img").alt = img.alt || "";
    box.querySelector(".mart-lb-count").textContent = (shown + 1) + " / " + imgs.length;
  }
  function open(i) {
    if (!box) {
      box = document.createElement("dialog");
      box.className = "mart-lightbox";
      box.setAttribute("aria-label", "Product photos");
      box.innerHTML = '<img alt=""><button type="button" class="mart-lb-close" aria-label="Close">&#215;</button>' +
        '<button type="button" class="mart-lb-prev" aria-label="Previous photo">&#8249;</button>' +
        '<button type="button" class="mart-lb-next" aria-label="Next photo">&#8250;</button><span class="mart-lb-count"></span>';
      document.body.appendChild(box);
      box.querySelector(".mart-lb-close").addEventListener("click", function () { box.close(); });
      box.querySelector(".mart-lb-prev").addEventListener("click", function () { shown = (shown + imgs.length - 1) % imgs.length; draw(); });
      box.querySelector(".mart-lb-next").addEventListener("click", function () { shown = (shown + 1) % imgs.length; draw(); });
      box.addEventListener("click", function (e) { if (e.target === box) box.close(); });
      box.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft") box.querySelector(".mart-lb-prev").click();
        if (e.key === "ArrowRight") box.querySelector(".mart-lb-next").click();
      });
      box.addEventListener("close", function () { if (opener) opener.focus(); });
      if (imgs.length < 2) { box.querySelector(".mart-lb-prev").hidden = true; box.querySelector(".mart-lb-next").hidden = true; }
    }
    opener = imgs[i]; shown = i; draw();
    if (box.showModal) box.showModal(); else box.setAttribute("open", "");
  }
})();

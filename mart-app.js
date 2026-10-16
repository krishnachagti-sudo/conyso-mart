/* Conyso Mart on a phone: the app layer.
 * - the top bar's countdown to today's cutoff
 * - Back that behaves like an app's back (returns where you came from)
 * - brand story circles: a full-screen story per brand, tap through, swipe down to close
 * - the cart sheet closes with a swipe down
 * - offline support and "add to home screen" (service worker)
 * Everything here is an enhancement: with it off, the links and pages still work.
 */
(function (root) {
  "use strict";
  var doc = root.document;

  function buildData() {
    try { return JSON.parse(doc.getElementById("mart-build-data").textContent); } catch (e) { return {}; }
  }

  // top bar: "order in 2 h 14 min", or "order by 6 pm" for tomorrow
  function countdown() {
    var slot = doc.querySelector("[data-app-countdown]"), day = doc.querySelector("[data-app-day]"), M = root.MartCore;
    if (!slot || !M || typeof M.cutoffLeft !== "function") { return; }
    var town = (buildData().town) || {};
    function tick() {
      var left = M.cutoffLeft(new Date(), town);
      var late = left === null || left === undefined;
      if (day) { day.textContent = late ? "Free delivery tomorrow" : "Free delivery today"; }
      if (late) {
        slot.textContent = "order now";
      } else {
        var h = Math.floor(left / 60), m = left % 60;
        slot.textContent = "order in " + (h ? h + " h " : "") + m + " min";
      }
    }
    tick();
    setInterval(tick, 30000);
  }

  // Back: if you came from another Mart page, go back to it (keeps your scroll), else go up a level
  function back() {
    Array.prototype.forEach.call(doc.querySelectorAll("[data-back]"), function (a) {
      a.addEventListener("click", function (e) {
        var ref = doc.referrer;
        if (ref && ref.indexOf(root.location.origin) === 0 && ref.indexOf("/mart/") > -1 && root.history.length > 1) {
          e.preventDefault();
          root.history.back();
        }
      });
    });
  }

  // ---------- brand stories ----------
  var stories = null, viewer = null, current = null, step = 0, timer = null, lastFocus = null;
  var STEP_MS = 6000;

  function load() {
    if (stories) { return Promise.resolve(stories); }
    return root.fetch("stories.json").then(function (r) { return r.json(); }).then(function (d) { stories = d; return d; });
  }

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined) { n.textContent = text; }
    return n;
  }

  function build() {
    viewer = el("div", "mart-story-viewer");
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "Brand story");
    viewer.hidden = true;
    viewer.innerHTML =
      '<div class="mart-sv-bars"></div>' +
      '<div class="mart-sv-head"><span class="mart-sv-logo"></span><b class="mart-sv-name"></b><span class="mart-sv-meta"></span>' +
      '<button type="button" class="mart-sv-close" aria-label="Close story">&times;</button></div>' +
      '<figure class="mart-sv-photo"><img alt="" referrerpolicy="no-referrer"></figure>' +
      '<p class="mart-sv-text" aria-live="polite"></p>' +
      '<button type="button" class="mart-sv-prev" aria-label="Previous"></button>' +
      '<button type="button" class="mart-sv-next" aria-label="Next"></button>' +
      '<div class="mart-sv-cta"></div>';
    doc.body.appendChild(viewer);
    viewer.querySelector(".mart-sv-close").addEventListener("click", close);
    viewer.querySelector(".mart-sv-prev").addEventListener("click", function () { go(step - 1); });
    viewer.querySelector(".mart-sv-next").addEventListener("click", function () { go(step + 1); });
    viewer.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); }
      if (e.key === "ArrowRight") { go(step + 1); }
      if (e.key === "ArrowLeft") { go(step - 1); }
    });
    // hold to pause, swipe down to close
    var y0 = null;
    viewer.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; pause(); }, { passive: true });
    viewer.addEventListener("touchend", function (e) {
      var dy = y0 === null ? 0 : e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy > 90) { close(); } else { resume(); }
    });
  }

  function pause() { clearTimeout(timer); viewer.classList.add("is-paused"); }
  function resume() { viewer.classList.remove("is-paused"); schedule(); }
  function schedule() {
    clearTimeout(timer);
    if (root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches) { return; }
    timer = setTimeout(function () { go(step + 1); }, STEP_MS);
  }

  function go(i) {
    var s = current;
    if (!s) { return; }
    if (i < 0) { i = 0; }
    if (i >= s.slides.length) { close(); return; }
    step = i;
    var slide = s.slides[i];
    var bars = viewer.querySelector(".mart-sv-bars");
    Array.prototype.forEach.call(bars.children, function (b, k) {
      b.className = k < i ? "is-done" : (k === i ? "is-now" : "");
    });
    var img = viewer.querySelector(".mart-sv-photo img");
    viewer.querySelector(".mart-sv-photo").hidden = !slide.photo;
    if (slide.photo) { img.src = slide.photo; }
    viewer.querySelector(".mart-sv-text").textContent = slide.text;
    var cta = viewer.querySelector(".mart-sv-cta");
    cta.innerHTML = "";
    var last = i === s.slides.length - 1;
    var links = last ? s.cta : [{ href: s.page, label: "See " + s.name }];
    links.forEach(function (c, k) {
      var a = el("a", "mart-sv-btn" + (c.wa ? " is-wa" : "") + (k ? " is-light" : ""), c.label);
      a.href = c.href;
      if (c.wa) { a.rel = "noopener"; }
      cta.appendChild(a);
    });
    schedule();
  }

  function open(id) {
    load().then(function (all) {
      var s = all[id];
      if (!s) { root.location.href = "brand-" + id + ".html"; return; }
      if (!viewer) { build(); }
      current = s;
      lastFocus = doc.activeElement;
      var logo = viewer.querySelector(".mart-sv-logo");
      logo.innerHTML = "";
      logo.classList.toggle("is-dark", !!s.dark);
      if (s.logo) {
        var li = el("img"); li.src = s.logo; li.alt = ""; li.referrerPolicy = "no-referrer"; logo.appendChild(li);
      } else { logo.textContent = s.name.slice(0, 2).toUpperCase(); }
      viewer.querySelector(".mart-sv-name").textContent = s.name;
      viewer.querySelector(".mart-sv-meta").textContent = s.meta || "";
      viewer.querySelector(".mart-sv-bars").innerHTML = s.slides.map(function () { return "<i></i>"; }).join("");
      viewer.hidden = false;
      doc.documentElement.classList.add("mart-sv-open");
      viewer.querySelector(".mart-sv-close").focus();
      go(0);
      try { root.history.pushState({ martStory: id }, ""); } catch (e) {}
    }).catch(function () { root.location.href = "brand-" + id + ".html"; });
  }

  function close(fromHistory) {
    if (!viewer || viewer.hidden) { return; }
    clearTimeout(timer);
    viewer.hidden = true;
    doc.documentElement.classList.remove("mart-sv-open");
    current = null;
    if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
    if (fromHistory !== true) {
      try {
        if (root.history.state && root.history.state.martStory) {
          root.__martSkipPop = (root.__martSkipPop || 0) + 1;  // mart.js must not close the cart for this one
          root.history.back();
        }
      } catch (e) {}
    }
  }

  function circles() {
    var list = doc.querySelectorAll(".mart-circle[data-story]");
    if (!list.length || !root.fetch) { return; }
    root.addEventListener("popstate", function () { close(true); });
    Array.prototype.forEach.call(list, function (a) {
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { return; }
        e.preventDefault();
        open(a.getAttribute("data-story"));
      });
      // seen circles lose their ring, the way story apps show what's new
      try {
        var seen = JSON.parse(root.localStorage.getItem("mart-seen") || "[]");
        if (seen.indexOf(a.getAttribute("data-story")) > -1) { a.classList.add("is-seen"); }
        a.addEventListener("click", function () {
          var id = a.getAttribute("data-story");
          if (seen.indexOf(id) < 0) { seen.push(id); root.localStorage.setItem("mart-seen", JSON.stringify(seen)); }
          a.classList.add("is-seen");
        });
      } catch (e) {}
    });
  }

  // the cart sheet: drag its top edge down to close it
  function sheet() {
    var aside = doc.getElementById("mart-cart"), head = aside && aside.querySelector(".mart-cart-head");
    if (!head) { return; }
    var y0 = null, dy = 0;
    head.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; dy = 0; aside.style.transition = "none"; }, { passive: true });
    head.addEventListener("touchmove", function (e) {
      if (y0 === null) { return; }
      dy = Math.max(0, e.touches[0].clientY - y0);
      aside.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    head.addEventListener("touchend", function () {
      aside.style.transition = ""; aside.style.transform = "";
      if (dy > 100) { var c = doc.getElementById("mart-cart-close"); if (c) { c.click(); } }
      y0 = null;
    });
  }

  function offline() {
    if (!("serviceWorker" in root.navigator) || root.location.protocol !== "https:" && root.location.hostname !== "localhost") { return; }
    root.addEventListener("load", function () {
      root.navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});
    });
  }

  // a brand's photo that fails to load (moved, blocked) never leaves a broken box:
  // a captioned figure goes away, any other photo becomes a plain tinted tile
  doc.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || img.classList.contains("is-broken")) { return; }
    img.classList.add("is-broken");
    var fig = img.closest("figure");
    if (fig && fig.querySelectorAll("img:not(.is-broken)").length === 0) { fig.hidden = true; return; }
    // a card's photo: the brand's initials take its place, like a brand with no photo at all
    var card = img.closest(".mart-ask-card, .mart-coming-card, .mart-range li, .mart-hub-strip li");
    var name = card && card.querySelector(".mart-ask-name, b, span");
    if (name) {
      var mono = doc.createElement("span");
      mono.className = "mart-monogram mart-ask-mono";
      mono.setAttribute("aria-hidden", "true");
      mono.textContent = name.textContent.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
      img.replaceWith(mono);
    }
  }, true);

  // product pages: the buy bar comes up only once the page's own Add button has scrolled away
  function buybar() {
    var bar = doc.querySelector(".mart-buybar"), add = doc.querySelector(".mart-product .mart-add");
    if (!bar || !add || !("IntersectionObserver" in root)) { return; }
    doc.documentElement.classList.add("has-buybar-js");
    new IntersectionObserver(function (en) {
      bar.classList.toggle("is-shown", !en[0].isIntersecting && en[0].boundingClientRect.top < 0);
    }).observe(add);
  }

  function broken() {  // photos that failed before this script ran
    Array.prototype.forEach.call(doc.images, function (img) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) { img.dispatchEvent(new Event("error")); }
    });
  }

  // the type chips on an aisle page scroll so the current one is in view
  function chips() {
    var cur = doc.querySelector(".mart-type-chips [aria-current]");
    var row = cur && cur.closest("ul");
    if (row && row.scrollWidth > row.clientWidth) { row.scrollLeft = cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2; }
  }

  function start() { countdown(); back(); circles(); sheet(); buybar(); broken(); chips(); }
  offline();
  if (doc.readyState === "loading") { doc.addEventListener("DOMContentLoaded", start); } else { start(); }
})(this);

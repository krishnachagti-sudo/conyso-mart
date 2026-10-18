/* Conyso Mart: the page. Reads live data (falling back to the copy embedded
   at build time), filters the shop, keeps the cart in localStorage, and turns
   the cart into a WhatsApp message. The orders POST is a convenience: it
   never blocks the WhatsApp order. */
(function (root) {
  "use strict";

  function isList(x) { return Array.isArray(x); }

  function loadData(fetchFn, base, buildData) {
    var fallback = { data: { towns: [buildData.town], products: buildData.products, brands: buildData.brands }, stale: true };
    if (!base) { return Promise.resolve(fallback); }
    var get = function (kind) {
      return fetchFn(base + kind + ".json").then(function (r) {
        if (!r.ok) { throw new Error("http"); }
        return r.json();
      }).then(function (x) { if (!isList(x)) { throw new Error("shape"); } return x; });
    };
    return Promise.all([get("towns"), get("products"), get("brands")]).then(function (v) {
      return { data: { towns: v[0], products: v[1], brands: v[2] }, stale: false };
    }).catch(function () { return fallback; });
  }

  function postOrder(fetchFn, base, order, timeoutMs) {
    if (!base) { return Promise.resolve(false); }
    // Older phone browsers have no AbortController; there the POST simply races
    // a timer, so WhatsApp still opens within the time limit.
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer, timeout = new Promise(function (res) {
      timer = setTimeout(function () { if (ctl) { ctl.abort(); } res(false); }, timeoutMs || 2000);
    });
    var opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) };
    if (ctl) { opts.signal = ctl.signal; }
    var send = Promise.resolve().then(function () { return fetchFn(base + "orders", opts); })
      .then(function (r) { return !!(r && r.ok); })
      .catch(function () { return false; });
    return Promise.race([send, timeout]).then(function (ok) { clearTimeout(timer); return ok; });
  }

  function start() {
    var doc = root.document, M = root.MartCore;
    var has = function (f) { return !!(M && typeof M[f] === "function"); };
    var $ = function (id) { return doc.getElementById(id); };

    // Back closes whatever layer is open (cart, menu), the way phone users expect
    var layers = [], skipPops = 0;
    function pushLayer(close) {
      layers.push(close);
      try { root.history.pushState({ martLayer: layers.length }, ""); } catch (e) {}
    }
    function popLayer(close) {
      // closing by hand: drop the history entry we added for this layer
      var i = layers.lastIndexOf(close);
      if (i < 0) { return; }
      var top = i === layers.length - 1;
      layers.splice(i, 1);
      // only the top layer owns the newest history entry; going back for a lower
      // one (menu closed by opening the cart) would pop the cart instead
      if (!top) { return; }
      try { if (root.history.state && root.history.state.martLayer) { skipPops++; root.history.back(); } } catch (e) {}
    }
    root.addEventListener("popstate", function () {
      if (skipPops) { skipPops--; return; }
      // the brand story viewer (mart-app.js) closing itself: not ours to handle
      if (root.__martSkipPop) { root.__martSkipPop--; return; }
      var close = layers.pop();
      if (close) { close(true); }
    });

    // The laptop's top bar (2026-10-18, after the Poshan nav): past about 80 px it lifts into a floating rounded bar
    // (html.mart-float), and Menu opens the panel (#mart-panel) that grows out of it. Escape, a click outside, Back or a
    // link inside shuts it; Tab stays inside the bar while it is open. Phones never see this bar (mart-app.js has the dock).
    var bar = doc.querySelector(".mart-nav"), menuBtn = doc.querySelector(".mart-menu-btn"), panel = $("mart-panel"),
      html = doc.documentElement, menuLabel = menuBtn && menuBtn.querySelector(".mart-ml"), menuOpen = false, floatBusy = false;
    var desk = root.matchMedia ? root.matchMedia("(min-width: 700px)") : { matches: true };
    function setFloat() {
      floatBusy = false;
      if (bar && !menuOpen) { html.classList.toggle("mart-float", desk.matches && (root.pageYOffset || 0) > 80); }
    }
    root.addEventListener("scroll", function () {
      if (!floatBusy) { floatBusy = true; (root.requestAnimationFrame || setTimeout)(setFloat); }
    }, { passive: true });
    setFloat();
    function setMenu(open, fromHistory, back) {
      if (!panel || !menuBtn || open === menuOpen) { return; }
      menuOpen = open;
      html.classList.toggle("mart-nav-open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (menuLabel) { menuLabel.textContent = open ? "Close" : "Menu"; }
      if (open) {
        pushLayer(menuClose);
        var first = panel.querySelector("a[href]");
        setTimeout(function () { if (menuOpen && first) { first.focus({ preventScroll: true }); } }, 60);
      } else {
        if (!fromHistory) { popLayer(menuClose); }
        if (back) { menuBtn.focus({ preventScroll: true }); }
        setFloat();
      }
    }
    function menuClose(fromHistory) { setMenu(false, fromHistory); }
    if (menuBtn && panel && bar) {
      html.classList.add("mart-js");
      menuBtn.addEventListener("click", function () { setMenu(!menuOpen, false, true); });
      doc.addEventListener("click", function (e) {
        if (menuOpen && (!bar.contains(e.target) || (e.target.closest && e.target.closest(".mart-cart-btn")))) { setMenu(false); }
      });
      // a link inside leaves the page (or scrolls this one): shut without going Back
      panel.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a[href]")) { setMenu(false, true); } });
      doc.addEventListener("keydown", function (e) {
        if (!menuOpen) { return; }
        if (e.key === "Escape") { e.preventDefault(); setMenu(false, false, true); return; }
        if (e.key !== "Tab") { return; }
        var f = [].slice.call(bar.querySelectorAll("a[href], button")).filter(function (el) { return el.offsetWidth || el.offsetHeight; });
        if (!f.length) { return; }
        var a = doc.activeElement;
        if (e.shiftKey && (a === f[0] || !bar.contains(a))) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (a === f[f.length - 1] || !bar.contains(a))) { e.preventDefault(); f[0].focus(); }
      });
      var change = function () { if (!desk.matches) { setMenu(false); } setFloat(); };
      if (desk.addEventListener) { desk.addEventListener("change", change); } else if (desk.addListener) { desk.addListener(change); }
    }

    var buildEl = $("mart-build-data");
    if (!buildEl || !M) { return; }
    var build = JSON.parse(buildEl.textContent);
    var setting = (doc.querySelector('meta[name="mart-data"]') || {}).content || "";
    var base = setting; // live data only from a configured backend; the page already carries the catalogue
    var apiBase = setting;
    var townId = doc.body.getAttribute("data-town");
    var key = "conyso-mart-cart-" + townId, lastKey = "conyso-mart-last-order-" + townId;
    var state = { town: build.town, byId: {}, cart: { items: {} }, brandNames: {} };
    (build.brands || []).forEach(function (b) { state.brandNames[b.id] = b.name; });

    // storage: localStorage, then this tab's session; say so if neither works
    var store = null;
    ["localStorage", "sessionStorage"].some(function (k) {
      try { var s = root[k]; s.setItem("conyso-mart-probe", "1"); s.removeItem("conyso-mart-probe"); store = s; return true; }
      catch (e) { return false; }
    });
    var load = function (k) { try { return store ? JSON.parse(store.getItem(k)) : null; } catch (e) { return null; } };
    var keep = function (k, v) { try { if (store) { if (v === null) { store.removeItem(k); } else { store.setItem(k, JSON.stringify(v)); } } } catch (e) {} };
    state.cart = load(key) || { items: {} };
    var save = function () { keep(key, state.cart); };

    var aside = $("mart-cart"), btn = doc.querySelector(".mart-cart-btn");
    var rupees = has("rupees") ? M.rupees : function (n) { return "₹" + n; };
    var desktop = function () { return !!(root.matchMedia && root.matchMedia("(pointer: fine)").matches) && root.innerWidth >= 900; };

    function index(products) {
      state.byId = {};
      products.forEach(function (p) { state.byId[p.id] = p; });
    }

    function qtyOf(id) { return (state.cart.items || {})[id] || 0; }

    // the static aria-label names the product; keep it in step with what the button shows
    function speak(b, tail) {
      var base = b.getAttribute("data-label");
      if (base === null) { base = b.getAttribute("aria-label") || ""; b.setAttribute("data-label", base); }
      if (base) { b.setAttribute("aria-label", base + tail); }
    }
    function labelAdds() {
      Array.prototype.forEach.call(doc.querySelectorAll(".mart-add[data-id]"), function (b) {
        if (b.disabled || b.getAttribute("data-flash")) { return; }
        var n = qtyOf(b.getAttribute("data-id"));
        b.textContent = n ? "Add (" + n + " in cart)" : "Add";
        speak(b, n ? ", " + n + " in cart" : "");
      });
    }

    function suggestions() {
      var picks = Object.keys(state.byId).map(function (id) { return state.byId[id]; })
        .filter(function (p) { return p.in_stock; }).slice(0, 4);
      if (!picks.length) { return ""; }
      return '<ul class="mart-cart-suggest">' + picks.map(function (p) {
        return '<li><img alt="" width="48" height="48" src="' + String(p.photo).replace(/"/g, "&quot;") + '"><span></span>' +
          '<button type="button" class="mart-add" data-id="' + p.id + '">Add</button></li>';
      }).join("") + "</ul>";
    }

    function render() {
      var r = M.cartLines(state.cart, state.byId, state.town);
      var count = r.lines.reduce(function (n, l) { return n + l.qty; }, 0);
      if ($("mart-cart-count")) { $("mart-cart-count").textContent = String(count); }
      // the phone tab bar's Cart badge
      Array.prototype.forEach.call(doc.querySelectorAll("[data-cart-count]"), function (b) {
        b.textContent = String(count); b.hidden = !count;
      });
      labelAdds();
      if (!$("mart-cart-lines")) { return r; }
      var empty = !r.lines.length;
      aside.classList.toggle("is-empty", empty);
      $("mart-cart-lines").innerHTML = "";
      if (empty) {
        $("mart-cart-lines").innerHTML = '<div class="mart-cart-empty"><p>Your cart is empty.</p>' + suggestions() +
          '<p><a href="shop.html">See everything we deliver</a></p></div>';
        Array.prototype.forEach.call($("mart-cart-lines").querySelectorAll(".mart-cart-suggest li"), function (li, i) {
          var p = state.byId[li.querySelector("button").getAttribute("data-id")];
          li.querySelector("span").textContent = p.name + ", " + p.size + ", " + rupees(M.displayPrice(p, state.town).price);
        });
        keep(lastKey, null);
      }
      r.lines.forEach(function (l) {
        var p = state.byId[l.id] || {};
        var row = doc.createElement("div");
        row.className = "mart-line";
        row.innerHTML = '<img class="mart-line-img" alt="" width="56" height="56">' +
          '<div class="mart-line-main"><span class="mart-line-name"></span>' +
          '<div class="mart-qty"><button type="button" class="mart-qty-down">&#8722;</button>' +
          '<input type="number" min="1" max="' + M.MAX_QTY + '" inputmode="numeric">' +
          '<button type="button" class="mart-qty-up">+</button></div>' +
          '<button type="button" class="mart-line-remove">Remove</button><p class="mart-line-note" hidden></p></div>' +
          '<span class="mart-line-total"></span>';
        var img = row.querySelector("img");
        if (p.photo) { img.src = p.photo; } else { img.remove(); }
        var brand = state.brandNames[l.brand] ? state.brandNames[l.brand] + " " : "";
        row.querySelector(".mart-line-name").textContent = brand + l.name + ", " + l.size;
        var q = row.querySelector("input");
        q.value = String(l.qty);
        q.setAttribute("aria-label", "Quantity of " + l.name);
        var down = row.querySelector(".mart-qty-down"), up = row.querySelector(".mart-qty-up");
        down.setAttribute("aria-label", "One less " + l.name);
        up.setAttribute("aria-label", "One more " + l.name);
        row.querySelector(".mart-line-remove").setAttribute("aria-label", "Remove " + l.name);
        down.disabled = l.qty <= 1; // removing is Remove's job, with an undo
        if (l.qty >= M.MAX_QTY) {
          up.disabled = true;
          var note = row.querySelector(".mart-line-note");
          note.hidden = false;
          note.textContent = "Up to " + M.MAX_QTY + " per item online. For more, message us on WhatsApp.";
        }
        function set(n) { state.cart = M.cartSet(state.cart, l.id, n); save(); render(); }
        q.addEventListener("change", function () { set(Math.max(1, Number(q.value) || 1)); });
        down.addEventListener("click", function () { set(Math.max(1, l.qty - 1)); });
        up.addEventListener("click", function () { set(l.qty + 1); });
        row.querySelector(".mart-line-remove").addEventListener("click", function () {
          var was = l.qty;
          set(0);
          toast("Removed " + l.name + ".", "Undo", function () { state.cart = M.cartSet(state.cart, l.id, was); save(); render(); });
        });
        row.querySelector(".mart-line-total").textContent = rupees(l.total);
        $("mart-cart-lines").appendChild(row);
      });
      $("mart-cart-total").textContent = rupees(r.total);
      var oos = r.dropped.map(function (d) { return d.name + " (" + d.reason + ")"; });
      $("mart-dropped").hidden = !oos.length;
      $("mart-dropped").textContent = oos.length ? "Not in this order: " + oos.join(", ") : "";
      var cut = has("timeLabel") ? M.timeLabel(state.town.cutoff) : state.town.cutoff;
      var left = has("cutoffLeft") ? M.cutoffLeft(new Date(), state.town) : null;
      $("mart-promise").textContent = left !== null && has("countdownText")
        ? M.countdownText(left) + "."
        : "Free delivery tomorrow. Orders by " + cut + " arrive the same day.";
      $("mart-order").disabled = empty;
      // an order already sent from this cart: say so, so it isn't sent twice
      var last = load(lastKey), banner = $("mart-last-order");
      if (banner) {
        banner.hidden = !(last && !empty);
        if (last && !empty) {
          banner.querySelector("span").textContent = "Order " + last.id + " was opened in WhatsApp at " + last.time + ". Sent it? Start a new order. Not sent? Tap Order on WhatsApp again.";
        }
      }
      if ($("mart-nostore")) { $("mart-nostore").hidden = !!store; }
      return r;
    }

    function filter() {
      var b = ($("mart-filter-brand") || {}).value || "", c = ($("mart-filter-category") || {}).value || "";
      Array.prototype.forEach.call(doc.querySelectorAll(".mart-card"), function (el) {
        var show = (!b || el.getAttribute("data-brand") === b) && (!c || el.getAttribute("data-category") === c);
        el.classList.toggle("is-hidden", !show);
      });
    }

    function applyStock() {
      Array.prototype.forEach.call(doc.querySelectorAll(".mart-card"), function (el) {
        var p = state.byId[el.getAttribute("data-id")];
        el.classList.toggle("is-out", !(p && p.in_stock));
        var pe = el.querySelector(".mart-card-price");
        if (p && pe) {
          var d = M.displayPrice(p, state.town);
          pe.innerHTML = '<span class="mart-price"></span>' + (d.struck ? ' <s class="mart-mrp"></s>' : "");
          pe.querySelector(".mart-price").textContent = rupees(d.price);
          if (d.struck) { pe.querySelector(".mart-mrp").textContent = rupees(d.mrp); }
        }
      });
      // every Add on the page follows live stock: cards, the product page, the buy bar
      if (state.town.live) {
        Array.prototype.forEach.call(doc.querySelectorAll(".mart-add[data-id]"), function (b) {
          var p = state.byId[b.getAttribute("data-id")], ok = !!(p && p.in_stock);
          b.disabled = !ok;
          if (!ok) { b.textContent = "Out of stock"; speak(b, ", out of stock"); }
        });
      }
      labelAdds();
    }

    doc.addEventListener("click", function (e) {
      var add = e.target.closest && e.target.closest(".mart-add");
      if (add && !add.disabled) {
        var id = add.getAttribute("data-id"), p = state.byId[id] || {};
        if (qtyOf(id) >= M.MAX_QTY) {
          toast("Up to " + M.MAX_QTY + " per item online. Message us for more.");
          return;
        }
        state.cart = M.cartAdd(state.cart, id);
        save(); render();
        add.setAttribute("data-flash", "1");
        add.textContent = "Added";
        setTimeout(function () { add.removeAttribute("data-flash"); labelAdds(); }, 1200);
        toast("Added " + (p.name || "") + ".", "View cart", function () { setOpen(true); });
        flyToCart(add);
        var count = $("mart-cart-count");
        if (count) { count.classList.remove("is-bump"); void count.offsetWidth; count.classList.add("is-bump"); }
      }
      // sharing: the phone's own share sheet when there is one (WhatsApp groups, Instagram, copy link)
      var share = e.target.closest && e.target.closest(".mart-share");
      if (share && root.navigator.share && !desktop()) {
        e.preventDefault();
        root.navigator.share({ title: share.getAttribute("data-title") || doc.title,
          text: share.getAttribute("data-text") || "", url: share.getAttribute("data-url") || root.location.href }).catch(function () {});
      }
    });

    // card hover photo: only for a mouse, never on a phone. It is fetched ahead, once
    // its card is near the screen, and only shown once it has arrived, so a hover
    // never reveals an empty frame.
    if (root.matchMedia && root.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      var loadAlt = function (alt) {
        if (!alt || !alt.getAttribute("data-src")) { return; }
        alt.addEventListener("load", function () { alt.classList.add("is-ready"); }, { once: true });
        alt.src = alt.getAttribute("data-src");
        alt.removeAttribute("data-src");
      };
      var alts = doc.querySelectorAll("img.mart-card-alt[data-src]");
      if ("IntersectionObserver" in root) {
        var near = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) { near.unobserve(en.target); loadAlt(en.target); } });
        }, { rootMargin: "300px" });
        Array.prototype.forEach.call(alts, function (a) { near.observe(a); });
      }
      doc.addEventListener("pointerover", function (e) {
        var card = e.target.closest && e.target.closest(".mart-card");
        loadAlt(card && card.querySelector("img.mart-card-alt[data-src]"));
      });
    }

    // product pages: a live countdown to the cutoff, refreshed every half minute
    var slot = doc.querySelector("[data-countdown]");
    function tick() {
      if (!slot || !state.town.live || !has("cutoffLeft") || !has("countdownText")) { return; }
      var text = M.countdownText(M.cutoffLeft(new Date(), state.town));
      slot.textContent = text || "Free delivery tomorrow if you order now.";
      slot.classList.toggle("is-tomorrow", !text);
    }
    tick();
    if (slot) { setInterval(tick, 30000); }

    // a copy of the product photo arcs into the Cart button, so the eye follows the add
    function flyToCart(from) {
      var still = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var card = from.closest(".mart-card");
      var img = (card && card.querySelector("img")) || doc.querySelector(".mart-product img");
      if (still || !btn || !img || !img.animate) { return; }
      var a = img.getBoundingClientRect(), b = btn.getBoundingClientRect();
      if (!a.width) { return; }
      var size = Math.min(a.width, 120);
      var fly = img.cloneNode(false);
      fly.removeAttribute("style"); fly.removeAttribute("loading"); fly.className = "mart-fly"; fly.alt = "";
      fly.style.left = (a.left + a.width / 2 - size / 2) + "px";
      fly.style.top = (a.top + a.height / 2 - size / 2) + "px";
      fly.style.width = size + "px"; fly.style.height = size + "px";
      doc.body.appendChild(fly);
      var dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      fly.animate([
        { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
        { transform: "translate(" + dx * 0.55 + "px, " + (dy * 0.55 - 80) + "px) scale(0.6) rotate(-12deg)", opacity: 1, offset: 0.55 },
        { transform: "translate(" + dx + "px, " + dy + "px) scale(0.15) rotate(-20deg)", opacity: 0.4 }
      ], { duration: 650, easing: "cubic-bezier(.45,.05,.55,.95)" }).onfinish = function () { fly.remove(); };
    }

    // a note after an action, with one follow-up (View cart, Undo). The button
    // sits outside the status region, so screen readers hear only the words.
    var toastTimer, toastAction = null;
    function toast(words, label, action) {
      var t = $("mart-toast");
      if (!t) {
        t = doc.createElement("div");
        t.id = "mart-toast";
        t.innerHTML = '<span role="status"></span><button type="button"></button>';
        t.querySelector("button").addEventListener("click", function () {
          t.hidden = true;
          if (toastAction) { toastAction(); }
        });
        doc.body.appendChild(t);
      }
      t.querySelector("span").textContent = words;
      var b = t.querySelector("button");
      b.hidden = !label; b.textContent = label || "";
      toastAction = action || null;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
    }

    // The cart is a dialog: the page behind goes inert while it is open, focus
    // moves in, and Escape, Close, Back or a tap outside closes it.
    // everything on the page except the cart and its toast, so Tab never leaves the dialog
    var behind = Array.prototype.filter.call(doc.body.children, function (el) {
      return el !== aside && el.id !== "mart-toast" && el.tagName !== "SCRIPT";
    });
    function setOpen(open, fromHistory) {
      if (!aside || open === !aside.hidden) { return; }
      aside.hidden = !open;
      behind.forEach(function (el) { if (open) { el.setAttribute("inert", ""); } else { el.removeAttribute("inert"); } });
      if (btn) { btn.setAttribute("aria-expanded", open ? "true" : "false"); }
      if (open) {
        pushLayer(cartClose);
        render();
        var first = $("mart-cart-close") || aside.querySelector("button, input");
        if (first) { first.focus(); }
      } else {
        if (!fromHistory) { popLayer(cartClose); }
        // focus goes back to whichever Cart button is on screen: the header's, or the phone's tab
        var back = btn && btn.offsetParent ? btn : doc.querySelector("[data-open-cart]");
        if (back) { back.focus(); }
      }
    }
    function cartClose(fromHistory) { setOpen(false, fromHistory); }
    if (btn && aside) { btn.addEventListener("click", function () { setOpen(aside.hidden); }); }
    // the phone's Cart tab opens the same cart, as a sheet from the bottom
    Array.prototype.forEach.call(doc.querySelectorAll("[data-open-cart]"), function (b) {
      b.addEventListener("click", function () { if (aside) { setOpen(aside.hidden); } });
    });
    // the cart page is only a way in to the cart: open it straight away
    if (doc.body.getAttribute("data-page") === "cart" && aside) { setOpen(true); }
    if ($("mart-cart-close")) { $("mart-cart-close").addEventListener("click", function () { setOpen(false); }); }
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && aside && !aside.hidden) { setOpen(false); } });
    doc.addEventListener("click", function (e) {
      // a tap on + or Remove re-renders the lines, so its target is gone from the page by now
      if (!e.target.isConnected) { return; }
      if (!aside || aside.hidden || aside.contains(e.target) || (btn && btn.contains(e.target))) { return; }
      if (e.target.closest && e.target.closest("[data-open-cart]")) { return; }
      if (e.target.closest && e.target.closest("#mart-toast, .mart-add")) { return; }
      setOpen(false);
    });
    ["mart-filter-brand", "mart-filter-category"].forEach(function (id) { if ($(id)) { $(id).addEventListener("change", filter); } });

    var form = $("mart-order-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var orderBtn = $("mart-order");
        if (orderBtn.disabled) { return; }
        var r = render();
        if (!r.lines.length) { return; }
        var f = new FormData(form), now = new Date();
        var phone = String(f.get("phone") || "").replace(/[^\d+]/g, "");
        var customer = { name: f.get("name"), phone: phone, address: f.get("address"), landmark: f.get("landmark") || "" };
        var id = M.orderId(state.town, now, Math.random);
        var promise = M.deliveryPromise(now, state.town); // evaluated now, at the click
        var when = has("dayLabel") ? M.dayLabel(now, state.town.timezone, promise === "today" ? 0 : 1) : "";
        var message = M.buildMessage({ id: id, town: state.town, lines: r.lines, total: r.total, dropped: r.dropped,
          customer: customer, promise: promise, when: when, brandNames: state.brandNames });
        var link = M.waLink(state.town.whatsapp, message);
        var order = { id: id, town: state.town.id, created_at: now.toISOString(), total: r.total, channel: "whatsapp",
          customer: customer, items: r.lines.map(function (l) { return { product: l.id, qty: l.qty, unit_price: l.unit }; }) };
        var hh = String(now.getHours()), mm = ("0" + now.getMinutes()).slice(-2);
        keep(lastKey, { id: id, time: has("timeLabel") ? M.timeLabel(hh + ":" + mm) : hh + ":" + mm });
        var done = function () {
          // The cart is kept: a shopper who backs out of WhatsApp without
          // sending still has it. "Start a new order" empties it on purpose.
          orderBtn.disabled = false;
          orderBtn.textContent = "Order on WhatsApp";
          render();
        };
        if (desktop()) {
          // a new tab, opened inside the click so the browser allows it; the shop stays open here
          root.open(link, "_blank", "noopener");
          postOrder(root.fetch.bind(root), apiBase, order, 2000).then(done);
          return;
        }
        orderBtn.disabled = true; // one tap, one order
        orderBtn.textContent = "Opening WhatsApp…";
        postOrder(root.fetch.bind(root), apiBase, order, 2000).then(function () { done(); root.location.href = link; });
      });
    }

    if ($("mart-new-order")) {
      $("mart-new-order").addEventListener("click", function () {
        state.cart = { items: {} }; save(); keep(lastKey, null); render();
      });
    }

    index(build.products);
    render(); filter(); applyStock();
    loadData(root.fetch.bind(root), base, build).then(function (r) {
      var t = r.data.towns.filter(function (x) { return x.id === townId; })[0];
      // a live town record that could not take an order (no number, a bad
      // cutoff or timezone) is ignored; the town the page was built with stands
      if (t && (M.townOk(t) || !state.town.live)) { state.town = t; }
      index(r.data.products);
      if ($("mart-stale")) { $("mart-stale").hidden = !r.stale || !setting; }
      applyStock(); render();
    });
  }

  var api = { loadData: loadData, postOrder: postOrder };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.Mart = api;
  if (root.document.readyState === "loading") { root.document.addEventListener("DOMContentLoaded", start); } else { start(); }
})(this);

/* Conyso Mart: the logic with no page in it. Cart, prices, the delivery
   cutoff, order ids and the WhatsApp message. Pure functions, so the same
   file runs in the browser and under node --test. */
(function (root) {
  "use strict";
  var MAX_QTY = 20;
  var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

  function clampQty(n) {
    var v = Math.floor(Number(n));
    if (!isFinite(v) || v < 0) { return 0; }
    return Math.min(v, MAX_QTY);
  }

  function copyCart(cart) {
    var items = {};
    Object.keys((cart && cart.items) || {}).forEach(function (k) { items[k] = cart.items[k]; });
    return { items: items };
  }

  function cartSet(cart, id, qty) {
    var next = copyCart(cart), raw = String(qty).trim(), n = Number(raw);
    // a cleared box or a stray letter keeps the line; only an explicit 0 removes it
    if (raw === "" || !isFinite(n)) { return next; }
    var q = n < 0 ? 1 : clampQty(n);
    if (n > 0 && q === 0) { q = 1; }
    if (q === 0) { delete next.items[id]; } else { next.items[id] = q; }
    return next;
  }

  function cartAdd(cart, id) {
    return cartSet(cart, id, ((cart && cart.items && cart.items[id]) || 0) + 1);
  }

  function displayPrice(p, town) {
    var ours = town && town.show_our_price && p.our_price < p.mrp;
    return { price: ours ? p.our_price : p.mrp, mrp: p.mrp, struck: !!ours };
  }

  function cartLines(cart, byId, town) {
    var lines = [], dropped = [], total = 0;
    Object.keys((cart && cart.items) || {}).forEach(function (id) {
      var qty = clampQty(cart.items[id]), p = byId[id];
      if (!qty) { return; }
      if (!p || (town && p.towns && p.towns.indexOf(town.id) < 0)) {
        dropped.push({ id: id, name: p ? p.name : id, reason: "no longer listed" });
        return;
      }
      if (!p.in_stock) { dropped.push({ id: id, name: p.name, reason: "out of stock" }); return; }
      var unit = displayPrice(p, town).price;
      lines.push({ id: id, brand: p.brand, name: p.name, size: p.size, qty: qty, unit: unit, total: unit * qty });
      total += unit * qty;
    });
    return { lines: lines, dropped: dropped, total: total };
  }

  function parts(now, tz) {
    var out = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now).forEach(function (x) {
      out[x.type] = x.value;
    });
    return out;
  }

  function minutesIn(now, tz) {
    var p = parts(now, tz);
    return (Number(p.hour) % 24) * 60 + Number(p.minute);
  }

  function deliveryPromise(now, town) {
    var c = town.cutoff.split(":");
    return minutesIn(now, town.timezone) < Number(c[0]) * 60 + Number(c[1]) ? "today" : "tomorrow";
  }

  // minutes left to order for delivery today, or null once the cutoff has passed
  function cutoffLeft(now, town) {
    var c = town.cutoff.split(":"), left = Number(c[0]) * 60 + Number(c[1]) - minutesIn(now, town.timezone);
    return left > 0 ? left : null;
  }

  function countdownText(left) {
    if (left === null || left === undefined) { return ""; }
    var h = Math.floor(left / 60), m = left % 60;
    var t = h ? h + " h" + (m ? " " + m + " min" : "") : m + " min";
    return "Order in the next " + t + " for free delivery today";
  }

  // "18:00" -> "6 pm": how people here say a time
  function timeLabel(hhmm) {
    var p = String(hhmm).split(":"), h = Number(p[0]), m = p[1] || "00";
    var suffix = h >= 12 ? "pm" : "am", h12 = h % 12 || 12;
    return h12 + (m === "00" ? "" : ":" + m) + " " + suffix;
  }

  // "Wed 14 Oct" for today (+0) or tomorrow (+1) in the town's timezone
  function dayLabel(now, tz, plusDays) {
    var p = parts(now, tz);
    var d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + (plusDays || 0)));
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getUTCDay()] + " " + d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  function orderId(town, now, rand) {
    var p = parts(now, town.timezone), s = "";
    for (var i = 0; i < 4; i++) { s += ALPHABET.charAt(Math.floor(rand() * ALPHABET.length) % ALPHABET.length); }
    return town.code + "-" + p.month + p.day + "-" + s;
  }

  // A town the order can actually go to: live, a real number, a valid cutoff
  // and a timezone this browser knows. Live data that fails this is ignored.
  function townOk(t) {
    if (!t || t.live !== true || !/^\d{10,15}$/.test(String(t.whatsapp || ""))) { return false; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.cutoff || ""))) { return false; }
    try { new Intl.DateTimeFormat("en-GB", { timeZone: t.timezone }); } catch (e) { return false; }
    return true;
  }

  // Indian digit grouping: 1,370 and 1,00,000
  function rupees(n) {
    var s = String(Math.round(n)), last3 = s.slice(-3), rest = s.slice(0, -3);
    return "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3);
  }

  // Written as the customer's own message: they send it, we confirm it.
  function buildMessage(o) {
    var names = o.brandNames || {};
    var out = ["Hi Conyso Mart, I'd like to order. Please confirm.", "", "Order " + o.id + " (" + o.town.name + ")", ""];
    o.lines.forEach(function (l) {
      var who = names[l.brand] ? names[l.brand] + " " : "";
      out.push(l.qty + " x " + who + l.name + " (" + l.size + ") @ " + rupees(l.unit) + " = " + rupees(l.total));
    });
    out.push("", "Total: " + rupees(o.total) + (o.town.show_our_price ? " (incl. of all taxes)" : " (MRP, incl. of all taxes)"),
      "Delivery: free, " + o.promise + (o.when ? " (" + o.when + ")" : ""), "",
      "Name: " + o.customer.name, "Phone: " + o.customer.phone, "Address: " + o.customer.address);
    if (String(o.customer.landmark || "").trim()) { out.push("Landmark: " + o.customer.landmark); }
    out.push("", "I'll pay on delivery: cash or UPI");
    var oos = o.dropped.filter(function (d) { return d.reason === "out of stock"; }).map(function (d) { return d.name; });
    if (oos.length) { out.push("Not included (out of stock): " + oos.join(", ")); }
    return out.join("\n");
  }

  function waLink(number, message) {
    return "https://wa.me/" + number + "?text=" + encodeURIComponent(message);
  }

  var api = { clampQty: clampQty, cartSet: cartSet, cartAdd: cartAdd, displayPrice: displayPrice,
    cartLines: cartLines, minutesIn: minutesIn, deliveryPromise: deliveryPromise, orderId: orderId,
    cutoffLeft: cutoffLeft, countdownText: countdownText, timeLabel: timeLabel, dayLabel: dayLabel, rupees: rupees,
    buildMessage: buildMessage, waLink: waLink, townOk: townOk, MAX_QTY: MAX_QTY };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; } else { root.MartCore = api; }
})(this);

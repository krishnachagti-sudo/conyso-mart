/* Conyso Mart search: one index file written at build time, filtered in the
   browser. Every word typed must appear; case and accents are ignored. */
(function (root) {
  "use strict";
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }
  // what shoppers type -> what the pack says
  var SYNONYMS = { "sugar free": ["no added sugar", "no refined sugar", "zero added sugar"],
    "sugarfree": ["no added sugar", "no refined sugar"], soda: ["fizz", "sparkling"], fizzy: ["fizz", "sparkling"],
    "fox nut": ["makhana"], foxnut: ["makhana"], phool: ["makhana"], chai: ["tea"], coffee: ["latte", "coffee"],
    probiotic: ["probiotic"], dryfruit: ["dry fruit"], "dry fruits": ["dry fruit"], kids: ["children", "kids"] };

  // one letter wrong, missing, extra or swapped (for words of 5+ letters)
  function near(a, b) {
    if (Math.abs(a.length - b.length) > 1) { return false; }
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) { return false; }
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; continue; }
      if (a.length > b.length) { i++; } else if (b.length > a.length) { j++; } else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  function hit(term, hay, words) {
    if (hay.indexOf(term) >= 0) { return true; }
    var stem = term.length > 3 ? term.replace(/(es|s)$/, "") : term;
    if (stem !== term && hay.indexOf(stem) >= 0) { return true; }
    return term.length >= 5 && words.some(function (w) { return near(term, w); });
  }

  function filter(index, q, limit) {
    var query = norm(q).trim(), out = [];
    if (!query) { return out; }
    // a known phrase becomes alternatives, any one of which may match
    var groups = [], rest = query;
    Object.keys(SYNONYMS).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
      if ((" " + rest + " ").indexOf(" " + k + " ") >= 0) {
        groups.push([k].concat(SYNONYMS[k]));
        rest = (" " + rest + " ").replace(" " + k + " ", " ").trim();
      }
    });
    rest.split(/\s+/).filter(Boolean).forEach(function (t) { groups.push([t]); });
    for (var i = 0; i < index.length && out.length < (limit || 20) * 3; i++) {
      var hay = norm(index[i].n + " " + (index[i].c || "")), words = hay.split(/[^a-z0-9]+/);
      if (groups.every(function (g) { return g.some(function (t) { return hit(t, hay, words); }); })) { out.push(index[i]); }
    }
    // what we sell first, in index order within each group (sort is stable)
    return out.map(function (it, i) { return [it, i]; })
      .sort(function (a, b) { return ((b[0].s ? 1 : 0) - (a[0].s ? 1 : 0)) || (a[1] - b[1]); })
      .map(function (x) { return x[0]; }).slice(0, limit || 20);
  }
  function start() {
    var doc = root.document, box = doc.getElementById("mart-search"), list = doc.getElementById("mart-search-results");
    if (!box || !list) { return; }
    var index = null;
    var KIND = { brand: "Brand profile", product: "Product", category: "Type", guide: "Guide" };
    var SOLD = { brand: "Brand we deliver", product: "We deliver this" };
    var town = {};
    try { town = JSON.parse(doc.getElementById("mart-build-data").textContent).town || {}; } catch (e) {}
    // one status line speaks for the results (the list itself is not a live region)
    var status = doc.createElement("p");
    status.className = "mart-sr"; status.setAttribute("role", "status");
    list.parentNode.insertBefore(status, list);
    list.removeAttribute("aria-live");
    // on the shop page the grid narrows as you type, too
    var cards = Array.prototype.slice.call(doc.querySelectorAll("#mart-products .mart-card"));
    var none = null;
    if (cards.length) {
      none = doc.createElement("div");
      none.className = "mart-none"; none.hidden = true;
      cards[0].parentNode.parentNode.insertBefore(none, cards[0].parentNode.nextSibling);
    }
    var narrow = function () {
      if (!cards.length) { return 0; }
      var q = box.value.trim(), shown = 0, matched = 0;
      cards.forEach(function (el) {
        var ok = !q || filter([{ n: el.textContent }], q, 1).length > 0;
        el.classList.toggle("is-unmatched", !ok);
        if (ok) { matched++; }
        if (ok && !el.classList.contains("is-hidden")) { shown++; }
      });
      none.hidden = shown > 0;
      if (!shown) {
        none.innerHTML = "";
        var p = doc.createElement("p");
        // a match hidden by the brand or type filter is not "we don't sell it"
        p.textContent = matched ? "No match with these filters. Set Brand and Type to All to see it."
          : "We don't deliver \u201c" + q + "\u201d yet.";
        none.appendChild(p);
        if (!matched && town.live && town.whatsapp) {
          var a = doc.createElement("a");
          a.className = "mart-cta";
          a.href = "https://wa.me/" + town.whatsapp + "?text=" + encodeURIComponent("Hi Conyso Mart, can you stock " + q + "?");
          a.rel = "noopener";
          a.textContent = "Ask us to stock it";
          none.appendChild(a);
        }
      }
      return shown;
    };
    var show = function () {
      var found = index ? filter(index, box.value, 20) : [];
      list.innerHTML = "";
      found.forEach(function (it) {
        var li = doc.createElement("li"), a = doc.createElement("a"), s = doc.createElement("span");
        a.href = it.u; a.textContent = it.n; s.textContent = (it.s && SOLD[it.t]) || KIND[it.t] || it.t;
        if (it.s) { li.className = "is-sold"; }
        li.appendChild(a); li.appendChild(s); list.appendChild(li);
      });
      status.textContent = box.value.trim() ? found.length + (found.length === 1 ? " result" : " results") : "";
    };
    box.addEventListener("input", function () {
      narrow();
      if (index) { show(); return; }
      root.fetch("search-index.json").then(function (r) { return r.json(); })
        .then(function (x) { index = x; show(); }).catch(function () {});
    });
  }
  var api = { filter: filter };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.MartSearch = api;
  if (root.document.readyState === "loading") { root.document.addEventListener("DOMContentLoaded", start); } else { start(); }
})(this);

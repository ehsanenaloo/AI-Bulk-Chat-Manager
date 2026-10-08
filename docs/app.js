"use strict";
/*
 * Progressive enhancement only. Every page is complete without this file:
 * it adds the theme switch, site search, guide filtering, copy buttons and a
 * highlighted table of contents.
 */
(function () {
  var root = document.documentElement;
  var base = root.getAttribute("data-root") || "./";
  var THEME_KEY = "abcm-docs-theme";

  function safeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* storage may be blocked */ } }

  /* ---------- Theme ---------- */
  var themeButton = document.querySelector("[data-theme-toggle]");
  function effectiveTheme() {
    var set = root.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function paintThemeButton() {
    if (!themeButton) return;
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    themeButton.textContent = next === "dark" ? "Dark mode" : "Light mode";
    themeButton.setAttribute("aria-label", "Switch to " + next + " theme");
  }
  if (themeButton) {
    var saved = safeGet(THEME_KEY);
    if ((saved === "light" || saved === "dark") && !root.getAttribute("data-theme")) root.setAttribute("data-theme", saved);
    themeButton.hidden = false;
    paintThemeButton();
    themeButton.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      safeSet(THEME_KEY, next);
      paintThemeButton();
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", paintThemeButton);
    }
  }

  /* ---------- Sidebar: collapse on small screens ---------- */
  var sideDetails = document.querySelector(".sidebar details");
  if (sideDetails && window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
    sideDetails.removeAttribute("open");
  }

  /* ---------- Site search ---------- */
  var searchHost = document.querySelector("[data-search-host]");
  if (searchHost) {
    var script = document.createElement("script");
    script.src = base + "search-index.js";
    script.defer = true;
    document.head.appendChild(script);

    var box = document.createElement("div");
    box.className = "search-box";
    var input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search the guide";
    input.setAttribute("aria-label", "Search the guide");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-controls", "search-results");
    var results = document.createElement("div");
    results.className = "search-results";
    results.id = "search-results";
    results.hidden = true;
    box.appendChild(input);
    box.appendChild(results);
    searchHost.appendChild(box);

    var active = -1;
    var links = [];
    var escapeHtml = function (s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var score = function (entry, terms) {
      var total = 0;
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        var s = 0;
        if (entry.t.toLowerCase().indexOf(term) !== -1) s += 10;
        if (entry.h.join(" ").toLowerCase().indexOf(term) !== -1) s += 5;
        if (entry.d.toLowerCase().indexOf(term) !== -1) s += 3;
        if (entry.x.toLowerCase().indexOf(term) !== -1) s += 1;
        if (!s) return 0;
        total += s;
      }
      return total;
    };
    var render = function () {
      var query = input.value.trim().toLowerCase();
      links = [];
      active = -1;
      if (!query) { results.hidden = true; results.textContent = ""; return; }
      var data = window.ABCM_DOCS || [];
      var terms = query.split(/\s+/).map(function (w) { return w.length > 4 ? w.replace(/(ing|ed|es|s|e)$/, "") : w; });
      var found = data.map(function (entry) { return { entry: entry, s: score(entry, terms) }; })
        .filter(function (item) { return item.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8);
      results.hidden = false;
      if (!data.length) { results.innerHTML = '<p class="none">Search index is still loading. Try again in a moment.</p>'; return; }
      if (!found.length) { results.innerHTML = '<p class="none">No guide matches. Try a shorter word, such as "export" or "fast".</p>'; return; }
      results.innerHTML = found.map(function (item) {
        return '<a href="' + base + escapeHtml(item.entry.u) + '"><strong>' + escapeHtml(item.entry.t) + "</strong><span>" + escapeHtml(item.entry.d) + "</span></a>";
      }).join("");
      links = Array.prototype.slice.call(results.querySelectorAll("a"));
    };
    var move = function (delta) {
      if (!links.length) return;
      if (links[active]) links[active].classList.remove("is-active");
      active = (active + delta + links.length) % links.length;
      links[active].classList.add("is-active");
      links[active].scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Enter" && links[active]) { event.preventDefault(); window.location.href = links[active].href; }
      else if (event.key === "Escape") { results.hidden = true; input.blur(); }
    });
    document.addEventListener("click", function (event) { if (!box.contains(event.target)) results.hidden = true; });
    document.addEventListener("keydown", function (event) {
      var tag = (event.target && event.target.tagName) || "";
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        event.preventDefault();
        input.focus();
      }
    });
  }

  /* ---------- Guide filter ---------- */
  document.querySelectorAll("[data-filter]").forEach(function (field) {
    var group = document.getElementById(field.getAttribute("data-filter"));
    if (!group) return;
    var items = Array.prototype.slice.call(group.querySelectorAll("[data-filter-item]"));
    var status = document.getElementById(field.getAttribute("data-status"));
    var empty = document.getElementById(field.getAttribute("data-empty"));
    var run = function () {
      var query = field.value.trim().toLowerCase();
      var visible = 0;
      items.forEach(function (item) {
        var match = !query || item.textContent.toLowerCase().indexOf(query) !== -1;
        item.hidden = !match;
        if (match) visible += 1;
      });
      group.querySelectorAll("section").forEach(function (section) {
        section.hidden = !section.querySelector("[data-filter-item]:not([hidden])");
      });
      if (status) status.textContent = visible + " of " + items.length + " guides shown";
      if (empty) empty.hidden = visible !== 0;
    };
    field.closest(".filter").hidden = false;
    field.addEventListener("input", run);
    run();
  });

  /* ---------- Copy buttons ---------- */
  document.querySelectorAll("pre").forEach(function (block) {
    var tools = document.createElement("div");
    tools.className = "code-tools";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy the code example above");
    function select() {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(block);
      selection.removeAllRanges();
      selection.addRange(range);
      done("Selected. Press copy.");
    }
    function done(label) {
      button.textContent = label;
      window.setTimeout(function () { button.textContent = "Copy"; }, 2200);
    }
    button.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(block.textContent).then(function () { done("Copied"); }, select);
      } else { select(); }
    });
    tools.appendChild(button);
    block.parentNode.insertBefore(tools, block.nextSibling);
  });

  /* ---------- Table of contents highlight ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    tocLinks.forEach(function (link) { byId[link.getAttribute("href").slice(1)] = link; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && byId[entry.target.id]) {
          tocLinks.forEach(function (link) { link.classList.remove("is-current"); });
          byId[entry.target.id].classList.add("is-current");
        }
      });
    }, { rootMargin: "-80px 0px -70% 0px" });
    document.querySelectorAll(".prose h2[id]").forEach(function (heading) { observer.observe(heading); });
  }
})();

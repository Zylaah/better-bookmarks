// Better Bookmarks: Firefox's Bookmarks, History and Synced Tabs panels,
// drawn like the tab sidebar and placed beside the page.
// Steps aside when Zia is loaded, which already does this.
(() => {
  if (window.__bbBookmarksLoaded || window.__ziaLoaded) {
    return;
  }

  const root = document.documentElement;
  const XHTML = "http://www.w3.org/1999/xhtml";
  const STYLE_PREF = "better-bookmarks.style";
  const BESIDE_PREF = "better-bookmarks.beside";
  const SHEET = `chrome://sine/content/better-bookmarks/panels.css?${Date.now()}`;
  const MAX_PREF = "zen.view.sidebar-expanded.max-width";

  const isLittleZen = () =>
    root.getAttribute("zen-little-window") === "true" || !!window._zenStartupLittleWindow;

  if (isLittleZen()) {
    return;
  }
  window.__bbBookmarksLoaded = true;

  const noted = new Set();
  function noteError(where, err) {
    if (noted.has(where)) {
      return;
    }
    noted.add(where);
    console.debug(`[Better Bookmarks] ${where}:`, err);
  }

  function safely(where, fn) {
    try {
      return fn();
    } catch (err) {
      noteError(where, err);
      return undefined;
    }
  }

  function watchPrefs(names, fn) {
    const list = [names].flat();
    for (const name of list) {
      Services.prefs.addObserver(name, fn);
    }
    window.addEventListener(
      "unload",
      () => {
        for (const name of list) {
          try {
            Services.prefs.removeObserver(name, fn);
          } catch (err) {
            noteError("prefs", err);
          }
        }
      },
      { once: true }
    );
  }

  function prefOn(name) {
    try {
      return Services.prefs.getBoolPref(name, true);
    } catch (err) {
      return true;
    }
  }

  const styleOn = () => prefOn(STYLE_PREF);
  const wantBeside = () => styleOn() && prefOn(BESIDE_PREF);

  function setFlag(name, on) {
    if (on === root.hasAttribute(name)) {
      return;
    }
    if (on) {
      root.setAttribute(name, "true");
    } else {
      root.removeAttribute(name);
    }
  }

  function setStyle(el, name, value) {
    if (!el) {
      return;
    }
    if (value == null || value === "") {
      el.style.removeProperty(name);
    } else {
      el.style.setProperty(name, value);
    }
  }

  function within(value, low, high, usual) {
    return Number.isFinite(value) && value >= low && value <= high ? value : usual;
  }

  function usableColor(value) {
    if (!value) {
      return "";
    }
    const color = String(value).trim();
    if (!color || color === "transparent" || color === "none") {
      return "";
    }
    if (/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0(?:\.0+)?\s*\)$/.test(color)) {
      return "";
    }
    return color;
  }

  function paintedBackground(el) {
    if (!el) {
      return "";
    }
    for (const pseudo of [null, "::before", "::after"]) {
      const color = usableColor(getComputedStyle(el, pseudo).backgroundColor);
      if (color) {
        return color;
      }
    }
    return "";
  }

  // A light space, the same way Zen marks it. Absent mark: the theme picker,
  // then the system.
  function readLight() {
    const mark = root.getAttribute("zen-should-be-dark-mode");
    if (mark === "false") {
      return true;
    }
    if (mark !== null) {
      return false;
    }
    try {
      if (window.gZenThemePicker && typeof window.gZenThemePicker.isDarkMode === "boolean") {
        return !window.gZenThemePicker.isDarkMode;
      }
    } catch (err) {
      noteError("theme", err);
    }
    return matchMedia("(prefers-color-scheme: light)").matches;
  }

  function watchLightSpace() {
    const update = () => {
      const light = readLight();
      if (root.hasAttribute("bb-panels-light") === light) {
        return;
      }
      root.toggleAttribute("bb-panels-light", light);
      scheduleRefresh();
    };
    update();
    new MutationObserver(update).observe(root, {
      attributes: true,
      attributeFilter: ["zen-should-be-dark-mode"],
    });
    const media = matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);
    let watchingTheme = false;
    try {
      Services.obs.addObserver(update, "zen-theme-change");
      watchingTheme = true;
    } catch (err) {
      noteError("theme observer", err);
    }
    window.addEventListener(
      "unload",
      () => {
        media.removeEventListener("change", update);
        if (watchingTheme) {
          try {
            Services.obs.removeObserver(update, "zen-theme-change");
          } catch (err) {
            noteError("theme observer", err);
          }
        }
      },
      { once: true }
    );
  }

  function plainTabs() {
    if (!window.gBrowser?.visibleTabs) {
      return [];
    }
    return gBrowser.visibleTabs.filter(
      (tab) => !tab.hasAttribute("zen-essential") && !tab.hasAttribute("zen-glance-tab") && !tab.hidden
    );
  }

  function shownIcon(tab) {
    const image = tab.querySelector(".tab-icon-image");
    if (!image || tab.matches(":hover")) {
      return null;
    }
    return image.getBoundingClientRect().width > 0 ? image : null;
  }

  function labelColor(tab) {
    const label = tab?.querySelector(".tab-label-container") || tab?.querySelector(".tab-label");
    return label ? usableColor(getComputedStyle(label).color) : "";
  }

  function folderIndent(tab) {
    const inFolder = gBrowser.visibleTabs.find(
      (item) =>
        item.closest("zen-folder, tab-group:not([split-view-group])") && item.getBoundingClientRect().height > 0
    );
    const outer = tab.closest("zen-folder, tab-group")
      ? plainTabs().find((item) => !item.closest("zen-folder, tab-group") && item.getBoundingClientRect().height > 0)
      : tab;
    const innerBox = inFolder?.querySelector(".tab-background")?.getBoundingClientRect();
    const outerBox = outer?.querySelector(".tab-background")?.getBoundingClientRect();
    if (innerBox && outerBox) {
      const step = innerBox.left - outerBox.left;
      if (step > 0 && step < 40) {
        return step;
      }
    }
    return 14;
  }

  // Sizes copied off a real tab, so the panel's rows match the sidebar
  // the user actually has, including Zen layout changes.
  function tabMeasurements() {
    const tabs = plainTabs();
    const tab =
      tabs.find((item) => item.getBoundingClientRect().height > 0 && shownIcon(item)) ||
      tabs.find((item) => item.getBoundingClientRect().height > 0);
    if (!tab) {
      return null;
    }
    const background = tab.querySelector(".tab-background");
    const label = tab.querySelector(".tab-label");
    const content = tab.querySelector(".tab-content");
    const icon = shownIcon(tab);
    if (!background || !label || !content) {
      return null;
    }
    const backgroundBox = background.getBoundingClientRect();
    const height = backgroundBox.height;
    if (!(height > 0)) {
      return null;
    }
    const next = tabs[tabs.indexOf(tab) + 1]?.querySelector(".tab-background");
    const gap = next
      ? next.getBoundingClientRect().top - backgroundBox.bottom
      : 2 * parseFloat(getComputedStyle(tab).getPropertyValue("--tab-margin-block") || "2");
    const text = getComputedStyle(label);
    const toolbox = document.getElementById("navigator-toolbox")?.getBoundingClientRect();
    const tabsOnRight = root.getAttribute("zen-right-side") === "true";
    const inset = toolbox
      ? tabsOnRight
        ? toolbox.right - backgroundBox.right
        : backgroundBox.left - toolbox.left
      : 8;
    const light = root.hasAttribute("bb-panels-light");
    const rootStyle = getComputedStyle(root);
    const tabStyle = getComputedStyle(tab);
    const hover =
      usableColor(tabStyle.getPropertyValue("--tab-hover-background-color")) ||
      usableColor(rootStyle.getPropertyValue("--tab-hover-background-color")) ||
      usableColor(rootStyle.getPropertyValue("--toolbarbutton-hover-background")) ||
      (light ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.115)");
    const selectedTab = gBrowser.selectedTab?.hasAttribute("zen-essential") ? null : gBrowser.selectedTab;
    const selected =
      paintedBackground(selectedTab?.querySelector(".tab-background")) ||
      paintedBackground(selectedTab) ||
      (light ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.14)");
    const unselected = tabs.find((item) => !item.selected && !item.hasAttribute("visuallyselected"));
    return {
      "--bb-row-h": `${height}px`,
      "--bb-row-gap": `${Math.max(0, Math.min(12, gap))}px`,
      "--bb-row-radius": getComputedStyle(background).borderTopLeftRadius,
      "--bb-pill-corner": getComputedStyle(background).getPropertyValue("corner-top-left-shape").trim(),
      "--bb-row-font-size": text.fontSize,
      "--bb-row-font-weight": text.fontWeight,
      "--bb-row-font-family": text.fontFamily,
      "--bb-row-pad": `${within(icon ? icon.getBoundingClientRect().left - backgroundBox.left : NaN, 2, 24, 10)}px`,
      "--bb-row-text": labelColor(unselected) || (light ? "rgba(0, 0, 0, 0.8)" : "rgba(255, 255, 255, 0.8)"),
      "--bb-row-text-selected": labelColor(selectedTab) || (light ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)"),
      "--bb-row-inset": `${Math.max(0, Math.min(16, inset))}px`,
      "--bb-row-hover-bg": hover,
      "--bb-row-selected-bg": selected,
      "--bb-row-indent": `${folderIndent(tab)}px`,
      "--bb-row-icon-gap": `${within(icon ? label.getBoundingClientRect().left - icon.getBoundingClientRect().right : NaN, 2, 16, 8)}px`,
    };
  }

  function spaceNameEl() {
    return (
      document.querySelector(".zen-current-workspace-indicator-name") ||
      document.getElementById("zen-current-workspace-indicator")
    );
  }

  function firstEssential() {
    for (const el of document.querySelectorAll(
      ".zen-essentials-container .tabbrowser-tab[zen-essential] > .tab-stack > .tab-background, .tabbrowser-tab[zen-essential] > .tab-stack > .tab-background"
    )) {
      if (el.getBoundingClientRect().height > 0) {
        return el;
      }
    }
    return null;
  }

  // The outer gap around the page card, remembered once we have seen it.
  // Beside-mode CSS clears the margin on the panel's side, so a later
  // reading of 0 must not replace a gap we already measured.
  let lockedGap = 0;
  function measureCardFrame() {
    const card = document.getElementById("zen-appcontent-wrapper");
    if (!card) {
      return;
    }
    const rect = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    if (rect.height > 0) {
      if (rect.top >= 0 && rect.top < 80) {
        root.style.setProperty("--bb-card-top-gap", `${Math.round(rect.top)}px`);
      }
      const bottom = window.innerHeight - rect.bottom;
      if (bottom >= 0 && bottom < 80) {
        root.style.setProperty("--bb-card-bottom-gap", `${Math.round(bottom)}px`);
      }
    }
    const radius = parseFloat(style.borderTopLeftRadius);
    if (radius > 0) {
      root.style.setProperty("--bb-card-radius", style.borderTopLeftRadius);
    }
    const tabsOnRight = root.getAttribute("zen-right-side") === "true";
    const outer = parseFloat(style[tabsOnRight ? "marginLeft" : "marginRight"]) || 0;
    if (outer >= 4 && outer <= 32) {
      lockedGap = Math.round(outer);
    } else if (!lockedGap) {
      const bottomMargin = parseFloat(style.marginBottom) || 0;
      if (bottomMargin >= 4 && bottomMargin <= 32) {
        lockedGap = Math.round(bottomMargin);
      }
    }
    root.style.setProperty("--bb-card-gap", `${lockedGap || 6}px`);
  }

  // Padding that puts the panel's rows where the tabs sit: the same
  // distance from the window, and from the page.
  function sidebarSides() {
    const tab = plainTabs().find((item) => !item.closest("zen-folder, tab-group") && item.getBoundingClientRect().height > 0);
    const background = tab?.querySelector(".tab-background")?.getBoundingClientRect();
    const card = document.getElementById("zen-appcontent-wrapper")?.getBoundingClientRect();
    const splitter = document.getElementById("sidebar-splitter");
    const splitterWidth = splitter && !splitter.hidden ? splitter.getBoundingClientRect().width : 0;
    if (!background?.height || !card) {
      return;
    }
    const tabsOnRight = root.getAttribute("zen-right-side") === "true";
    const panel = document.getElementById("sidebar-box");
    const panelOnRight = !!panel?.hasAttribute("sidebar-positionend");
    if (panel && !panel.hidden && root.hasAttribute("bb-panels-beside") && panelOnRight === tabsOnRight) {
      const edge = panel.getBoundingClientRect();
      const gap = tabsOnRight ? background.left - edge.right : edge.left - background.right;
      if (gap >= 0 && gap < 40) {
        root.style.setProperty("--bb-panel-pad-window", `${gap}px`);
        root.style.setProperty("--bb-panel-pad-card", `${Math.max(0, gap - splitterWidth)}px`);
      }
      return;
    }
    const windowSide = tabsOnRight ? window.innerWidth - background.right : background.left;
    const cardSide = tabsOnRight ? background.left - card.right : card.left - background.right;
    if (windowSide >= 0 && windowSide < 40 && cardSide >= 0 && cardSide < 40) {
      const handle = splitterWidth || parseFloat(getComputedStyle(root).getPropertyValue("--bb-card-gap")) || 0;
      root.style.setProperty("--bb-panel-pad-window", `${windowSide}px`);
      root.style.setProperty("--bb-panel-pad-card", `${Math.max(0, cardSide - handle)}px`);
    }
  }

  function matchCloseToToolbar() {
    const icon = document.querySelector(
      "#downloads-button .toolbarbutton-icon, #downloads-button image, #nav-bar toolbarbutton .toolbarbutton-icon"
    );
    if (!icon || icon.getBoundingClientRect().width <= 0) {
      return;
    }
    const style = getComputedStyle(icon);
    let strength = (parseFloat(style.fillOpacity) || 1) * (parseFloat(style.opacity) || 1);
    const button = icon.closest("toolbarbutton");
    if (button) {
      strength *= parseFloat(getComputedStyle(button).opacity) || 1;
    }
    const fill = style.fill && style.fill !== "none" ? style.fill : "";
    if (usableColor(fill) || (fill && fill.startsWith("rgb"))) {
      root.style.setProperty("--bb-panel-close-fill", fill);
    }
    root.style.setProperty("--bb-panel-close-opacity", String(Math.round(strength * 1000) / 1000));
  }

  function levelTitle() {
    const label = spaceNameEl();
    const pill = document.getElementById("sidebar-switcher-target");
    const header = document.getElementById("sidebar-header");
    if (!label || !pill || !header) {
      return;
    }
    const labelBox = label.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    if (labelBox.height < 1 || pillBox.height < 1) {
      return;
    }
    const off = labelBox.top + labelBox.height / 2 - (pillBox.top + pillBox.height / 2);
    if (Math.abs(off) < 0.5) {
      return;
    }
    const padding = parseFloat(getComputedStyle(header).paddingTop) || 0;
    const next = padding + off;
    if (next >= 0 && next < 80) {
      root.style.setProperty("--bb-panel-title-top", `${next}px`);
    }
  }

  function spaceTitle(doc) {
    const label = spaceNameEl();
    const essential = firstEssential();
    const title = document.getElementById("sidebar-title");
    const header = document.getElementById("sidebar-header");
    const browser = document.getElementById("sidebar");
    const search = doc.querySelector("#search-box, .sidebar-search-container.selected .tabsFilter, #sidebar-search-container");
    if (!label || !essential || !title || !header || !browser || !search) {
      return;
    }
    const textBottom = (el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2 + parseFloat(getComputedStyle(el).fontSize) / 2;
    };
    const wanted = essential.getBoundingClientRect().top - textBottom(label);
    const now = browser.getBoundingClientRect().top + search.getBoundingClientRect().top - textBottom(title);
    if (!(wanted > 0 && wanted < 80) || Math.abs(wanted - now) < 0.5) {
      return;
    }
    const padding = parseFloat(getComputedStyle(header).paddingBottom) || 0;
    root.style.setProperty("--bb-panel-title-pad", `${Math.max(0, padding + wanted - now)}px`);
  }

  const SEARCH_FIELD_RULES = `
    #input {
      appearance: none !important;
      border: 1px solid transparent !important;
      outline: none !important;
      box-shadow: none !important;
    }
    #input:focus,
    #input:focus-visible {
      outline: none !important;
      border-color: var(--bb-field-line, rgba(255, 255, 255, 0.14)) !important;
    }
  `;

  function styleSearchField(doc) {
    const win = doc.defaultView;
    for (const field of doc.querySelectorAll("moz-input-search")) {
      if (field.bbStyleQueued) {
        continue;
      }
      field.bbStyleQueued = true;
      const apply = () => {
        const shadow = field.shadowRoot;
        if (!shadow || shadow.bbStyled) {
          return;
        }
        try {
          const sheet = new win.CSSStyleSheet();
          sheet.replaceSync(SEARCH_FIELD_RULES);
          shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
          shadow.bbStyled = true;
        } catch (err) {
          noteError("search field", err);
        }
      };
      apply();
      field.updateComplete?.then(apply, () => {});
      win.setTimeout(apply, 300);
    }
  }

  function clearPills(doc) {
    doc.getElementById("bb-row-pills")?.remove();
    const win = doc.defaultView;
    if (win?.__bbPillTimer) {
      win.clearInterval(win.__bbPillTimer);
      win.__bbPillTimer = 0;
    }
  }

  // Hover and selection are ordinary elements sat behind the tree, because
  // a tree row cannot have a radius or a gap of its own.
  function roundTreeRows(doc) {
    const tree = doc.querySelector(".sidebar-placesTree");
    const win = doc.defaultView;
    if (!tree || !win || typeof tree.getRowAt !== "function") {
      return;
    }

    const ensureLayer = () => {
      let layer = doc.getElementById("bb-row-pills");
      if (layer) {
        return layer;
      }
      layer = doc.createElementNS(XHTML, "div");
      layer.id = "bb-row-pills";
      const chosen = doc.createElementNS(XHTML, "div");
      chosen.className = "bb-row-pill";
      chosen.setAttribute("selected", "");
      const hover = doc.createElementNS(XHTML, "div");
      hover.className = "bb-row-pill";
      hover.setAttribute("hover", "");
      layer.append(chosen, hover);
      tree.before(layer);
      return layer;
    };

    const put = (pill, row) => {
      const body = tree.treeBody || tree.querySelector("treechildren");
      const height = tree.rowHeight;
      if (!pill || row < 0 || !body || !height) {
        if (pill) {
          pill.hidden = true;
        }
        return;
      }
      const shown = row - tree.getFirstVisibleRow();
      const box = body.getBoundingClientRect();
      const gap = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--bb-row-gap")) || 0;
      const top = box.top + shown * height;
      if (shown < 0 || top + height > box.bottom + 1) {
        pill.hidden = true;
        return;
      }
      const indent =
        (tree.view?.getLevel(row) || 0) *
        (parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--bb-row-indent")) || 0);
      pill.hidden = false;
      pill.style.top = `${top + gap / 2}px`;
      pill.style.height = `${Math.max(0, height - gap)}px`;
      pill.style.left = `${box.left + indent}px`;
      pill.style.width = `${Math.max(0, box.width - indent)}px`;
    };

    let queued = false;
    const update = () => {
      if (queued) {
        return;
      }
      queued = true;
      win.requestAnimationFrame(() => {
        queued = false;
        try {
          const layer = ensureLayer();
          const hoveredRow = tree.__bbHoveredRow ?? -1;
          const current = tree.view?.selection?.count ? tree.currentIndex : -1;
          put(layer.querySelector("[selected]"), current);
          put(layer.querySelector("[hover]"), hoveredRow === current ? -1 : hoveredRow);
        } catch (err) {
          noteError("rows", err);
        }
      });
    };

    const startTimer = () => {
      if (win.__bbPillTimer) {
        return;
      }
      win.__bbPillTimer = win.setInterval(() => {
        if (document.getElementById("sidebar-box")?.hidden) {
          return;
        }
        update();
      }, 250);
      win.addEventListener(
        "unload",
        () => {
          win.clearInterval(win.__bbPillTimer);
          win.__bbPillTimer = 0;
        },
        { once: true }
      );
    };

    ensureLayer();
    tree.__bbUpdate = update;
    startTimer();
    if (tree.__bbBound) {
      update();
      return;
    }
    tree.__bbBound = true;
    tree.__bbHoveredRow = -1;
    tree.addEventListener("mousemove", (event) => {
      let row = -1;
      try {
        row = tree.getRowAt(event.clientX, event.clientY);
      } catch (err) {
        row = -1;
      }
      if (row !== tree.__bbHoveredRow) {
        tree.__bbHoveredRow = row;
        update();
      }
    });
    tree.addEventListener("mouseleave", () => {
      tree.__bbHoveredRow = -1;
      update();
    });
    for (const type of ["select", "wheel", "keydown", "click", "focus", "blur"]) {
      tree.addEventListener(type, update, true);
    }
    win.addEventListener("resize", update);
    update();
  }

  function isBuiltinPanel(doc) {
    const uri = doc.documentURI || "";
    if (
      uri.startsWith("chrome://browser/") &&
      /bookmarksSidebar|historySidebar|history-panel|syncedtabs|syncedTabs/i.test(uri)
    ) {
      return true;
    }
    return !!doc.querySelector(".sidebar-placesTree, #viewButton, .item.client, .sync-state");
  }

  function matchTabs(doc) {
    safely("panel sides", sidebarSides);
    safely("close button", matchCloseToToolbar);
    const sizes = tabMeasurements();
    if (sizes) {
      for (const [name, value] of Object.entries(sizes)) {
        if (value) {
          doc.documentElement.style.setProperty(name, value);
        }
      }
      root.style.setProperty("--bb-space-pill-height", sizes["--bb-row-h"]);
      root.style.setProperty("--bb-space-pill-radius", sizes["--bb-row-radius"]);
      root.style.setProperty("--bb-text-size", sizes["--bb-row-font-size"]);
      if (sizes["--bb-pill-corner"]) {
        root.style.setProperty("--bb-space-pill-corner", sizes["--bb-pill-corner"]);
      }
    }
    const label = spaceNameEl();
    if (label) {
      const pill = getComputedStyle(label);
      const radius = parseFloat(pill.borderTopLeftRadius);
      if (radius >= 4) {
        const value = pill.borderTopLeftRadius;
        doc.documentElement.style.setProperty("--bb-pill-radius", value);
        root.style.setProperty("--bb-space-pill-radius", value);
      }
      const corner = pill.getPropertyValue("corner-top-left-shape").trim();
      if (corner) {
        doc.documentElement.style.setProperty("--bb-pill-corner", corner);
        root.style.setProperty("--bb-space-pill-corner", corner);
      }
    }
    setStyle(doc.documentElement, "--bb-panel-inset", root.hasAttribute("bb-panels-beside") ? "0px" : null);
    doc.documentElement.toggleAttribute("bb-panels-light", root.hasAttribute("bb-panels-light"));
    roundTreeRows(doc);
    styleSearchField(doc);
    doc.defaultView?.requestAnimationFrame(() => {
      doc.defaultView?.requestAnimationFrame(() => {
        levelTitle();
        spaceTitle(doc);
      });
    });
  }

  function styleSidebar() {
    const browser = document.getElementById("sidebar");
    const win = browser?.contentWindow;
    const doc = browser?.contentDocument || win?.document;
    if (!doc?.documentElement || doc.documentURI === "about:blank") {
      return;
    }
    const on = styleOn() && isBuiltinPanel(doc);
    try {
      doc.documentElement.toggleAttribute("bb-panels-light", root.hasAttribute("bb-panels-light"));
      if (!on) {
        if (doc.__bbSheet && win) {
          win.windowUtils.removeSheetUsingURIString(SHEET, win.windowUtils.AUTHOR_SHEET);
          doc.__bbSheet = false;
        }
        clearPills(doc);
        return;
      }
      if (!doc.__bbSheet && win) {
        win.windowUtils.loadSheetUsingURIString(SHEET, win.windowUtils.AUTHOR_SHEET);
        doc.__bbSheet = true;
      }
      matchTabs(doc);
    } catch (err) {
      noteError("style panel", err);
    }
  }

  let refreshQueued = false;
  function scheduleRefresh() {
    if (refreshQueued) {
      return;
    }
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      safely("refresh", () => {
        measureCardFrame();
        sidebarSides();
        styleSidebar();
      });
    });
  }

  function motionOk() {
    return wantBeside() && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Zen keeps the panel inside the page card. Beside-mode makes it a
  // sibling of the card, on the side Firefox was told to use.
  function setupPlacement() {
    const box = document.getElementById("sidebar-box");
    const splitter = document.getElementById("sidebar-splitter");
    const card = document.getElementById("zen-appcontent-wrapper");
    if (!box || !splitter || !card || !box.parentNode) {
      return;
    }
    const parent = box.parentNode;
    const boxFirst = (splitter.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const later = boxFirst ? splitter : box;
    const after = later.nextSibling;
    const resizeBefore = splitter.getAttribute("resizebefore");
    const resizeAfter = splitter.getAttribute("resizeafter");

    const restore = () => {
      const ref = after && after.parentNode === parent ? after : null;
      if (boxFirst) {
        parent.insertBefore(box, ref);
        parent.insertBefore(splitter, ref);
      } else {
        parent.insertBefore(splitter, ref);
        parent.insertBefore(box, ref);
      }
      if (resizeBefore == null) {
        splitter.removeAttribute("resizebefore");
      } else {
        splitter.setAttribute("resizebefore", resizeBefore);
      }
      if (resizeAfter == null) {
        splitter.removeAttribute("resizeafter");
      } else {
        splitter.setAttribute("resizeafter", resizeAfter);
      }
    };

    const reloadPanel = () => {
      try {
        const id = window.SidebarController?.currentID;
        if (id && !box.hidden) {
          window.SidebarController.show(id);
        }
      } catch (err) {
        noteError("reload panel", err);
      }
    };

    const place = () => {
      measureCardFrame();
      const beside = wantBeside();
      setFlag("bb-panels-beside", beside);
      const end = box.hasAttribute("sidebar-positionend");
      let moved = false;
      if (beside) {
        if (end && (card.nextElementSibling !== splitter || splitter.nextElementSibling !== box)) {
          card.after(splitter, box);
          moved = true;
        } else if (!end && (card.previousElementSibling !== splitter || splitter.previousElementSibling !== box)) {
          card.before(box, splitter);
          moved = true;
        }
        splitter.setAttribute("resizebefore", end ? "none" : "sibling");
        splitter.setAttribute("resizeafter", end ? "sibling" : "none");
      } else if (box.parentNode !== parent) {
        restore();
        moved = true;
      }
      if (moved) {
        box.style.removeProperty("margin-left");
        box.style.removeProperty("margin-right");
        reloadPanel();
      }
    };

    const maxWidth = () => {
      const toolbox = window.gNavToolbox || document.getElementById("navigator-toolbox");
      const fromToolbox = toolbox ? parseFloat(toolbox.style.maxWidth || getComputedStyle(toolbox).maxWidth) : NaN;
      if (fromToolbox > 0) {
        return fromToolbox;
      }
      try {
        return Services.prefs.getIntPref(MAX_PREF);
      } catch (err) {
        return 300;
      }
    };

    let clamping = false;
    const cap = () => {
      if (clamping) {
        return;
      }
      if (!wantBeside()) {
        box.style.removeProperty("max-width");
        return;
      }
      const max = maxWidth();
      if (!(max > 0)) {
        return;
      }
      const capped = `${max}px`;
      if (box.style.getPropertyValue("max-width") !== capped) {
        box.style.setProperty("max-width", capped, "important");
      }
      if (box.getBoundingClientRect().width > max + 0.5) {
        clamping = true;
        box.style.width = `${max}px`;
        box.setAttribute("width", String(Math.round(max)));
        requestAnimationFrame(() => {
          clamping = false;
        });
      }
    };

    place();
    cap();
    watchPrefs([MAX_PREF, BESIDE_PREF, STYLE_PREF], () => {
      place();
      cap();
    });
    new MutationObserver(place).observe(box, { attributes: true, attributeFilter: ["sidebar-positionend"] });
    new MutationObserver(cap).observe(box, { attributes: true, attributeFilter: ["width", "style"] });
    const toolbox = window.gNavToolbox || document.getElementById("navigator-toolbox");
    if (toolbox) {
      new MutationObserver(cap).observe(toolbox, { attributes: true, attributeFilter: ["style"] });
    }

    // Open: slide in from the window edge, or from under the page when the
    // panel shares a side with the tabs. Close: slide out, then hide.
    const slideBox = (opening) => {
      const onRight = box.hasAttribute("sidebar-positionend");
      const besideTabs = onRight === (root.getAttribute("zen-right-side") === "true");
      const side = onRight !== besideTabs ? "marginRight" : "marginLeft";
      const hidden = `-${box.getBoundingClientRect().width}px`;
      const from = opening ? hidden : "0px";
      const to = opening ? "0px" : hidden;
      const property = side === "marginRight" ? "margin-right" : "margin-left";
      const cleanup = () => box.style.removeProperty(property);
      const motion = window.gZenUIManager?.motion;
      if (motion?.animate) {
        try {
          box.style[side] = from;
          const result = motion.animate(
            box,
            { [side]: [from, to] },
            { ease: opening ? "easeOut" : "easeIn", type: "spring", bounce: 0, duration: 0.1 }
          );
          return Promise.resolve(result?.finished || result).then(() => {
            if (opening) {
              cleanup();
            }
            return cleanup;
          });
        } catch (err) {
          noteError("slide", err);
        }
      }
      const run = box.animate([{ [side]: from }, { [side]: to }], {
        duration: 100,
        easing: opening ? "ease-out" : "ease-in",
        fill: "forwards",
      });
      return run.finished.catch(() => {}).then(() => () => run.cancel());
    };

    const slide = (opening) =>
      slideBox(opening).finally(() => {
        if (opening) {
          safely("panel sides", sidebarSides);
        }
      });

    let wasHidden = box.hidden;
    new MutationObserver(() => {
      const hidden = box.hidden;
      if (wasHidden && !hidden && motionOk()) {
        slide(true).catch((err) => noteError("slide in", err));
      }
      wasHidden = hidden;
    }).observe(box, { attributes: true, attributeFilter: ["hidden"] });

    const controller = window.SidebarController;
    if (controller && typeof controller.hide === "function" && !controller.bbSlides && !controller.ziaSlides) {
      const hide = controller.hide;
      let slidingOut = false;
      controller.hide = function (...args) {
        if (slidingOut || box.hidden || !motionOk()) {
          return hide.apply(this, args);
        }
        slidingOut = true;
        const giveUp = new Promise((resolve) => setTimeout(() => resolve(() => {}), 500));
        const closing = Promise.resolve()
          .then(() => slide(false))
          .catch((err) => {
            noteError("slide out", err);
            return () => {};
          });
        Promise.race([closing, giveUp]).then((undo) => {
          slidingOut = false;
          try {
            hide.apply(this, args);
          } finally {
            if (typeof undo === "function") {
              undo();
            }
          }
        });
        return undefined;
      };
      controller.bbSlides = true;
    }
  }

  function watchSidebarPanels() {
    document.getElementById("sidebar")?.addEventListener("load", styleSidebar, true);
    safely("placement", setupPlacement);
    setFlag("bb-panels-plain", !styleOn());
    styleSidebar();
    watchPrefs([STYLE_PREF, BESIDE_PREF], () => {
      setFlag("bb-panels-plain", !styleOn());
      styleSidebar();
    });
  }

  function start() {
    if (window.__ziaLoaded || isLittleZen()) {
      return;
    }
    measureCardFrame();
    watchLightSpace();
    watchSidebarPanels();
    window.addEventListener("resize", scheduleRefresh);
    new MutationObserver(scheduleRefresh).observe(root, {
      attributes: true,
      attributeFilter: ["zen-compact-mode", "zen-right-side"],
    });
    for (const type of ["ZenWorkspacesUIUpdate", "ZenWorkspaceDataChanged", "AfterWorkspacesSessionRestore"]) {
      window.addEventListener(type, scheduleRefresh);
    }
    safely("tab select", () => gBrowser.tabContainer.addEventListener("TabSelect", scheduleRefresh));
    scheduleRefresh();
  }

  function whenReady(fn) {
    const ready = () =>
      document.getElementById("sidebar-box") &&
      document.getElementById("sidebar-splitter") &&
      document.getElementById("zen-appcontent-wrapper") &&
      document.getElementById("sidebar");
    if (ready()) {
      fn();
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (!ready() && tries < 200) {
        return;
      }
      window.clearInterval(timer);
      if (ready()) {
        fn();
      }
    }, 50);
    window.addEventListener("unload", () => window.clearInterval(timer), { once: true });
  }

  whenReady(start);
})();

(() => {
  const HOP = (window.HOP = window.HOP || {});

  class OverlayUI {
    constructor() {
      this.root = null;
      this.svg = null;
      this.toolbar = null;
      this.status = null;
      this.statusText = null;
      this.statusActionButton = null;
      this.statusDismissTimeoutId = 0;
      this.statusHideTimeoutId = 0;
      this.navigator = null;
      this.navigatorToggleButton = null;
      this.navigatorList = null;
      this.navigatorEmpty = null;
      this.navigatorCollapsed = false;
      this.navigatorDragState = null;
      this.navigatorDragRafId = 0;
      this.suppressNavigatorToggleClick = false;
      this.navigatorStateChangeHandler = null;
      this.toolbarActionHandler = null;
      this.navigatorActionHandler = null;
      this.navigatorToggleHandler = null;
      this.navigatorDragStartHandler = null;
      this.navigatorDragMoveHandler = null;
      this.navigatorDragEndHandler = null;
    }

    mount(onToolbarAction, onNavigatorAction, onNavigatorStateChange) {
      const existing = document.getElementById("hop-overlay-root");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

      this.navigatorStateChangeHandler =
        typeof onNavigatorStateChange === "function" ? onNavigatorStateChange : null;

      this.root = document.createElement("div");
      this.root.id = "hop-overlay-root";

      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.id = "hop-overlay-svg";
      this.svg.classList.add("hop-overlay-svg");

      this.toolbar = document.createElement("div");
      this.toolbar.id = "hop-toolbar";
      this.toolbar.className = "hop-toolbar";

      const buttons = [
        { action: HOP.constants.TOOLBAR_ACTION.SELECT, label: "Select" },
        { action: HOP.constants.TOOLBAR_ACTION.PAN, label: "Pan Mode" },
        { action: HOP.constants.TOOLBAR_ACTION.LASSO, label: "Lasso" },
        { action: HOP.constants.TOOLBAR_ACTION.CONNECTION, label: "Connection" },
        { action: HOP.constants.TOOLBAR_ACTION.LINE, label: "Line" },
        { action: HOP.constants.TOOLBAR_ACTION.RECTANGLE, label: "Rectangle" },
        { action: HOP.constants.TOOLBAR_ACTION.CIRCLE, label: "Circle" },
        { action: HOP.constants.TOOLBAR_ACTION.POLYGON, label: "Polygon" },
        { action: HOP.constants.TOOLBAR_ACTION.LABEL, label: "Label" },
        { action: HOP.constants.TOOLBAR_ACTION.DELETE_SELECTED, label: "Delete Selected" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_UNITS, label: "Units: Metric" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTHS, label: "Lengths: On" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK, label: "Show/Unshow Length" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_AREAS, label: "Areas: On" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_AREA_PICK, label: "Show/Unshow Area" },
        { action: HOP.constants.TOOLBAR_ACTION.COPY, label: "Copy" },
        { action: HOP.constants.TOOLBAR_ACTION.PASTE, label: "Paste" },
        { action: HOP.constants.TOOLBAR_ACTION.UNDO, label: "Undo" },
        { action: HOP.constants.TOOLBAR_ACTION.REDO, label: "Redo" },
        { action: HOP.constants.TOOLBAR_ACTION.SAVE, label: "Save" },
        { action: HOP.constants.TOOLBAR_ACTION.EXIT, label: "Exit" }
      ];

      buttons.forEach((buttonDef) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hop-toolbar-btn";
        button.setAttribute("data-action", buttonDef.action);
        button.textContent = buttonDef.label;
        this.toolbar.appendChild(button);
      });

      this.status = document.createElement("div");
      this.status.id = "hop-status";
      this.status.className = "hop-status";
      this.status.setAttribute("aria-hidden", "true");

      this.statusText = document.createElement("span");
      this.statusText.id = "hop-status-text";

      this.statusActionButton = document.createElement("button");
      this.statusActionButton.id = "hop-status-action";
      this.statusActionButton.className = "hop-status-action";
      this.statusActionButton.type = "button";
      this.statusActionButton.hidden = true;

      this.status.appendChild(this.statusText);
      this.status.appendChild(this.statusActionButton);

      this.navigator = document.createElement("aside");
      this.navigator.id = "hop-navigator";
      this.navigator.className = "hop-navigator";

      this.navigatorToggleButton = document.createElement("button");
      this.navigatorToggleButton.type = "button";
      this.navigatorToggleButton.className = "hop-navigator-toggle";

      this.navigatorList = document.createElement("div");
      this.navigatorList.className = "hop-navigator-list";

      this.navigatorEmpty = document.createElement("div");
      this.navigatorEmpty.className = "hop-navigator-empty";
      this.navigatorEmpty.textContent = "No shapes yet.";
      this.navigatorList.appendChild(this.navigatorEmpty);

      this.navigator.appendChild(this.navigatorToggleButton);
      this.navigator.appendChild(this.navigatorList);

      this.root.appendChild(this.svg);
      this.root.appendChild(this.toolbar);
      this.root.appendChild(this.status);
      this.root.appendChild(this.navigator);

      document.body.appendChild(this.root);

      this.toolbarActionHandler = (event) => {
        const button = event.target.closest("[data-action]");
        if (!button || !onToolbarAction) {
          return;
        }
        onToolbarAction(button.getAttribute("data-action"));
      };

      this.toolbar.addEventListener("click", this.toolbarActionHandler);

      this.navigatorActionHandler = (event) => {
        const button = event.target.closest("[data-nav-action]");
        if (!button || !onNavigatorAction) {
          return;
        }
        onNavigatorAction({
          action: button.getAttribute("data-nav-action"),
          shapeId: button.getAttribute("data-shape-id")
        });
      };
      this.navigatorList.addEventListener("click", this.navigatorActionHandler);

      this.navigatorToggleHandler = (event) => {
        if (this.suppressNavigatorToggleClick) {
          this.suppressNavigatorToggleClick = false;
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        this.setNavigatorCollapsed(!this.navigatorCollapsed);
      };
      this.navigatorToggleButton.addEventListener("click", this.navigatorToggleHandler);

      this.navigatorDragMoveHandler = this._onNavigatorDragMove.bind(this);
      this.navigatorDragEndHandler = this._onNavigatorDragEnd.bind(this);
      this.navigatorDragStartHandler = this._onNavigatorDragStart.bind(this);
      this.navigatorToggleButton.addEventListener(
        "pointerdown",
        this.navigatorDragStartHandler
      );

      this.setNavigatorCollapsed(true);
      this.setNavigatorItems([], null);
    }

    getSvg() {
      return this.svg;
    }

    setActiveTool(tool) {
      if (!this.toolbar) {
        return;
      }

      const toolActions = new Set([
        HOP.constants.TOOLBAR_ACTION.SELECT,
        HOP.constants.TOOLBAR_ACTION.LASSO,
        HOP.constants.TOOLBAR_ACTION.PAN,
        HOP.constants.TOOLBAR_ACTION.CONNECTION,
        HOP.constants.TOOLBAR_ACTION.LINE,
        HOP.constants.TOOLBAR_ACTION.RECTANGLE,
        HOP.constants.TOOLBAR_ACTION.CIRCLE,
        HOP.constants.TOOLBAR_ACTION.POLYGON,
        HOP.constants.TOOLBAR_ACTION.LABEL
      ]);

      const buttons = this.toolbar.querySelectorAll("[data-action]");
      buttons.forEach((button) => {
        const action = button.getAttribute("data-action");
        if (toolActions.has(action)) {
          button.classList.toggle("is-active", action === tool);
        }
      });
    }

    setButtonState(action, active, label) {
      if (!this.toolbar) {
        return;
      }

      const button = this.toolbar.querySelector(`[data-action="${action}"]`);
      if (!button) {
        return;
      }

      button.classList.toggle("is-active", !!active);
      if (typeof label === "string" && label) {
        button.textContent = label;
      }
    }

    setInteractionMode(tool) {
      if (!this.root || !this.svg) {
        return;
      }

      this.root.classList.remove(
        "hop-tool-pan",
        "hop-tool-select",
        "hop-tool-lasso",
        "hop-tool-connection",
        "hop-tool-line",
        "hop-tool-rectangle",
        "hop-tool-circle",
        "hop-tool-polygon",
        "hop-tool-label"
      );

      this.root.classList.add(`hop-tool-${tool}`);

      if (tool === HOP.constants.TOOL.PAN) {
        this.root.classList.remove("hop-capture");
      } else {
        this.root.classList.add("hop-capture");
      }
    }

    showStatus(message, options) {
      if (!this.status) {
        return;
      }

      const opts = options || {};
      if (this.statusDismissTimeoutId) {
        window.clearTimeout(this.statusDismissTimeoutId);
        this.statusDismissTimeoutId = 0;
      }
      if (this.statusHideTimeoutId) {
        window.clearTimeout(this.statusHideTimeoutId);
        this.statusHideTimeoutId = 0;
      }

      this.statusText.textContent = message;

      this.statusActionButton.hidden = !opts.actionLabel;
      this.statusActionButton.textContent = opts.actionLabel || "";
      this.statusActionButton.onclick = null;

      if (opts.actionLabel && typeof opts.action === "function") {
        this.statusActionButton.onclick = opts.action;
      }
      this.status.setAttribute("aria-hidden", "false");
      this.status.classList.add("is-visible");

      const durationMsRaw = Number(opts.durationMs);
      const durationMs =
        Number.isFinite(durationMsRaw) && durationMsRaw >= 0 ? durationMsRaw : 4000;
      if (durationMs > 0) {
        this.statusDismissTimeoutId = window.setTimeout(() => {
          this.statusDismissTimeoutId = 0;
          this.clearStatus();
        }, durationMs);
      }
    }

    clearStatus() {
      if (!this.status) {
        return;
      }
      if (this.statusDismissTimeoutId) {
        window.clearTimeout(this.statusDismissTimeoutId);
        this.statusDismissTimeoutId = 0;
      }
      if (this.statusHideTimeoutId) {
        window.clearTimeout(this.statusHideTimeoutId);
        this.statusHideTimeoutId = 0;
      }

      this.status.classList.remove("is-visible");
      this.statusHideTimeoutId = window.setTimeout(() => {
        this.statusHideTimeoutId = 0;
        if (!this.status || this.status.classList.contains("is-visible")) {
          return;
        }
        this.status.setAttribute("aria-hidden", "true");
        this.statusText.textContent = "";
        this.statusActionButton.hidden = true;
        this.statusActionButton.onclick = null;
      }, 240);
    }

    setNavigatorCollapsed(collapsed) {
      this.navigatorCollapsed = !!collapsed;
      if (!this.navigator || !this.navigatorToggleButton || !this.navigatorList) {
        return;
      }

      this.navigator.classList.toggle("is-collapsed", this.navigatorCollapsed);
      this.navigatorList.hidden = this.navigatorCollapsed;
      this.navigatorList.style.display = this.navigatorCollapsed ? "none" : "flex";
      const chevron = this.navigatorCollapsed ? "\u25B8" : "\u25BE";
      const title = this.navigatorToggleButton.getAttribute("data-title") || "Shapes (0)";
      this.navigatorToggleButton.textContent = `${chevron} ${title}`;
      this.navigatorToggleButton.setAttribute(
        "aria-expanded",
        this.navigatorCollapsed ? "false" : "true"
      );
      this.navigatorToggleButton.setAttribute(
        "aria-label",
        this.navigatorCollapsed ? "Expand shape navigator" : "Collapse shape navigator"
      );
      this._emitNavigatorStateChange();
    }

    _onNavigatorDragStart(event) {
      if (!this.navigator || !this.navigatorToggleButton) {
        return;
      }

      if (typeof event.button === "number" && event.button !== 0) {
        return;
      }

      const rect = this.navigator.getBoundingClientRect();
      this.navigatorDragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        latestX: event.clientX,
        latestY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
        lastLeft: rect.left,
        lastTop: rect.top
      };

      this.navigator.classList.add("is-dragging");
      this.navigator.style.willChange = "transform";
      this.suppressNavigatorToggleClick = false;

      try {
        this.navigatorToggleButton.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Fallback listeners still handle drag if pointer capture is unavailable.
      }

      this.navigatorToggleButton.addEventListener("pointermove", this.navigatorDragMoveHandler);
      this.navigatorToggleButton.addEventListener("pointerup", this.navigatorDragEndHandler);
      this.navigatorToggleButton.addEventListener("pointercancel", this.navigatorDragEndHandler);

      window.addEventListener("pointermove", this.navigatorDragMoveHandler);
      window.addEventListener("pointerup", this.navigatorDragEndHandler);
      window.addEventListener("pointercancel", this.navigatorDragEndHandler);
    }

    _onNavigatorDragMove(event) {
      if (!this.navigator || !this.navigatorDragState) {
        return;
      }

      if (event.pointerId !== this.navigatorDragState.pointerId) {
        return;
      }

      this.navigatorDragState.latestX = event.clientX;
      this.navigatorDragState.latestY = event.clientY;

      const dx = this.navigatorDragState.latestX - this.navigatorDragState.startX;
      const dy = this.navigatorDragState.latestY - this.navigatorDragState.startY;
      if (!this.navigatorDragState.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        this.navigatorDragState.moved = true;
      }

      if (!this.navigatorDragState.moved) {
        return;
      }

      if (!this.navigatorDragRafId) {
        this.navigatorDragRafId = window.requestAnimationFrame(() => {
          this.navigatorDragRafId = 0;
          this._flushNavigatorDragPosition();
        });
      }

      event.preventDefault();
    }

    _flushNavigatorDragPosition() {
      if (!this.navigator || !this.navigatorDragState || !this.navigatorDragState.moved) {
        return;
      }

      const padding = 8;
      const headerHeight = this.navigatorToggleButton
        ? Math.max(32, this.navigatorToggleButton.getBoundingClientRect().height)
        : 44;
      const maxLeft = Math.max(
        padding,
        (window.innerWidth || 0) - this.navigatorDragState.width - padding
      );
      const maxTop = Math.max(
        padding,
        (window.innerHeight || 0) - headerHeight - padding
      );

      const dx = this.navigatorDragState.latestX - this.navigatorDragState.startX;
      const dy = this.navigatorDragState.latestY - this.navigatorDragState.startY;
      const nextLeft = Math.min(
        maxLeft,
        Math.max(padding, this.navigatorDragState.startLeft + dx)
      );
      const nextTop = Math.min(
        maxTop,
        Math.max(padding, this.navigatorDragState.startTop + dy)
      );

      this.navigatorDragState.lastLeft = nextLeft;
      this.navigatorDragState.lastTop = nextTop;

      const tx = nextLeft - this.navigatorDragState.startLeft;
      const ty = nextTop - this.navigatorDragState.startTop;
      this.navigator.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
    }

    _onNavigatorDragEnd(event) {
      if (!this.navigatorDragState) {
        return;
      }

      if (
        event &&
        typeof event.pointerId === "number" &&
        event.pointerId !== this.navigatorDragState.pointerId
      ) {
        return;
      }

      if (this.navigatorDragRafId) {
        window.cancelAnimationFrame(this.navigatorDragRafId);
        this.navigatorDragRafId = 0;
      }
      this._flushNavigatorDragPosition();

      const dragState = this.navigatorDragState;
      const moved = !!this.navigatorDragState.moved;
      this.navigatorDragState = null;

      if (this.navigator) {
        this.navigator.classList.remove("is-dragging");
        this.navigator.style.willChange = "";
        this.navigator.style.transform = "";

        if (moved) {
          this.navigator.style.left = `${Math.round(dragState.lastLeft)}px`;
          this.navigator.style.top = `${Math.round(dragState.lastTop)}px`;
          this.navigator.style.right = "auto";
          this.navigator.style.bottom = "auto";
        }
      }

      if (this.navigatorToggleButton) {
        this.navigatorToggleButton.removeEventListener("pointermove", this.navigatorDragMoveHandler);
        this.navigatorToggleButton.removeEventListener("pointerup", this.navigatorDragEndHandler);
        this.navigatorToggleButton.removeEventListener("pointercancel", this.navigatorDragEndHandler);
        try {
          if (typeof dragState.pointerId === "number") {
            this.navigatorToggleButton.releasePointerCapture(dragState.pointerId);
          }
        } catch (_error) {
          // Ignore release errors if capture was not active.
        }
      }

      window.removeEventListener("pointermove", this.navigatorDragMoveHandler);
      window.removeEventListener("pointerup", this.navigatorDragEndHandler);
      window.removeEventListener("pointercancel", this.navigatorDragEndHandler);

      if (moved) {
        this.suppressNavigatorToggleClick = true;
        if (event) {
          event.preventDefault();
        }
      }

      this._emitNavigatorStateChange();
    }

    getNavigatorState() {
      if (!this.navigator) {
        return null;
      }

      const left = Number(this.navigator.style.left.replace("px", ""));
      const top = Number(this.navigator.style.top.replace("px", ""));

      return {
        collapsed: !!this.navigatorCollapsed,
        left: Number.isFinite(left) ? left : null,
        top: Number.isFinite(top) ? top : null
      };
    }

    applyNavigatorState(state) {
      if (!this.navigator || !state || typeof state !== "object") {
        return;
      }

      if (typeof state.collapsed === "boolean") {
        this.setNavigatorCollapsed(state.collapsed);
      }

      const left = Number(state.left);
      const top = Number(state.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        const safeLeft = Math.max(
          8,
          Math.min((window.innerWidth || 0) - 8, left)
        );
        const safeTop = Math.max(
          8,
          Math.min((window.innerHeight || 0) - 8, top)
        );
        this.navigator.style.left = `${Math.round(safeLeft)}px`;
        this.navigator.style.top = `${Math.round(safeTop)}px`;
        this.navigator.style.right = "auto";
        this.navigator.style.bottom = "auto";
      }
    }

    _emitNavigatorStateChange() {
      if (!this.navigatorStateChangeHandler) {
        return;
      }

      const state = this.getNavigatorState();
      if (!state) {
        return;
      }

      try {
        this.navigatorStateChangeHandler(state);
      } catch (_error) {
        // Ignore callback errors to avoid breaking UI interaction.
      }
    }

    setNavigatorItems(items, selectedId) {
      if (!this.navigatorToggleButton || !this.navigatorList || !this.navigatorEmpty) {
        return;
      }

      const safeItems = Array.isArray(items) ? items : [];
      const title = `Shapes (${safeItems.length})`;
      this.navigatorToggleButton.setAttribute("data-title", title);

      const chevron = this.navigatorCollapsed ? "\u25B8" : "\u25BE";
      this.navigatorToggleButton.textContent = `${chevron} ${title}`;

      this.navigatorList.innerHTML = "";
      if (!safeItems.length) {
        this.navigatorEmpty = document.createElement("div");
        this.navigatorEmpty.className = "hop-navigator-empty";
        this.navigatorEmpty.textContent = "No shapes yet.";
        this.navigatorList.appendChild(this.navigatorEmpty);
        return;
      }

      safeItems.forEach((item) => {
        const row = document.createElement("div");
        row.className = "hop-navigator-item";
        if (item.id && item.id === selectedId) {
          row.classList.add("is-selected");
        }

        const summary = document.createElement("div");
        summary.className = "hop-navigator-summary";

        const type = document.createElement("span");
        type.className = "hop-navigator-type";
        type.textContent = typeof item.typeLabel === "string" ? item.typeLabel : "Shape";

        const name = document.createElement("span");
        name.className = "hop-navigator-name";
        name.textContent = typeof item.name === "string" ? item.name : "Untitled";

        summary.appendChild(type);
        summary.appendChild(name);

        const findButton = document.createElement("button");
        findButton.type = "button";
        findButton.className = "hop-navigator-find";
        findButton.setAttribute("data-nav-action", "find");
        findButton.setAttribute("data-shape-id", item.id || "");
        findButton.textContent = "Find";

        row.appendChild(summary);
        row.appendChild(findButton);
        this.navigatorList.appendChild(row);
      });
    }

    destroy() {
      if (this.toolbar && this.toolbarActionHandler) {
        this.toolbar.removeEventListener("click", this.toolbarActionHandler);
      }
      if (this.navigatorList && this.navigatorActionHandler) {
        this.navigatorList.removeEventListener("click", this.navigatorActionHandler);
      }
      if (this.navigatorToggleButton && this.navigatorToggleHandler) {
        this.navigatorToggleButton.removeEventListener("click", this.navigatorToggleHandler);
      }
      if (this.navigatorToggleButton && this.navigatorDragStartHandler) {
        this.navigatorToggleButton.removeEventListener(
          "pointerdown",
          this.navigatorDragStartHandler
        );
      }

      if (this.navigatorDragState) {
        if (this.navigatorDragRafId) {
          window.cancelAnimationFrame(this.navigatorDragRafId);
          this.navigatorDragRafId = 0;
        }
        if (this.navigatorToggleButton) {
          this.navigatorToggleButton.removeEventListener("pointermove", this.navigatorDragMoveHandler);
          this.navigatorToggleButton.removeEventListener("pointerup", this.navigatorDragEndHandler);
          this.navigatorToggleButton.removeEventListener("pointercancel", this.navigatorDragEndHandler);
        }
        window.removeEventListener("pointermove", this.navigatorDragMoveHandler);
        window.removeEventListener("pointerup", this.navigatorDragEndHandler);
        window.removeEventListener("pointercancel", this.navigatorDragEndHandler);
      }

      this.toolbarActionHandler = null;
      this.navigatorActionHandler = null;
      this.navigatorToggleHandler = null;
      this.navigatorDragStartHandler = null;
      this.navigatorDragMoveHandler = null;
      this.navigatorDragEndHandler = null;
      this.navigatorStateChangeHandler = null;
      if (this.statusDismissTimeoutId) {
        window.clearTimeout(this.statusDismissTimeoutId);
        this.statusDismissTimeoutId = 0;
      }
      if (this.statusHideTimeoutId) {
        window.clearTimeout(this.statusHideTimeoutId);
        this.statusHideTimeoutId = 0;
      }

      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }

      this.root = null;
      this.svg = null;
      this.toolbar = null;
      this.status = null;
      this.statusText = null;
      this.statusActionButton = null;
      this.navigator = null;
      this.navigatorToggleButton = null;
      this.navigatorList = null;
      this.navigatorEmpty = null;
    }
  }

  HOP.OverlayUI = OverlayUI;
})();

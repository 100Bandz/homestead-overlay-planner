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
      this.toolbarActionHandler = null;
    }

    mount(onToolbarAction) {
      const existing = document.getElementById("hop-overlay-root");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }

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
        { action: HOP.constants.TOOLBAR_ACTION.CONNECTION, label: "Connection" },
        { action: HOP.constants.TOOLBAR_ACTION.LINE, label: "Line" },
        { action: HOP.constants.TOOLBAR_ACTION.RECTANGLE, label: "Rectangle" },
        { action: HOP.constants.TOOLBAR_ACTION.POLYGON, label: "Polygon" },
        { action: HOP.constants.TOOLBAR_ACTION.LABEL, label: "Label" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTHS, label: "Lengths: On" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_AREAS, label: "Areas: On" },
        { action: HOP.constants.TOOLBAR_ACTION.TOGGLE_LENGTH_PICK, label: "Show/Unshow Length" },
        { action: HOP.constants.TOOLBAR_ACTION.UNDO, label: "Undo" },
        { action: HOP.constants.TOOLBAR_ACTION.REDO, label: "Redo" },
        { action: HOP.constants.TOOLBAR_ACTION.DELETE_SELECTED, label: "Delete Selected" },
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
      this.status.hidden = true;

      this.statusText = document.createElement("span");
      this.statusText.id = "hop-status-text";

      this.statusActionButton = document.createElement("button");
      this.statusActionButton.id = "hop-status-action";
      this.statusActionButton.className = "hop-status-action";
      this.statusActionButton.type = "button";
      this.statusActionButton.hidden = true;

      this.status.appendChild(this.statusText);
      this.status.appendChild(this.statusActionButton);

      this.root.appendChild(this.svg);
      this.root.appendChild(this.toolbar);
      this.root.appendChild(this.status);

      document.body.appendChild(this.root);

      this.toolbarActionHandler = (event) => {
        const button = event.target.closest("[data-action]");
        if (!button || !onToolbarAction) {
          return;
        }
        onToolbarAction(button.getAttribute("data-action"));
      };

      this.toolbar.addEventListener("click", this.toolbarActionHandler);
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
        HOP.constants.TOOLBAR_ACTION.PAN,
        HOP.constants.TOOLBAR_ACTION.CONNECTION,
        HOP.constants.TOOLBAR_ACTION.LINE,
        HOP.constants.TOOLBAR_ACTION.RECTANGLE,
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
        "hop-tool-connection",
        "hop-tool-line",
        "hop-tool-rectangle",
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
      this.status.hidden = false;
      this.statusText.textContent = message;

      this.statusActionButton.hidden = !opts.actionLabel;
      this.statusActionButton.textContent = opts.actionLabel || "";
      this.statusActionButton.onclick = null;

      if (opts.actionLabel && typeof opts.action === "function") {
        this.statusActionButton.onclick = opts.action;
      }
    }

    clearStatus() {
      if (!this.status) {
        return;
      }
      this.status.hidden = true;
      this.statusText.textContent = "";
      this.statusActionButton.hidden = true;
      this.statusActionButton.onclick = null;
    }

    destroy() {
      if (this.toolbar && this.toolbarActionHandler) {
        this.toolbar.removeEventListener("click", this.toolbarActionHandler);
      }

      this.toolbarActionHandler = null;

      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }

      this.root = null;
      this.svg = null;
      this.toolbar = null;
      this.status = null;
      this.statusText = null;
      this.statusActionButton = null;
    }
  }

  HOP.OverlayUI = OverlayUI;
})();

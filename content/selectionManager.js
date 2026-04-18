(() => {
  const HOP = (window.HOP = window.HOP || {});

  class SelectionManager {
    constructor() {
      this.selectedId = null;
    }

    select(shapeId) {
      this.selectedId = shapeId || null;
      return this.selectedId;
    }

    clear() {
      this.selectedId = null;
    }

    getSelectedId() {
      return this.selectedId;
    }
  }

  HOP.SelectionManager = SelectionManager;
})();

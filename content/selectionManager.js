(() => {
  const HOP = (window.HOP = window.HOP || {});

  class SelectionManager {
    constructor() {
      this.selectedIds = new Set();
      this.primarySelectedId = null;
    }

    _syncPrimary() {
      if (this.primarySelectedId && this.selectedIds.has(this.primarySelectedId)) {
        return;
      }

      const first = this.selectedIds.values().next();
      this.primarySelectedId = first && !first.done ? first.value : null;
    }

    select(shapeId, options) {
      const id = typeof shapeId === "string" && shapeId ? shapeId : null;
      const opts = options && typeof options === "object" ? options : {};

      if (!id) {
        this.clear();
        return null;
      }

      if (opts.toggle) {
        if (this.selectedIds.has(id)) {
          this.selectedIds.delete(id);
          this._syncPrimary();
          return this.primarySelectedId;
        }
        this.selectedIds.add(id);
        this.primarySelectedId = id;
        return this.primarySelectedId;
      }

      if (opts.add) {
        this.selectedIds.add(id);
        this.primarySelectedId = id;
        return this.primarySelectedId;
      }

      this.selectedIds = new Set([id]);
      this.primarySelectedId = id;
      return this.primarySelectedId;
    }

    selectMany(shapeIds, options) {
      const ids = Array.isArray(shapeIds)
        ? shapeIds.filter((id) => typeof id === "string" && id)
        : [];
      if (!ids.length) {
        this.clear();
        return [];
      }

      const opts = options && typeof options === "object" ? options : {};
      if (opts.append) {
        ids.forEach((id) => this.selectedIds.add(id));
      } else {
        this.selectedIds = new Set(ids);
      }

      const preferredPrimary =
        typeof opts.primaryId === "string" && opts.primaryId ? opts.primaryId : null;

      if (preferredPrimary && this.selectedIds.has(preferredPrimary)) {
        this.primarySelectedId = preferredPrimary;
      } else {
        this.primarySelectedId = ids[ids.length - 1];
        this._syncPrimary();
      }

      return this.getSelectedIds();
    }

    add(shapeId) {
      return this.select(shapeId, { add: true });
    }

    remove(shapeId) {
      const id = typeof shapeId === "string" && shapeId ? shapeId : null;
      if (!id) {
        return false;
      }

      const removed = this.selectedIds.delete(id);
      if (removed) {
        this._syncPrimary();
      }
      return removed;
    }

    clear() {
      this.selectedIds.clear();
      this.primarySelectedId = null;
    }

    has(shapeId) {
      return this.selectedIds.has(shapeId);
    }

    getSelectedId() {
      this._syncPrimary();
      return this.primarySelectedId;
    }

    getSelectedIds() {
      return Array.from(this.selectedIds);
    }
  }

  HOP.SelectionManager = SelectionManager;
})();

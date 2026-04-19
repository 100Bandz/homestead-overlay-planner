(() => {
  const HOP = (window.HOP = window.HOP || {});

  HOP.constants = Object.freeze({
    STORAGE_KEY: "homesteadOverlayPlannerPlans",
    CANONICAL_ZOOM: 24,
    TILE_SIZE: 256,
    MAX_MERCATOR_LAT: 85.05112878,
    TOOL: Object.freeze({
      SELECT: "select",
      PAN: "pan",
      CONNECTION: "connection",
      LINE: "line",
      RECTANGLE: "rectangle",
      POLYGON: "polygon",
      LABEL: "label"
    }),
    TOOLBAR_ACTION: Object.freeze({
      SELECT: "select",
      PAN: "pan",
      CONNECTION: "connection",
      LINE: "line",
      RECTANGLE: "rectangle",
      POLYGON: "polygon",
      LABEL: "label",
      TOGGLE_LENGTHS: "toggleLengths",
      TOGGLE_AREAS: "toggleAreas",
      TOGGLE_LENGTH_PICK: "toggleLengthPick",
      TOGGLE_AREA_PICK: "toggleAreaPick",
      COPY: "copy",
      PASTE: "paste",
      UNDO: "undo",
      REDO: "redo",
      DELETE_SELECTED: "deleteSelected",
      SAVE: "save",
      EXIT: "exit"
    }),
    MESSAGE_TYPE: Object.freeze({
      PING: "HOP_PING",
      START: "HOP_START_PLANNING",
      LOAD: "HOP_LOAD_PLAN",
      EXIT: "HOP_EXIT_PLANNING",
      STATUS: "HOP_GET_STATUS"
    })
  });
})();

(() => {
  const HOP = (window.HOP = window.HOP || {});

  function createId(prefix) {
    return [
      prefix || "id",
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 10)
    ].join("_");
  }

  HOP.ids = {
    createId
  };
})();

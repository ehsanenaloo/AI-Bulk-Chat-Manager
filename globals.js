/* Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. */
if (typeof window.globalsLoaded === "undefined") {
  console.log("globals.js loaded");

  window.globalsLoaded = true;

  const GlobalState = {
    shiftPressed: false,
    lastCheckedCheckbox: null,
    stopRequested: false,

    setShiftPressed(pressed) {
      this.shiftPressed = pressed;
      window.shiftPressed = pressed;
    },

    setLastCheckedCheckbox(checkbox) {
      this.lastCheckedCheckbox = checkbox;
      window.lastCheckedCheckbox = checkbox;
    },

    requestStop() {
      this.stopRequested = true;
      window.stopRequested = true;
    },

    clearStopRequest() {
      this.stopRequested = false;
      window.stopRequested = false;
    },

    isShiftPressed() {
      return this.shiftPressed;
    },

    getLastCheckedCheckbox() {
      return this.lastCheckedCheckbox;
    },

    isStopRequested() {
      return this.stopRequested;
    }
  };

  window.GlobalState = GlobalState;
  window.shiftPressed = false;
  window.lastCheckedCheckbox = null;
  window.stopRequested = false;

} else {
  console.log("globals.js already loaded, skipping re-initialization");
}

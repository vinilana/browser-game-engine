// Keyboard / mouse / pointer-lock input with per-frame edge detection.
export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.buttons = new Set();
    this.pressedButtons = new Set();
    this.releasedButtons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseMoveX = 0;       // movement regardless of pointer lock
    this.mouseMoveY = 0;
    this.mouseX = 0;           // client coordinates
    this.mouseY = 0;
    this.mouseInside = false;
    this.wheel = 0;
    this.freeCursor = false;   // strategy games: wheel/mouse work without pointer lock
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 0.0022;
    this._lastKeyTime = new Map();
    this.doubleTaps = new Set();

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) {
        this.pressedKeys.add(e.code);
        const now = performance.now();
        const last = this._lastKeyTime.get(e.code) || 0;
        if (now - last < 280) this.doubleTaps.add(e.code);
        this._lastKeyTime.set(e.code, now);
      }
      this.keys.add(e.code);
      if (this.locked && ['Space', 'Tab', 'F3', 'F1', 'KeyF', 'Slash'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this.buttons.add(e.button);
      this.pressedButtons.add(e.button);
    };
    this._onMouseUp = (e) => {
      this.buttons.delete(e.button);
      this.releasedButtons.add(e.button);
    };
    this._onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseInside = true;
      this.mouseMoveX += e.movementX || 0;
      this.mouseMoveY += e.movementY || 0;
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    this._onWheel = (e) => {
      if (!this.locked && !(this.freeCursor && e.target === this.element)) return;
      this.wheel += Math.sign(e.deltaY);
    };
    this._onLeave = () => { this.mouseInside = false; };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) { this.keys.clear(); this.buttons.clear(); }
      this.onLockChange?.(this.locked);
    };
    this._onBlur = () => { this.keys.clear(); this.buttons.clear(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    element.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mouseleave', this._onLeave);
    document.addEventListener('pointerlockchange', this._onLockChange);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    const p = this.element.requestPointerLock?.({ unadjustedMovement: false });
    if (p && p.catch) p.catch(() => this.element.requestPointerLock?.());
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressedKeys.has(code); }
  wasReleased(code) { return this.releasedKeys.has(code); }
  wasDoubleTapped(code) { return this.doubleTaps.has(code); }
  isButtonDown(b) { return this.buttons.has(b); }
  wasButtonPressed(b) { return this.pressedButtons.has(b); }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressedButtons.clear();
    this.releasedButtons.clear();
    this.doubleTaps.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseMoveX = 0;
    this.mouseMoveY = 0;
    this.wheel = 0;
  }
}

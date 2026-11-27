// A mouse single click waits briefly so the first click of a double click cannot stage a card.
// Touch taps remain immediate; a repeated touch tap never becomes a flick or undoes the first tap.
export class CardClicks {
  private pending?: { id: number; tap: () => void; timer: ReturnType<typeof setTimeout> };
  private touch?: { id: number; time: number };

  click(id: number, pointer: string, time: number, tap: () => void, flick: () => void): void {
    if (pointer !== "mouse") {
      if (this.touch?.id === id && time - this.touch.time <= 450) { this.touch = undefined; return; }
      this.touch = { id, time };
      tap();
      return;
    }
    const pending = this.pending;
    this.cancel();
    if (pending?.id === id) { flick(); return; }
    pending?.tap();
    this.pending = { id, tap, timer: setTimeout(() => { this.pending = undefined; tap(); }, 450) };
  }

  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }
}

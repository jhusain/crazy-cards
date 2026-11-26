import type { TableView } from "@crazy-eights/protocol";

interface OpponentTurn {
  before: TableView;
  frames: TableView[];
}

export class OpponentReplay {
  private current?: OpponentTurn;
  last?: OpponentTurn;

  network = false;

  reset(): void { this.current = this.last = undefined; }

  record(before: TableView | undefined, after: TableView): void {
    if (!before || before.revision === after.revision) return;
    if (!after.event || after.event.kind === "shuffle" || before.round !== after.round) {
      this.current = this.last = undefined;
      return;
    }
    const humanMove = after.event.seat === after.seat;
    if (this.network) {
      if (humanMove) { this.current = undefined; return; }
      this.current ??= { before, frames: [] };
      this.current.frames.push(after);
      this.last = this.current;
      return;
    }
    const forced = before.turn === after.seat && before.legalLeads.length === 0 && after.event.kind !== "play";
    if (humanMove && !forced) {
      this.current = undefined;
      return;
    }

    if (humanMove && (!this.current || after.event.kind === "draw" && after.legalLeads.length > 0)) {
      // A draw that opens a choice is not a forced draw-and-pass turn.
      if (this.current) this.last = this.current;
      this.current = undefined;
      return;
    }
    this.current ??= { before, frames: [] };
    this.current.frames.push(after);
    if (after.result || after.turn === null || (after.turn === after.seat && after.legalLeads.length > 0)) {
      if (this.current.frames.some(frame => frame.event?.seat !== after.seat || frame.event.kind === "pass")) {
        this.last = this.current;
      }
      this.current = undefined;
    }
  }
}

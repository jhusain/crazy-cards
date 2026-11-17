import type { TableView } from "@crazy-eights/protocol";

interface OpponentTurn {
  before: TableView;
  frames: TableView[];
}

export class OpponentReplay {
  private current?: OpponentTurn;
  last?: OpponentTurn;
  voluntaryDraw?: { before: TableView; after: TableView };

  record(before: TableView | undefined, after: TableView): void {
    if (!before || before.revision === after.revision) return;
    if (!after.event || before.round !== after.round) {
      this.current = this.last = undefined;
      this.voluntaryDraw = undefined;
      return;
    }
    const humanMove = after.event.seat === after.seat;
    const forced = before.turn === after.seat && before.legalLeads.length === 0 && after.event.kind !== "play";
    if (humanMove && !forced) {
      this.current = undefined;
      this.voluntaryDraw = after.event.kind === "draw" ? { before, after } : undefined;
      return;
    }

    this.voluntaryDraw = undefined;
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

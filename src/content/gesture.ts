const TAP_MS = 500;
export class CtrlTap {
  private pressedAt: number | null = null;
  private held = new Set<string>();

  down(event: Pick<KeyboardEvent, 'code' | 'repeat' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing'>, time: number) {
    this.pressedAt = !event.repeat && event.code === 'ControlLeft' && !this.held.size &&
      !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing ? time : null;
    this.held.add(event.code);
  }
  up(code: string, time: number) {
    const tap = code === 'ControlLeft' && this.pressedAt !== null && time - this.pressedAt <= TAP_MS;
    this.cancel();
    this.held.delete(code);
    return tap;
  }
  cancel() { this.pressedAt = null; }
  reset() { this.cancel(); this.held.clear(); }
}

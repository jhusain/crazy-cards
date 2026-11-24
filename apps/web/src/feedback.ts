// Phone feedback is explicitly opt-in, then unlocked by a trusted tap.
export class CountdownFeedback {
  private context?: AudioContext;
  sound = false;
  vibration = false;
  private readonly key = "crazy-eights-feedback";

  private readonly reportVibration: (message: string) => void;

  constructor(reportVibration: (message: string) => void = () => {}) {
    this.reportVibration = reportVibration;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? "null");
      this.sound = saved?.sound === true;
      this.vibration = saved?.vibration === true;
    } catch { /* Defaults remain silent. */ }
  }
  save(): void {
    try { localStorage.setItem(this.key,JSON.stringify({sound:this.sound,vibration:this.vibration})); } catch { /* Session preferences still work. */ }
  }
  async unlock(): Promise<void> {
    if (!this.sound) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") await this.context.resume();
    } catch { /* A browser may not support or allow audio. */ }
  }
  tick(): void {
    if (document.hidden) return;
    if (this.sound && this.context?.state === "running") {
      const context = this.context;
      const now = context.currentTime;
      // A short, filtered noise impulse resembles a mechanical clock escapement.
      const duration = .024;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const click = context.createBufferSource();
      click.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2600;
      filter.Q.value = .9;
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.25, now + .001);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      click.connect(filter).connect(gain).connect(context.destination);
      click.onended = () => { click.disconnect(); filter.disconnect(); gain.disconnect(); };
      click.start(now);
    } else if (this.vibration && !this.sound) this.vibrate();
  }
  private vibrate(): void {
    let message: string;
    try {
      if (typeof navigator.vibrate !== "function") message = "Vibration API unavailable";
      else if (!navigator.vibrate(25)) message = `Vibration rejected (user activation: ${navigator.userActivation?.hasBeenActive ?? "unknown"})`;
      else message = "Vibration request accepted (25 ms)";
    } catch (error) {
      message = `Vibration error: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.reportVibration(message);
  }
  bling(): void {
    if (!this.sound || document.hidden || this.context?.state !== "running") return;
    const now = this.context.currentTime;
    // Bright bell partials ring briefly, with the higher overtones fading first.
    const partials = [
      { frequency: 1568, level: .10, decay: .16 },
      { frequency: 3136, level: .055, decay: .095 },
      { frequency: 4704, level: .025, decay: .05 },
    ];
    for (const { frequency, level, decay } of partials) {
      const tone = this.context.createOscillator();
      const gain = this.context.createGain();
      tone.type = "sine";
      tone.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + .002);
      gain.gain.exponentialRampToValueAtTime(.0001, now + decay);
      tone.connect(gain).connect(this.context.destination);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(now);
      tone.stop(now + decay);
    }
  }
  setup(): void {
    const sound=document.getElementById("sound-enabled") as HTMLInputElement;
    const vibration=document.getElementById("vibration-enabled") as HTMLInputElement;
    const dialog=document.getElementById("feedback-dialog") as HTMLDialogElement;
    const sync=()=>{sound.checked=this.sound;vibration.checked=this.vibration;this.save();};
    const enable=()=>{this.sound=true;this.vibration=true;sync();void this.unlock().then(()=>this.tick());dialog.close();};
    sound.checked=this.sound;vibration.checked=this.vibration;
    sound.onchange=()=>{this.sound=sound.checked;this.save();void this.unlock();};
    vibration.onchange=()=>{this.vibration=vibration.checked;this.save();if(this.vibration&&!this.sound)this.tick();};
    document.getElementById("allow-feedback")!.onclick=enable;
    document.getElementById("decline-feedback")!.onclick=()=>{sync();dialog.close();};
    document.getElementById("enable-feedback")!.onclick=()=>dialog.showModal();
    document.addEventListener("pointerup",()=>void this.unlock(),{passive:true});
    document.addEventListener("keydown",()=>void this.unlock());
    let saved=false;try{saved=localStorage.getItem(this.key)!==null;}catch{}
    if(!saved) dialog.showModal();
  }
}

// Emit at most once per elapsed second, never a burst after a stalled frame.
export function countdownBeat(elapsed: number): number { return Math.floor(Math.max(0,elapsed)/1000); }

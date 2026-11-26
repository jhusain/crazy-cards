import { impactVibration, slamIntensity } from "./play-impact.ts";

// Sound is opt-in and unlocked by a trusted tap; gameplay vibration is automatic.
export class CountdownFeedback {
  private context?: AudioContext;
  private fireSource?: AudioBufferSourceNode;
  private impactVibrating = false;
  private powerSources = new Set<AudioScheduledSourceNode>();
  sound = false;
  private readonly key = "crazy-eights-feedback";

  private readonly reportVibration: (message: string) => void;

  constructor(reportVibration: (message: string) => void = () => {}) {
    this.reportVibration = reportVibration;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? "null");
      this.sound = saved?.sound === true;
    } catch { /* Defaults remain silent. */ }
  }
  save(): void {
    try { localStorage.setItem(this.key,JSON.stringify({sound:this.sound})); } catch { /* Session preferences still work. */ }
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
    } else if (!this.sound) this.vibrate();
  }
  private vibrate(): void {
    this.requestVibration(25, "Countdown vibration");
  }
  private requestVibration(pattern: number | number[], label: string): { accepted: boolean; message: string } {
    let accepted = false;
    let message: string;
    try {
      if (document.hidden) message = "Vibration unavailable while the page is hidden.";
      else if (typeof navigator.vibrate !== "function") message = "This browser does not expose vibration support.";
      else {
        accepted = navigator.vibrate(pattern);
        message = accepted
          ? `${label}: browser accepted the request; physical vibration is not confirmed.`
          : `${label}: browser rejected the request (page interaction: ${navigator.userActivation?.hasBeenActive ?? "unknown"}).`;
      }
    } catch (error) {
      message = `Vibration error: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.reportVibration(message);
    return { accepted, message };
  }
  testVibration(): string {
    this.stopImpactVibration();
    // Run directly in the button's click handler, with a clearly perceptible test duration.
    const result = this.requestVibration(600, "600 ms vibration test");
    return result.accepted ? `${result.message} You should feel one sustained buzz. If you do not, check the phone’s vibration intensity, silent mode, and Do Not Disturb settings.` : result.message;
  }
  suitTick(sound: "tick" | "click"): void {
    if (!this.sound || document.hidden || this.context?.state !== "running") return;
    const context = this.context, now = context.currentTime;
    const duration = sound === "click" ? .018 : .012;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = sound === "click" ? 1800 : 3200;
    filter.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(sound === "click" ? .18 : .12, now + .001);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now);
  }
  stopImpactVibration(): void {
    if (!this.impactVibrating) return;
    this.impactVibrating = false;
    try { navigator.vibrate?.(0); } catch { /* Unsupported or denied by the browser. */ }
  }
  stopPowerSounds(): void {
    for (const source of this.powerSources) {
      try { source.stop(); } catch { /* A source may have finished in this frame. */ }
    }
    this.powerSources.clear();
  }
  powerPulse(score: number, intensity: number): void {
    if (score < 4 || !this.sound || document.hidden || this.context?.state !== "running") return;
    const context = this.context, now = context.currentTime;
    const level = Math.max(0, Math.min(1, intensity));
    const duration = .13;
    const carrier = context.createOscillator();
    carrier.type = "sawtooth";
    // A pronounced high-to-low laser sweep gives each pulse its "chew" syllable.
    carrier.frequency.setValueAtTime(1800 + level * 1200, now);
    carrier.frequency.exponentialRampToValueAtTime(420 + level * 200, now + .04);
    carrier.frequency.exponentialRampToValueAtTime(90 + level * 70, now + duration);
    const modulation = context.createOscillator();
    modulation.type = "sine";
    modulation.frequency.setValueAtTime(110 + level * 60, now);
    modulation.frequency.exponentialRampToValueAtTime(24, now + duration);
    const modulationGain = context.createGain();
    modulationGain.gain.setValueAtTime(220 + level * 180, now);
    modulationGain.gain.exponentialRampToValueAtTime(12, now + duration);
    modulation.connect(modulationGain).connect(carrier.frequency);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(4200 + level * 1600, now);
    filter.frequency.exponentialRampToValueAtTime(280 + level * 160, now + duration);
    filter.Q.value = 5;
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime((.05 + level * .16) * (1 + (score - 4) * .1), now + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    carrier.connect(filter).connect(gain).connect(context.destination);
    this.powerSources.add(carrier);
    this.powerSources.add(modulation);
    carrier.onended = () => {
      this.powerSources.delete(carrier); this.powerSources.delete(modulation);
      carrier.disconnect(); modulation.disconnect(); modulationGain.disconnect(); filter.disconnect(); gain.disconnect();
    };
    carrier.start(now); modulation.start(now);
    carrier.stop(now + duration); modulation.stop(now + duration);
  }
  tableSlam(score: number, shakeMs?: number): void {
    const strength = slamIntensity(score);
    if (!strength || document.hidden) return;
    const pattern = impactVibration(score, shakeMs);
    if (pattern.length) this.impactVibrating = this.requestVibration(pattern, "Impact vibration").accepted;
    this.stopPowerSounds();
    if (!this.sound || this.context?.state !== "running") return;
    const context = this.context, now = context.currentTime;
    const explosive = score >= 4;
    const duration = explosive ? Math.max(1.3, Math.min(3, (shakeMs ?? 500) / 1000 + .8)) : .24;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = .001;
    limiter.release.value = .08;
    // Boost after peak control so the compressor does not cancel the requested volume increase.
    const output = context.createGain();
    output.gain.setValueAtTime(4, now);
    limiter.connect(output).connect(context.destination);
    // A broadband blast gives way to rolling brown noise and a long bass tail.
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate;
      const noise = Math.random() * 2 - 1;
      if (explosive) {
        brown = (brown + noise * .035) / 1.035;
        const tail = (1 - t / duration) ** 1.2;
        const rolling = .8 + .2 * Math.sin(t * 37) * Math.sin(t * 53);
        samples[i] = noise * Math.exp(-t * 55) * .8 + brown * 4 * tail * rolling;
      } else samples[i] = noise * (Math.exp(-t * 90) * .8 + Math.exp(-t * 25) * .2);
    }
    const slap = context.createBufferSource();
    slap.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(explosive ? 6500 : 2100, now);
    if (explosive) {
      filter.frequency.exponentialRampToValueAtTime(180, now + .16);
      filter.frequency.exponentialRampToValueAtTime(75, now + duration);
    }
    const slapGain = context.createGain();
    slapGain.gain.setValueAtTime(strength * (explosive ? .25 : .11), now);
    slap.connect(filter).connect(slapGain).connect(limiter);
    const body = context.createOscillator();
    body.type = explosive ? "triangle" : "sine";
    body.frequency.setValueAtTime(explosive ? 125 : 115, now);
    if (explosive) body.frequency.exponentialRampToValueAtTime(48, now + .09);
    body.frequency.exponentialRampToValueAtTime(explosive ? 30 : 52, now + duration);
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(strength * (explosive ? .13 : .065), now + .003);
    if (explosive) bodyGain.gain.exponentialRampToValueAtTime(strength * .055, now + .18);
    bodyGain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    body.connect(bodyGain).connect(limiter);
    if (explosive) { this.powerSources.add(slap); this.powerSources.add(body); }
    slap.onended = () => { this.powerSources.delete(slap); slap.disconnect(); filter.disconnect(); slapGain.disconnect(); };
    body.onended = () => { this.powerSources.delete(body); body.disconnect(); bodyGain.disconnect(); limiter.disconnect(); output.disconnect(); };
    slap.start(now);
    body.start(now);
    body.stop(now + duration);
  }
  fireRumble(durationMs: number): void {
    if (!this.sound || document.hidden || this.context?.state !== "running" || durationMs <= 0) return;
    this.stopFireRumble();
    const context = this.context;
    const now = context.currentTime;
    const duration = durationMs / 1000;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    // Broad, low-pitched noise swells with the flames and dies away with the smoke.
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 260;
    filter.Q.value = .55;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.65, now + duration * .18);
    gain.gain.linearRampToValueAtTime(.32, now + duration * .55);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      if (this.fireSource === source) this.fireSource = undefined;
    };
    this.fireSource = source;
    source.start(now);
    source.stop(now + duration);
  }

  stopFireRumble(): void {
    const source = this.fireSource;
    this.fireSource = undefined;
    source?.stop();
  }

  setup(): void {
    const sound=document.getElementById("sound-enabled") as HTMLInputElement;
    const dialog=document.getElementById("feedback-dialog") as HTMLDialogElement;
    const sync=()=>{sound.checked=this.sound;this.save();};
    const enable=()=>{this.sound=true;sync();void this.unlock().then(()=>this.tick());dialog.close();};
    sound.checked=this.sound;
    sound.onchange=()=>{this.sound=sound.checked;if(!this.sound){this.stopFireRumble();this.stopPowerSounds();}this.save();void this.unlock();};
    document.getElementById("allow-feedback")!.onclick=enable;
    document.getElementById("decline-feedback")!.onclick=()=>{sync();dialog.close();};
    document.getElementById("enable-feedback")!.onclick=()=>dialog.showModal();
    document.addEventListener("pointerup",()=>void this.unlock(),{passive:true});
    document.addEventListener("keydown",()=>void this.unlock());
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.stopFireRumble(); this.stopImpactVibration(); this.stopPowerSounds(); } });
    let saved=false;try{saved=localStorage.getItem(this.key)!==null;}catch{}
    if(!saved) dialog.showModal();
  }
}

// Emit at most once per elapsed second, never a burst after a stalled frame.
export function countdownBeat(elapsed: number): number { return Math.floor(Math.max(0,elapsed)/1000); }

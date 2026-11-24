const unavailable = '暂时无法播放发音，请重试。';
const isEnglish = (voice: SpeechSynthesisVoice) => /^en(?:[-_]|$)/i.test(voice.lang);

async function availableVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  // Edge can report online voices and installed voices in separate batches.
  const ready = (list: SpeechSynthesisVoice[]) => list.some(isEnglish) && list.some(voice => voice.localService);
  const voices = synth.getVoices();
  if (ready(voices)) return voices;
  await new Promise<void>(resolve => {
    function finish() {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', changed);
      resolve();
    }
    function changed() { if (ready(synth.getVoices())) finish(); }
    const timer = window.setTimeout(finish, 500);
    synth.addEventListener('voiceschanged', changed);
  });
  return synth.getVoices();
}

function speakerIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');
  icon.append(path);
  return icon;
}

export class PronunciationButton {
  readonly button = document.createElement('button');
  readonly message = document.createElement('p');
  private target = '';
  private active: SpeechSynthesisUtterance | null = null;

  constructor() {
    this.button.type = 'button';
    this.button.className = 'pronounce';
    this.button.append(speakerIcon());
    this.button.addEventListener('click', event => { if (event.isTrusted) void this.play(); });
    this.message.className = 'speech-message status';
    this.message.setAttribute('role', 'status');
  }
  setTarget(target: string) {
    if (this.target === target) return;
    this.target = target;
    this.button.title = '朗读 ' + target;
    this.button.setAttribute('aria-label', this.button.title);
    this.message.textContent = '';
    this.updateButton();
  }
  private updateButton() {
    this.button.setAttribute('aria-disabled', String(this.active?.text === this.target));
  }
  private async play() {
    const target = this.target;
    if (this.active?.text === target) return;
    this.message.textContent = '';
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') {
      this.message.textContent = '此浏览器未提供语音播放功能。';
      return;
    }
    const utterance = new SpeechSynthesisUtterance(target);
    this.active = utterance;
    this.updateButton();
    const finish = (message = '') => {
      if (this.active !== utterance) return;
      this.active = null;
      this.updateButton();
      if (this.target === target) this.message.textContent = message;
    };
    try {
      const voices = await availableVoices(synth);
      if (this.active !== utterance) return;
      const english = voices.filter(isEnglish);
      const american = english.filter(voice => /[-_]US(?:[-_]|$)/i.test(voice.lang));
      const voice = american.find(voice => voice.localService) ?? english.find(voice => voice.localService)
        ?? american[0] ?? english[0];
      if (voices.length && !voice) {
        finish('未找到英语语音，请在系统设置中添加。');
        return;
      }
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang.replaceAll('_', '-') ?? 'en-US';
      utterance.onend = () => finish();
      utterance.onerror = () => finish(unavailable);
      synth.speak(utterance);
    } catch { finish(unavailable); }
  }
  dispose() {
    // Drop card callbacks. The browser's cancel() also clears the webpage's speech queue.
    if (this.active) {
      this.active.onend = null;
      this.active.onerror = null;
      this.active = null;
    }
  }
}

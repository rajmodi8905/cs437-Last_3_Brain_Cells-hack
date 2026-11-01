import { useEffect, useRef, useState } from 'react';
const formats: [string, string][] = [
  ['Images', 'JPEG, PNG, WebP / 20 MB'],
  ['PDFs', 'Up to 50 pages / 20 MB'],
  ['Notes and webpages', 'Up to 20,000 characters'],
  ['Audio', 'MP3, WAV, M4A / 5 min / 50 MB'],
  ['Video', 'H.264 MP4 / 2 min / 100 MB'],
];
const claims: [string, string][] = [
  ['No account', 'There is nothing to sign up for. Each device keeps its own separate library.'],
  [
    'Search runs locally',
    'A one-time setup of about 445 MB downloads the models. After that, processing and search happen on this device.',
  ],
  [
    'Few network requests',
    'Only the model download, the app itself and webpages you ask it to capture use the network.',
  ],
  [
    'You hold the backup',
    'Browsers can clear local storage. Export a ZIP of your originals and restore it on another device. The ZIP is not encrypted.',
  ],
];
const steps: [string, string][] = [
  [
    'Save the original.',
    'Drop in a screenshot, PDF, recording or note. It is stored in your browser first, so you see it saved before any processing starts.',
  ],
  [
    'Describe what you remember.',
    'Type the idea, not the filename. Search covers extracted text, English speech and what is in your images.',
  ],
  [
    'Open the exact place.',
    'Results point to the saved original: the right page of a PDF or the right seconds of a recording. Open it and check.',
  ],
];
// Sample data for the animated demo only. It is labelled as such on screen.
const samples = [
  {
    q: 'when do guests need a pass',
    kind: 'PDF',
    t: 'Hostel mess rules',
    x: 'Guests need a pass from the warden before 6 pm.',
    l: 'Page 2',
  },
  {
    q: 'what the coach said about the endgame',
    kind: 'Audio',
    t: 'Chess lecture',
    x: 'Trade the rooks before the endgame starts.',
    l: '0:02 to 0:08',
  },
  {
    q: 'poster with the red backpack',
    kind: 'Image',
    t: 'Lost and found poster',
    x: 'Visual match from the saved original.',
    l: 'Whole item',
  },
];
function useLandingEffects(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <T extends Element>(selector: string) => el.querySelector<T>(selector)!;
    const all = (selector: string) => Array.from(el.querySelectorAll<HTMLElement>(selector));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const observers: IntersectionObserver[] = [];
    const measureHeader = () => {
      el.style.setProperty(
        '--lp-header-height',
        `${q('header.top').getBoundingClientRect().height}px`,
      );
    };
    measureHeader();
    const headerObserver =
      'ResizeObserver' in window ? new ResizeObserver(measureHeader) : undefined;
    headerObserver?.observe(q('header.top'));

    const revealed = all('.rv');
    if ('IntersectionObserver' in window && !still) {
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target);
            }
          }),
        { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
      );
      observers.push(io);
      revealed.forEach((node) => io.observe(node));
      later(() => all('.hero .rv').forEach((n) => n.classList.add('in')), 500);
    } else revealed.forEach((node) => node.classList.add('in'));

    const bar = q<HTMLElement>('.lp-progress');
    const head = q<HTMLElement>('.lp-headline');
    const stepsSection = q<HTMLElement>('.steps');
    const nums = all('.step-num span');
    const copies = all('.step-copy > div:not(.ticks)');
    const ticks = all('.ticks i');
    const count = q<HTMLElement>('.step-count');
    let current = 0;
    let ticking = false;
    const setStep = (n: number) => {
      if (n === current) return;
      nums.forEach((node, i) => (node.className = i === n ? 'on' : i < n ? 'off' : ''));
      copies.forEach((node, i) => node.classList.toggle('on', i === n));
      ticks.forEach((node, i) => node.classList.toggle('on', i <= n));
      count.textContent = `0${n + 1} / 03`;
      current = n;
    };
    const frame = () => {
      ticking = false;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (!still) {
        bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
        if (y < window.innerHeight) head.style.transform = `translateY(${y * -0.12}px)`;
        if (window.innerWidth > 860) {
          const r = stepsSection.getBoundingClientRect();
          const span = r.height - window.innerHeight;
          const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
          setStep(Math.min(2, Math.floor(p * 3)));
        }
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(frame);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('resize', measureHeader);
    frame();
    if (still) {
      nums.forEach((node) => {
        node.style.transform = 'none';
        node.style.position = 'static';
      });
      copies.forEach((node) => {
        node.classList.add('on');
        node.style.position = 'static';
      });
    }

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      observers.forEach((o) => o.disconnect());
      headerObserver?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('resize', measureHeader);
    };
  }, [root]);
}

function SearchDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [still, setStill] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [demo, setDemo] = useState({ sample: 0, length: 0, show: false });
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setStill(media.matches);
    media.addEventListener('change', update);
    const observer =
      'IntersectionObserver' in window
        ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
        : undefined;
    if (root.current) observer?.observe(root.current);
    return () => {
      media.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (paused || still || !visible) return;
    const typing = demo.length < samples[demo.sample].q.length;
    const delay = typing ? 38 + Math.random() * 40 : demo.show ? 3800 : 380;
    const timer = window.setTimeout(() => {
      setDemo(
        typing
          ? { ...demo, length: demo.length + 1 }
          : demo.show
            ? { sample: (demo.sample + 1) % samples.length, length: 0, show: false }
            : { ...demo, show: true },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [demo, paused, still, visible]);
  const sample = samples[still ? 0 : demo.sample];
  return (
    <div
      className="demo rv"
      ref={root}
      data-paused={paused}
      style={{ '--d': 2 } as React.CSSProperties}
    >
      <div className="bar mono">
        <span>Search</span>
        <span>Sample data, not a real library</span>
      </div>
      <div role="img" aria-label={`Example: “${sample.q}” finds ${sample.t}, ${sample.l}`}>
        <div className="q">
          <span className="lp-typed">{still ? sample.q : sample.q.slice(0, demo.length)}</span>
          <span className="caret" aria-hidden="true" />
        </div>
        <div className={`res ${still || demo.show ? 'show' : ''}`}>
          <span className="mono lp-kind" style={{ color: 'var(--muted)' }}>
            {sample.kind}
          </span>
          <h3 className="lp-title">{sample.t}</h3>
          <p className="lp-text">{sample.x}</p>
          <span className="loc lp-loc">{sample.l}</span>
        </div>
      </div>
      {!still && (
        <div className="demo-controls">
          <button
            type="button"
            className="demo-toggle"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Resume demo' : 'Pause demo'}
          </button>
        </div>
      )}
    </div>
  );
}
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useLandingEffects(root);
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <div className="landing" ref={root}>
      <div className="lp-progress" aria-hidden="true" />
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#/" onClick={jump('lp-top')}>
            <i aria-hidden="true" />
            Campus Recall
          </a>
          <nav aria-label="Page sections">
            <a href="#/" onClick={jump('lp-how')}>
              How it works
            </a>
            <a href="#/" onClick={jump('lp-formats')}>
              What it holds
            </a>
            <a href="#/" onClick={jump('lp-device')}>
              Your device
            </a>
            <a className="btn signal keep" href="#/library">
              Open library
            </a>
          </nav>
        </div>
      </header>
      <main id="lp-top" tabIndex={-1}>
        <div className="hero wrap">
          <div className="eyebrow mono">
            <span>A personal library for campus information</span>
            <span>Student project</span>
          </div>
          <h1 className="big lp-headline" aria-label="Save it here. Find it again.">
            <span className="ln" aria-hidden="true">
              <span className="w" style={{ '--i': 0 } as React.CSSProperties}>
                Save
              </span>{' '}
              <span className="w" style={{ '--i': 1 } as React.CSSProperties}>
                it
              </span>{' '}
              <span className="w" style={{ '--i': 2 } as React.CSSProperties}>
                here.
              </span>
            </span>
            <span className="ln" aria-hidden="true">
              <span className="w sig" style={{ '--i': 3 } as React.CSSProperties}>
                Find
              </span>{' '}
              <span className="w sig" style={{ '--i': 4 } as React.CSSProperties}>
                it
              </span>{' '}
              <span className="w sig" style={{ '--i': 5 } as React.CSSProperties}>
                again.
              </span>
            </span>
          </h1>
          <div className="hero-grid">
            <div className="rv">
              <p className="lede">
                Keep screenshots, PDFs, notes and recordings on your own device. Later, describe
                what you remember and open the exact page or moment.
              </p>
              <div className="cta-row">
                <a className="btn signal" href="#/library">
                  Open your library
                </a>
                <a href="#/" onClick={jump('lp-how')} style={{ fontWeight: 700 }}>
                  See how it works
                </a>
              </div>
              <p className="note">No account. No cloud inference. Works offline after one setup.</p>
            </div>
            <SearchDemo />
          </div>
        </div>

        <section id="lp-how" className="steps" aria-labelledby="lp-how-h">
          <div className="pin">
            <div className="wrap">
              <div className="sec-head mono">
                <span id="lp-how-h">How it works</span>
                <span className="step-count">01 / 03</span>
              </div>
              <div className="step-stage" style={{ marginTop: 'clamp(20px,4vw,56px)' }}>
                <div className="step-num" aria-hidden="true">
                  <span className="on">1</span>
                  <span>2</span>
                  <span>3</span>
                </div>
                <div className="step-copy">
                  {steps.map(([title, text], i) => (
                    <div key={title} className={i === 0 ? 'on' : ''} data-n={`0${i + 1}`}>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  ))}
                  <div className="ticks" aria-hidden="true">
                    <i className="on" />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="lp-formats" className="formats" aria-labelledby="lp-f-h">
          <div className="wrap">
            <div className="sec-head mono">
              <span id="lp-f-h">What it holds</span>
              <span>Limits per item</span>
            </div>
            <h2 className="huge rv">Whatever you screenshot, scan or record.</h2>
            <div>
              {formats.map(([name, limit], i) => (
                <div className="row rv" key={name}>
                  <b className="n">0{i + 1}</b>
                  <h3>{name}</h3>
                  <span className="lim">{limit}</span>
                </div>
              ))}
            </div>
            <p className="note" style={{ margin: '20px 0 clamp(40px,6vw,96px)' }}>
              HEIC, MOV and HEVC files need conversion before importing.
            </p>
          </div>
        </section>

        <section id="lp-device" className="device" aria-labelledby="lp-d-h">
          <div className="wrap">
            <div className="sec-head mono">
              <span id="lp-d-h">On your device</span>
              <span>Privacy by design</span>
            </div>
            <h2 className="huge rv">Your library never leaves your browser.</h2>
            <div className="claims">
              {claims.map(([title, text], i) => (
                <div className="rv" key={title} style={{ '--d': i % 2 } as React.CSSProperties}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="lp-install" className="install" aria-labelledby="lp-i-h">
          <div className="wrap">
            <div className="sec-head mono">
              <span id="lp-i-h">Install it</span>
              <span>Optional</span>
            </div>
            <h2 className="huge rv">Keep it on your home screen.</h2>
            <ol>
              <li className="rv">
                <h3>On iPhone</h3>
                <p>Open the site in Safari, tap Share, then Add to Home Screen.</p>
              </li>
              <li className="rv" style={{ '--d': 1 } as React.CSSProperties}>
                <h3>On Android or laptop</h3>
                <p>
                  Use Chrome's app menu and choose Install. Installing needs HTTPS or localhost.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section className="final" aria-labelledby="lp-c-h">
          <div className="wrap">
            <h2 id="lp-c-h" className="rv">
              Start your library.
            </h2>
            <a className="btn rv" style={{ '--d': 1 } as React.CSSProperties} href="#/library">
              Open Campus Recall &rarr;
            </a>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <span>Built by IIT Gandhinagar students. Not an official IITGN service.</span>
          <nav aria-label="Legal and help">
            <a href="#/privacy">Privacy Policy</a>
            <a href="#/terms">Terms and Conditions</a>
            <a
              href="https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an issue
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

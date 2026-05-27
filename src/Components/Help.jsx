import { createSignal, createResource, Suspense, onMount } from "solid-js";
import { marked } from "marked";
import "./CSS/Help.css";

// ── Custom renderer: lazy-load images ────────────────────────────────────────
const renderer = new marked.Renderer();
renderer.image = ({ href, title, text }) => `<img src="${href}" alt="${text}"${title ? ` title="${title}"` : ""} loading="lazy" decoding="async">`;
marked.use({ renderer, gfm: true, breaks: true });

// ── Per-section dynamic loaders ───────────────────────────────────────────────
// Each MD file becomes its own tiny split chunk — none are bundled into Help.js
const loadIntro = () => import("../help-docs/intro.md?raw").then((m) => m.default);
const loadContents = () => import("../help-docs/contents.md?raw").then((m) => m.default);
const loadHistory = () => import("../help-docs/history.md?raw").then((m) => m.default);
const loadSetup = () => import("../help-docs/setup.md?raw").then((m) => m.default);

// ── Markdown section ──────────────────────────────────────────────────────────
// `fetcher` is only called when `active` flips true — keeps idle sections inert
const MdSection = (props) => {
  const [resource] = createResource(() => props.active, props.fetcher);
  return (
    <section id={props.id} class="scroll-section Help-md-body">
      <Suspense fallback={<div class="Help-md-skeleton" />}>
        <div innerHTML={resource() ? marked.parse(resource()) : ""} />
      </Suspense>
    </section>
  );
};

// ── SVGs (unchanged) ──────────────────────────────────────────────────────────
const BookSVG = ({ size = 100 }) => (
  <svg width={size} height={size} id="icons" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 340">
    <rect x="10" y="259.88" width="320" height="43.453" style="fill:#cddbff" />
    <path d="M187.422,69.553S173.807,68.762,170,82.5V278.482c3.807-13.733,17.422-12.942,17.422-12.942v-.009H330V69.553Z" style="fill:#eaf5ff" />
    <path d="M152.578,69.553s13.12-.823,16.927,12.91l.5,196.019c-3.807-13.733-17.422-12.942-17.422-12.942v-.009H10V69.553Z" style="fill:#99a8db" />
    <path d="M301.324,129.7H223.405a4,4,0,0,1,0-8h77.919C306.557,121.777,306.6,129.6,301.324,129.7Z" style="fill:#c9d4ff" />
    <path d="M301.324,157.356H206.653c-5.227-.081-5.282-7.908,0-8h94.67C306.551,149.436,306.607,157.264,301.324,157.356Z" style="fill:#c9d4ff" />
    <path d="M301.324,185.017H206.653c-5.227-.08-5.282-7.908,0-8h94.67C306.551,177.1,306.607,184.925,301.324,185.017Z" style="fill:#c9d4ff" />
    <path d="M284.571,212.678h-5.064a4,4,0,0,1,0-8h5.064C289.828,204.767,289.83,212.589,284.571,212.678Z" style="fill:#c9d4ff" />
    <path d="M253.988,212.678H206.653c-5.243-.085-5.269-7.909,0-8h47.334C259.232,204.763,259.257,212.588,253.988,212.678Z" style="fill:#c9d4ff" />
    <path d="M114.939,129.7H50.965c-5.238-.084-5.274-7.909,0-8h63.974C120.177,121.778,120.213,129.6,114.939,129.7Z" style="fill:#6975a3" />
    <path d="M114.939,157.356H50.965c-5.238-.084-5.274-7.909,0-8h63.974C120.177,149.439,120.213,157.265,114.939,157.356Z" style="fill:#6975a3" />
    <path d="M114.939,185.017H50.965c-5.238-.084-5.274-7.909,0-8h63.974C120.177,177.1,120.213,184.926,114.939,185.017Z" style="fill:#6975a3" />
    <path d="M145.079,212.678H50.965c-5.227-.08-5.282-7.908,0-8h94.114C150.306,204.759,150.361,212.586,145.079,212.678Z" style="fill:#6975a3" />
    <path d="M170,280.432s-7.62-58.867-94.667-89.991V7.975C149.079,29.489,170,82.5,170,82.5Z" style="fill:#cddbff" />
    <path d="M146.617,280.432H10v8H146.617C151.862,288.347,151.885,280.522,146.617,280.432Z" style="fill:#a0abd9" />
    <path d="M330,280.432H235.987c-1.527,0-2.765,1.791-2.765,4s1.238,4,2.765,4H330Z" style="fill:#a0abd9" />
    <rect x="198.437" y="284.432" width="29.15" height="18.901" style="fill:#a0abd9" />
    <polygon points="193.98 284.432 193.98 331.641 214.762 322.245 235.544 331.641 235.544 284.432 193.98 284.432" style="fill:#f47676" />
    <path d="M330,307.333H253.988a4,4,0,0,1,0-8H326v-33.8c.087-5.249,7.91-5.264,8,0v37.8A4,4,0,0,1,330,307.333Z" style="fill:#383a49" />
    <path d="M193.979,307.333H10a4,4,0,0,1-4-4v-37.8a4,4,0,0,1,8,0v33.8H193.979C199.219,299.417,199.251,307.242,193.979,307.333Z" style="fill:#383a49" />
    <path d="M170,282.482a4.012,4.012,0,0,1-4-4V82.5c2.424-13.377,15.7-17.525,21.529-16.942H330a4,4,0,0,1,4,4V265.531a4,4,0,0,1-4,4c-.5-.008-142.351,0-142.807,0a13.173,13.173,0,0,0-13.339,10.017A4,4,0,0,1,170,282.482Zm4-199.415V265.7a22.231,22.231,0,0,1,13.353-4.17c.013,0,138.613,0,138.647,0V73.553c-.209-.006-138.593.01-138.785-.006C186.153,73.5,176.985,73.391,174,83.067Z" style="fill:#383a49" />
    <path d="M170,282.483a4,4,0,0,1-3.852-2.933,13.187,13.187,0,0,0-13.364-10.016c-.1.349-142.569-.258-142.782,0a4,4,0,0,1-4-4V69.553a4,4,0,0,1,4-4H54.175a4,4,0,0,1,0,8H14V261.531c.025,0,138.616,0,138.647,0a21.25,21.25,0,0,1,21.207,15.881A4.017,4.017,0,0,1,170,282.483Z" style="fill:#383a49" />
    <path d="M235.544,336.024c-.622.615-19.849-8.876-20.782-9.076l-19.123,8.716a4,4,0,0,1-5.66-3.64V284.432a4,4,0,0,1,4-4h41.565a4,4,0,0,1,4,4v47.592A4.024,4.024,0,0,1,235.544,336.024Zm-20.782-17.472c.01-.742,16.23,7.123,16.782,7.253V288.432H197.979v37.373C198.582,325.657,214.693,317.83,214.762,318.552Z" style="fill:#383a49" />
    <path d="M170,268.963a4,4,0,0,1-3.688-2.447c-.132-.31-6.288-14.51-20.587-30.38a136.393,136.393,0,0,0-71.286-41.795,4,4,0,0,1-3.108-3.9V7.975a4.028,4.028,0,0,1,4.892-3.9c48.931,9.983,85.188,49.038,97.461,76.867,1.944,4.9-5.242,7.907-7.372,3.106C155.926,59.711,122.034,23.2,79.333,13.084v174.2A144.308,144.308,0,0,1,151.9,231.031c15.189,16.934,21.529,31.755,21.791,32.377A4.022,4.022,0,0,1,170,268.963Z" style="fill:#383a49" />
  </svg>
);

const GithubSVG = () => (
  <svg height="16" viewBox="0 0 16 16" version="1.1" width="16" fill="currentColor" class="Help-github-icon">
    <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

// ── Main component ────────────────────────────────────────────────────────────
const Help = () => {
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  // Stagger activation: intro fires immediately, rest on idle
  const [activeIntro, setActiveIntro] = createSignal(false);
  const [activeContents, setActiveContents] = createSignal(false);
  const [activeHistory, setActiveHistory] = createSignal(false);
  const [activeSetup, setActiveSetup] = createSignal(false);

  onMount(() => {
    // First section: load right away so the page feels instant
    setActiveIntro(true);

    // Remaining sections: staggered during idle time
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 800));
    idle(() => {
      setActiveContents(true);
      setTimeout(() => setActiveHistory(true), 80);
      setTimeout(() => setActiveSetup(true), 160);
    });
  });

  const close = () => setSidebarOpen(false);
  const toggle = () => setSidebarOpen((v) => !v);

  return (
    <div class="Help-root">
      <div class="Help-container">
        <header class="Help-topbar">
          <div class="Help-topbar-brand">
            <BookSVG size={28} />
            <span class="Help-topbar-title">David's Bible App (Help Docs)</span>
          </div>
          <button class="Help-menu-btn" onClick={toggle} aria-label="Toggle navigation">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect y="4" width="22" height="2.2" rx="1.1" fill="currentColor" />
              <rect y="10" width="22" height="2.2" rx="1.1" fill="currentColor" />
              <rect y="16" width="22" height="2.2" rx="1.1" fill="currentColor" />
            </svg>
          </button>
        </header>

        <div class="Help-backdrop" classList={{ "is-visible": sidebarOpen() }} onClick={close} aria-hidden="true" />

        <aside class="Help-sidebar" classList={{ "is-open": sidebarOpen() }}>
          <button class="Help-sidebar-close" onClick={close} aria-label="Close navigation">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>

          <div class="Help-logo-card">
            <div class="Help-logo-icon">
              <BookSVG size={100} />
            </div>
            <h3>David's Bible App (DBA)</h3>
            <a href="https://github.com/Davids-Bible-App/DavidsBibleApp.github" target="_blank" class="btn-github">
              <GithubSVG />
              <span>Davids-Bible-App</span>
            </a>
          </div>

          <nav class="Help-toc-card">
            <h3>DBA Docs</h3>
            <ul>
              <li>
                <a href="#meta" class="Help-nav-link" onClick={close}>
                  Meta
                </a>
              </li>
              <li>
                <a href="#intro" class="Help-nav-link" onClick={close}>
                  Introduction
                </a>
              </li>
              <li>
                <a href="#contents" class="Help-nav-link" onClick={close}>
                  Tools Covered
                </a>
              </li>
              <li>
                <a href="#history" class="Help-nav-link" onClick={close}>
                  Personal History
                </a>
              </li>
              <li>
                <a href="#setup" class="Help-nav-link" onClick={close}>
                  Setting up the Application
                </a>
              </li>
            </ul>
          </nav>
        </aside>

        <main class="Help-main">
          <header id="meta" class="post-header">
            <h3>David's Bible Application Documentation</h3>
            <a href="https://github.com/Davids-Bible-App/DavidsBibleApp.github" target="_blank" class="btn-github">
              <GithubSVG />
              https://github.com/Davids-Bible-App
            </a>
            <div class="meta-data">May, 2026 &nbsp; David Quigley</div>
            <div class="tags">
              <span class="tag">getting started</span>
            </div>
          </header>

          <MdSection id="intro" fetcher={loadIntro} active={activeIntro()} />
          <MdSection id="contents" fetcher={loadContents} active={activeContents()} />
          <MdSection id="history" fetcher={loadHistory} active={activeHistory()} />
          <MdSection id="setup" fetcher={loadSetup} active={activeSetup()} />
        </main>
      </div>
    </div>
  );
};

export default Help;

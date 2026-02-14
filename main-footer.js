(function () {
  // ===== PAGE LAYOUT FIX =====
  document.documentElement.style.height = "100%";
  document.body.style.minHeight = "100vh";
  document.body.style.display = "flex";
  document.body.style.flexDirection = "column";

  // wrap existing content inside <main> if not present
  let main = document.querySelector("main");
  if (!main) {
    main = document.createElement("main");
    while (document.body.firstChild) {
      main.appendChild(document.body.firstChild);
    }
    document.body.appendChild(main);
  }
  main.style.flex = "1";

  // ===== Inject CSS =====
  const style = document.createElement("style");
  style.innerHTML = `
    .footer {
      padding: 2rem 0;
      margin: 2rem 0 0 0;
      background: hsl(0, 0%, 12%);
      color: white;
      font-family: 'Inter', system-ui, sans-serif;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    @media (min-width: 768px) {
      .footer-content {
        flex-direction: row;
        justify-content: space-between;
      }
    }

    .footer-logo {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 1.25rem;
      font-weight: 700;
      text-decoration: none;
    }

    .footer-logo-text { color: white; }
    .footer-logo-accent { color: hsl(18, 100%, 60%); }

    .footer-copyright {
      font-size: 0.875rem;
      color: rgba(255,255,255,0.7);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .heart-icon {
      color: hsl(18, 100%, 60%);
    }

    .footer-back-to-top {
      font-size: 0.875rem;
      color: rgba(255,255,255,0.7);
      text-decoration: none;
      transition: color 0.3s ease;
      pointer-events: none;
    }

    .footer-back-to-top:hover {
      color: hsl(18, 100%, 60%);
    }
  `;
  document.head.appendChild(style);

  // ===== Inject HTML =====
  const footer = document.createElement("footer");
  footer.className = "footer";

  footer.innerHTML = `
    <div class="footer-content">
        <a href="#home" class="footer-logo">
            <span class="footer-logo-text">Antar</span><span class="footer-logo-accent">GFX</span>
        </a>
        
        <p class="footer-copyright">
            © <span id="currentYear"></span> Antar Saha. Made with
            <svg class="heart-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
        </p>
        
        <a href="#" class="footer-back-to-top">Pixels with purpose.</a>
    </div>
  `;

  document.body.appendChild(footer);

  // ===== Year =====
  const yearEl = document.getElementById("currentYear");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
})();

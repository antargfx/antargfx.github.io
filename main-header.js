document.addEventListener("DOMContentLoaded", () => {
  const isHome =
    location.pathname === "/" ||
    location.pathname.endsWith("index.html");

  /* =============================
     Inject Header
  ============================== */
  document.body.insertAdjacentHTML(
    "afterbegin",
    `
<header id="header">
  <div class="container header-content">
    <a href="/" class="logo">
      <span class="logo-text">Antar</span><span class="logo-accent">GFX</span>
    </a>

    <nav class="nav" id="nav">
      <a href="/#home" class="nav-link" data-section="home">Home</a>
      <a href="/#about" class="nav-link" data-section="about">About</a>
      <a href="/#projects" class="nav-link" data-section="projects">Projects</a>

      <div class="nav-item has-submenu">
        <button class="nav-link submenu-toggle">
          <span>Tools</span>
          <svg class="dropdown-icon" viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        <div class="submenu">
          <a href="/events.html">Events</a>
          <a href="/software.html">Software</a>
        </div>
      </div>

      <a href="/#contact" class="nav-link" data-section="contact">Contact</a>
    <a href="/#contact" class="nav-link btn btn-primary btn-cta">Hire Me</a>
    </nav>


    <button class="mobile-menu-btn" id="mobileMenuBtn">
      <svg class="menu-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
      <svg class="close-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>
</header>
`
  );

  const header = document.getElementById("header");
  const nav = document.getElementById("nav");

  /* =============================
     Mobile menu toggle
  ============================== */
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const menuIcon = mobileMenuBtn.querySelector(".menu-icon");
  const closeIcon = mobileMenuBtn.querySelector(".close-icon");

  mobileMenuBtn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuIcon.style.display = open ? "none" : "block";
    closeIcon.style.display = open ? "block" : "none";
  });

  /* =============================
     Submenu toggle (ALL devices)
  ============================== */
  document.querySelectorAll(".submenu-toggle").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.parentElement.classList.toggle("open");
    });
  });

  /* close dropdown if clicking outside */
  document.addEventListener("click", () => {
    document.querySelectorAll(".has-submenu").forEach(item =>
      item.classList.remove("open")
    );
  });

  /* =============================
     Header background
  ============================== */
  window.addEventListener("scroll", () => {
    if (window.scrollY > 20) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  });

  /* =============================
     Active section (home only)
  ============================== */
  if (isHome) {
    const sections = ["home", "about", "projects", "contact"];
    const allLinks = document.querySelectorAll("[data-section]");

    function updateActive(section) {
      allLinks.forEach(link => {
        link.classList.toggle(
          "active",
          link.getAttribute("data-section") === section
        );
      });
    }

    window.addEventListener("scroll", () => {
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i]);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 20) {
          updateActive(sections[i]);
          break;
        }
      }
    });
  }
});

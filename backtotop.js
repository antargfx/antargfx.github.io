document.addEventListener("DOMContentLoaded", () => {

  /* =============================
     Create button
  ============================== */
  const btn = document.createElement("button");

  // SVG icon
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
  `;

  Object.assign(btn.style, {
    position: "fixed",
    bottom: "30px",
    right: "30px",
    width: "48px",
    height: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    background: "rgba(255, 106, 0, 0.65)",
    backdropFilter: "blur(6px)",
    color: "#fff",
    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
    opacity: "0",
    pointerEvents: "none",
    transform: "translateY(20px)",
    transition: "all .3s ease",
    zIndex: "9999"
  });

  document.body.appendChild(btn);

  /* =============================
     Show / hide on scroll
  ============================== */
  const SHOW_AFTER = 400;

  window.addEventListener("scroll", () => {
    if (window.scrollY > SHOW_AFTER) {
      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "auto";
      btn.style.transform = "translateY(0)";
    } else {
      btn.style.opacity = "0";
      btn.style.pointerEvents = "none";
      btn.style.transform = "translateY(20px)";
    }
  });

  /* =============================
     Scroll to top
  ============================== */
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* =============================
     Hover
  ============================== */
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.1)";
    btn.style.background = "rgba(255, 106, 0, 0.9)";
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.transform = window.scrollY > SHOW_AFTER ? "scale(1)" : "translateY(20px)";
    btn.style.background = "rgba(255, 106, 0, 0.65)";
  });

});

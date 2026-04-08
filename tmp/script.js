document.addEventListener("DOMContentLoaded", () => {
  // 1. Smooth Scrolling for Sidebar Links
  const links = document.querySelectorAll(".nav-link");

  links.forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href");
      const targetSection = document.querySelector(targetId);

      if (targetSection) {
        targetSection.scrollIntoView({
          behavior: "smooth",
        });
      }
    });
  });

  // 2. ScrollSpy (Highlight active section in sidebar)
  const sections = document.querySelectorAll(".scroll-section");

  const observerOptions = {
    root: null,
    rootMargin: "0px 0px -60% 0px", // Triggers when section is in top 40% of viewport
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // Remove active class from all links
        links.forEach((link) => link.classList.remove("active"));

        // Add active class to corresponding link
        const id = entry.target.getAttribute("id");
        const activeLink = document.querySelector(`.nav-link[href="#${id}"]`);
        if (activeLink) {
          activeLink.classList.add("active");
        }
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    observer.observe(section);
  });
});

// ===== Projects Data =====
const projects = [
    {
        title: 'Premium Sneaker Social Media Ad Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/f1e9c0231763265.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/231763265/Premium-Sneaker-Social-Media-Ad-Design',
        category: 'Social Media',
        appreciations: 22,
        views: 30,
    },
    {
        title: 'Headphone Social Media Post Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/a64d22231656785.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/231656785/Headphone-Social-Media-Post-Design',
        category: 'Social Media',
        appreciations: 5,
        views: 69,
    },
    {
        title: 'Natural Skincare Serum Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/cf7813231433745.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/231433745/Natural-Skincare-Serum-Social-Media-Post-Design',
        category: 'Product Design',
        appreciations: 1,
        views: 13,
    },
    {
        title: 'Luxury Watch Social Media Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/92aedd231226917.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/231226917/Luxury-Watch-Social-Media-Post-Design',
        category: 'Social Media',
        appreciations: 2,
        views: 25,
    },
    {
        title: 'Wireless Headphone Ad Banner',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/1dd41d229439645.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/229439645/Wireless-Headphone-Ad-Banner-Social-Media-Design',
        category: 'Ad Banner',
        appreciations: 5,
        views: 64,
    },
    {
        title: 'Burger Ad Design Social Media',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/3e0aca228978301.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/228978301/Burger-Ad-Design-Social-Media-Post-Promotion',
        category: 'Food Design',
        appreciations: 2,
        views: 22,
    },
    {
        title: 'Luxury Green Perfume Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/0d8d4f231163239.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/231163239/Luxury-Green-Perfume-Social-Media-Post-Design',
        category: 'Product Design',
        appreciations: 6,
        views: 116,
    },
    {
        title: 'Hot & Spicy Burger Ad Design',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/607e4a229430837.Y3JvcCw0MjYxLDMzMzMsMzY5LDA.jpg',
        link: 'https://www.behance.net/gallery/229430837/Hot-Spicy-Burger-Social-Media-Ad-Design',
        category: 'Food Design',
        appreciations: 4,
        views: 23,
    },
    {
        title: 'ESCAPE - Sportswear Brand Identity',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/c2ccbf228334107.Y3JvcCw4MDgsNjMyLDAsMA.jpg',
        link: 'https://www.behance.net/gallery/228334107/ESCAPE-Sportswear-Brand-Identity',
        category: 'Branding',
        appreciations: 2,
        views: 17,
    },
    {
        title: 'ESCAPE – Futuristic Sportswear Branding',
        image: 'https://mir-s3-cdn-cf.behance.net/projects/404/1593a5227978245.Y3JvcCwzMzY3LDI2MzMsMCww.jpg',
        link: 'https://www.behance.net/gallery/227978245/ESCAPE-Futuristic-Sportswear-Branding',
        category: 'Branding',
        appreciations: 5,
        views: 15,
    },
];

// ===== DOM Elements =====
const slideshowTrack = document.getElementById('slideshowTrack');
const slideshowIndicators = document.getElementById('slideshowIndicators');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const contactForm = document.getElementById('contactForm');
const toast = document.getElementById('toast');

// ===== State =====
let currentSlide = 0;
let itemsPerSlide = 3;
let isAnimating = false;
let autoSlideInterval;

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
    initSlideshow();
    initScrollEffects();
    initMobileMenu();
    initContactForm();
    setCurrentYear();
});

// ===== Slideshow =====
function initSlideshow() {
    updateItemsPerSlide();
    renderProjects();
    renderIndicators();
    startAutoSlide();
    initTouchSwipe();

    prevBtn.addEventListener('click', () => {
        if (!isAnimating) prevSlide();
    });

    nextBtn.addEventListener('click', () => {
        if (!isAnimating) nextSlide();
    });

    window.addEventListener('resize', () => {
        const newItemsPerSlide = getItemsPerSlide();
        if (newItemsPerSlide !== itemsPerSlide) {
            itemsPerSlide = newItemsPerSlide;
            currentSlide = 0;
            renderProjects();
            renderIndicators();
            updateSlidePosition();
        }
    });
}

// ===== Touch Swipe Support =====
let touchStartX = 0;
let touchEndX = 0;
const slideshowContainer = document.getElementById('slideshowContainer');

function initTouchSwipe() {
    slideshowContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        clearInterval(autoSlideInterval);
    }, { passive: true });

    slideshowContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
        startAutoSlide();
    }, { passive: true });
}

function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
        if (diff > 0 && !isAnimating) {
            // Swipe left - next slide
            nextSlide();
        } else if (diff < 0 && !isAnimating) {
            // Swipe right - previous slide
            prevSlide();
        }
    }
}

function getItemsPerSlide() {
    if (window.innerWidth < 640) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
}

function updateItemsPerSlide() {
    itemsPerSlide = getItemsPerSlide();
}

function getTotalSlides() {
    return Math.ceil(projects.length / itemsPerSlide);
}

function renderProjects() {
    slideshowTrack.innerHTML = projects.map((project, index) => `
        <div class="project-slide">
            <a href="${project.link}" target="_blank" rel="noopener noreferrer" class="project-card">
                <div class="project-image-wrapper">
                    <img src="${project.image}" alt="${project.title}" class="project-image" loading="lazy">
                    <div class="project-overlay">
                        <span>
                            View Project 
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                <polyline points="15 3 21 3 21 9"/>
                                <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                        </span>
                    </div>
                    <span class="project-category">${project.category}</span>
                </div>
                <div class="project-content">
                    <h3 class="project-title">${project.title}</h3>
                </div>
            </a>
        </div>
    `).join('');
}

function renderIndicators() {
    const totalSlides = getTotalSlides();
    slideshowIndicators.innerHTML = Array.from({ length: totalSlides }, (_, i) => `
        <button class="indicator ${i === 0 ? 'active' : ''}" data-slide="${i}" aria-label="Go to slide ${i + 1}"></button>
    `).join('');

    slideshowIndicators.querySelectorAll('.indicator').forEach(indicator => {
        indicator.addEventListener('click', () => {
            if (!isAnimating) {
                goToSlide(parseInt(indicator.dataset.slide));
            }
        });
    });
}

function updateSlidePosition() {
    const slideWidth = 100 / itemsPerSlide;
    const offset = currentSlide * itemsPerSlide * slideWidth;
    slideshowTrack.style.transform = `translateX(-${offset}%)`;

    // Update indicators
    slideshowIndicators.querySelectorAll('.indicator').forEach((indicator, index) => {
        indicator.classList.toggle('active', index === currentSlide);
    });
}

function nextSlide() {
    isAnimating = true;
    currentSlide = (currentSlide + 1) % getTotalSlides();
    updateSlidePosition();
    setTimeout(() => isAnimating = false, 500);
}

function prevSlide() {
    isAnimating = true;
    currentSlide = (currentSlide - 1 + getTotalSlides()) % getTotalSlides();
    updateSlidePosition();
    setTimeout(() => isAnimating = false, 500);
}

function goToSlide(index) {
    isAnimating = true;
    currentSlide = index;
    updateSlidePosition();
    setTimeout(() => isAnimating = false, 500);
    resetAutoSlide();
}

function startAutoSlide() {
    autoSlideInterval = setInterval(() => {
        if (!isAnimating) nextSlide();
    }, 5000);
}

function resetAutoSlide() {
    clearInterval(autoSlideInterval);
    startAutoSlide();
}

// ===== Contact Form =====
function initContactForm() {
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const subject = document.getElementById('subject').value;
        const message = document.getElementById('message').value;
        
        const recipientEmail = 'antar.gfx@gmail.com';
        const emailSubject = encodeURIComponent(subject);
        const emailBody = encodeURIComponent(
            `Hi Antar,\n\n${message}\n\n---\nFrom: ${name}\nEmail: ${email}`
        );
        
        // Check if mobile device (Android/iOS)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Open default mail app (Gmail app on Android)
            window.location.href = `mailto:${recipientEmail}?subject=${emailSubject}&body=${emailBody}`;
        } else {
            // Open Gmail in browser for desktop
            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${recipientEmail}&su=${emailSubject}&body=${emailBody}`;
            window.open(gmailUrl, '_blank');
        }
        
        // Reset form after short delay
        setTimeout(() => {
            contactForm.reset();
        }, 500);
    });
}

function showToast() {
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// ===== Current Year =====
function setCurrentYear() {
    document.getElementById('currentYear').textContent = new Date().getFullYear();
}

// ===== Intersection Observer for Animations =====
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.animationPlayState = 'running';
        }
    });
}, observerOptions);

// Observe all animated elements
document.querySelectorAll('.animate-fadeInUp, .animate-slideInLeft, .animate-scaleIn').forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
});

// Re-trigger animations when elements come into view
document.querySelectorAll('.skill-progress').forEach(bar => {
    bar.style.width = '0';
    const targetWidth = bar.style.cssText.match(/width:\s*(\d+%)/)?.[1] || bar.getAttribute('style').match(/width:\s*(\d+%)/)?.[1];
    
    const skillObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    bar.style.width = targetWidth;
                }, 300);
                skillObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    skillObserver.observe(bar.parentElement);
});

// ===== Skill Bars =====
const skillBars = document.querySelectorAll('.skill-progress');

skillBars.forEach(bar => {
    bar.style.width = '0%';
});

const skillObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const bar = entry.target;
            const percent = bar.getAttribute('data-percent');
            bar.style.width = percent + '%';
        }
    });
}, { threshold: 0.3 });

skillBars.forEach(bar => {
    skillObserver.observe(bar);
});

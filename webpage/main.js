(() => {
    // Controls marked data-js-only stay hidden until this class is set (see styles.css).
    document.documentElement.classList.add('js');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Segmented switches: a button sets data-state on the nearest [data-state] scope, and CSS shows the
    // scope's matching [data-when] parts.
    const bindSwitch = (group, onChange) => {
        const scope = group.closest('[data-state]');
        const buttons = [...group.querySelectorAll('button')];
        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                if (scope.dataset.state === button.value) {
                    return;
                }
                scope.dataset.state = button.value;
                buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
                onChange?.(button);
            });
        });
    };

    // RGTA's 16 x 16 search tokens around the target box, as in training (sample_target and
    // _boxes_to_token_masks): a square search region four times the box size, the tokens the box overlaps
    // as foreground, the one-token ring around them as boundary.
    const drawTokens = (svg) => {
        const [x, y, w, h] = svg.dataset.box.split(' ').map(Number);
        const [, , frameW, frameH] = svg.getAttribute('viewBox').split(' ').map(Number);
        const size = Math.ceil(Math.sqrt(w * h) * 4);
        const left = Math.round(x + w / 2 - size / 2);
        const top = Math.round(y + h / 2 - size / 2);
        // The box in token units: centred in the search region.
        const bx = ((size - 1) / 2 - w / 2) / size * 16;
        const by = ((size - 1) / 2 - h / 2) / size * 16;
        const bw = w / size * 16;
        const bh = h / size * 16;
        const fx0 = Math.min(15, Math.max(0, Math.floor(bx)));
        const fy0 = Math.min(15, Math.max(0, Math.floor(by)));
        const fx1 = Math.max(fx0 + 1, Math.min(16, Math.ceil(bx + bw)));
        const fy1 = Math.max(fy0 + 1, Math.min(16, Math.ceil(by + bh)));
        const rect = (x0, y0, x1, y1) => `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
        const lines = Array.from({length: 17}, (_, i) => `M${i} 0v16M0 ${i}h16`).join('');

        const add = (parent, tag, attributes) => {
            const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
            return parent.appendChild(node);
        };
        // Darken the frame outside the search region.
        add(svg, 'path', {class: 'token-outside', d: rect(0, 0, frameW, frameH) + rect(left, top, left + size, top + size)});
        const tokens = add(svg, 'g', {transform: `translate(${left} ${top}) scale(${size / 16})`});
        add(tokens, 'path', {
            class: 'token-bd',
            d: rect(Math.max(0, fx0 - 1), Math.max(0, fy0 - 1), Math.min(16, fx1 + 1), Math.min(16, fy1 + 1)) + rect(fx0, fy0, fx1, fy1),
        });
        add(tokens, 'path', {class: 'token-fg', d: rect(fx0, fy0, fx1, fy1)});
        add(tokens, 'path', {class: 'token-grid', d: lines});
        add(tokens, 'rect', {class: 'token-box', x: bx, y: by, width: bw, height: bh});
    };

    // Hero: drag the divider between the RGB frame and the SCAH or RGTA view, and switch between the two views.
    const setupHero = () => {
        const compare = document.querySelector('[data-compare]');
        const range = compare.querySelector('input[type="range"]');
        const images = [...compare.querySelectorAll('img')];
        const setSplit = (value) => {
            const [left, right] = compare.dataset.compareLabels.split('|');
            compare.style.setProperty('--split', `${value}%`);
            range.setAttribute('aria-valuetext', `${left} ${value}%, ${right} ${100 - value}%`);
        };
        const intro = () => {
            if (!reduceMotion.matches) {
                compare.classList.remove('is-intro');
                void compare.offsetWidth;
                compare.classList.add('is-intro');
            }
        };

        drawTokens(compare.querySelector('[data-box]'));
        setSplit(range.value);
        range.addEventListener('input', () => {
            compare.classList.remove('is-intro');
            setSplit(range.value);
        });
        compare.addEventListener('animationend', () => compare.classList.remove('is-intro'));

        // Each switch resets the divider and slides the new view in, like the first load.
        bindSwitch(compare.closest('[data-state]').querySelector('[data-switch]'), (button) => {
            compare.dataset.compareLabels = button.dataset.labels;
            range.value = 50;
            setSplit(50);
            intro();
        });

        const loaded = images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
            img.addEventListener('load', resolve, {once: true});
            img.addEventListener('error', resolve, {once: true});
        }));
        Promise.all(loaded).then(intro);
    };

    // Results chart: switch metric, and slide the marks from Base once the chart is in view.
    const setupChart = () => {
        const chart = document.querySelector('[data-chart]');
        bindSwitch(chart.querySelector('[data-switch]'));
        if (reduceMotion.matches) {
            return;
        }
        chart.classList.add('is-pending');
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                chart.classList.remove('is-pending');
                observer.disconnect();
            }
        }, {threshold: 0.35});
        observer.observe(chart);
    };

    // Gallery: open frames in a dialog, with previous/next and arrow keys.
    const setupViewer = () => {
        const viewer = document.querySelector('[data-viewer]');
        const frames = [...document.querySelectorAll('[data-frame]')];
        const img = viewer.querySelector('[data-viewer-img]');
        const title = viewer.querySelector('[data-viewer-title]');
        const count = viewer.querySelector('[data-viewer-count]');
        let index = 0;

        // step: -1 for Previous, 1 for Next, 0 when the viewer opens.
        const show = (next, step = 0) => {
            index = (next + frames.length) % frames.length;
            const frame = frames[index];
            if (step) {
                img.style.setProperty('--swap-from', `${step * 32}px`);
                img.classList.remove('is-swapping');
                void img.offsetWidth;
                img.classList.add('is-swapping');
            }
            // Show the cached thumbnail at once, then swap in the full frame when it arrives.
            img.src = frame.querySelector('img').src;
            const full = new Image();
            full.addEventListener('load', () => {
                if (frames[index] === frame) {
                    img.src = full.src;
                }
            }, {once: true});
            full.src = frame.href;
            img.alt = `${frame.dataset.frame} frame from Wildlife-LT`;
            title.textContent = frame.dataset.frame;
            count.textContent = `${index + 1} of ${frames.length}`;
        };

        frames.forEach((frame, i) => {
            frame.addEventListener('click', (event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                show(i);
                viewer.showModal();
            });
        });

        viewer.querySelector('[data-viewer-prev]').addEventListener('click', () => show(index - 1, -1));
        viewer.querySelector('[data-viewer-next]').addEventListener('click', () => show(index + 1, 1));
        viewer.querySelector('[data-viewer-close]').addEventListener('click', () => viewer.close());
        img.addEventListener('animationend', () => img.classList.remove('is-swapping'));
        viewer.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const step = event.key === 'ArrowLeft' ? -1 : 1;
                show(index + step, step);
            }
        });
        viewer.addEventListener('click', (event) => {
            if (event.target === viewer) {
                viewer.close();
            }
        });
        viewer.addEventListener('close', () => frames[index].focus());
    };

    // Citation: copy the BibTeX entry. The Clipboard API is missing outside secure contexts (plain http).
    const setupCopy = () => {
        const copy = document.querySelector('[data-copy]');
        if (!navigator.clipboard) {
            copy.remove();
            return;
        }
        const source = document.getElementById(copy.dataset.copy);
        const status = document.querySelector('[data-copy-status]');
        const label = copy.querySelector('[data-copy-label]');
        let timer;
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(source.textContent);
                copy.classList.add('is-done');
                label.textContent = 'Copied';
                status.textContent = 'BibTeX copied to the clipboard.';
            } catch {
                copy.classList.remove('is-done');
                label.textContent = 'Copy failed';
                status.textContent = 'Copying failed. Select the entry and copy it manually.';
            }
            clearTimeout(timer);
            timer = setTimeout(() => {
                copy.classList.remove('is-done');
                label.textContent = 'Copy';
                status.textContent = '';
            }, 2500);
        });
    };

    // Navigation: mark the section currently in view.
    const setupNav = () => {
        const header = document.querySelector('.site-header');
        const strip = document.querySelector('.nav-links');
        const links = [...strip.querySelectorAll('a')]
            .map((link) => ({link, target: document.querySelector(link.getAttribute('href'))}));
        let current = null;
        let ticking = false;

        const updateCurrent = () => {
            ticking = false;
            const offset = header.offsetHeight + 32;
            let next = null;
            links.forEach(({link, target}) => {
                if (target.getBoundingClientRect().top - offset <= 0) {
                    next = link;
                }
            });
            if (next === current) {
                return;
            }
            current?.removeAttribute('aria-current');
            next?.setAttribute('aria-current', 'true');
            current = next;
            if (next && strip.scrollWidth > strip.clientWidth) {
                strip.scrollTo({
                    left: next.parentElement.offsetLeft - strip.offsetLeft - 24,
                    behavior: reduceMotion.matches ? 'auto' : 'smooth',
                });
            }
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(updateCurrent);
            }
        }, {passive: true});
        updateCurrent();
    };

    setupHero();
    setupChart();
    bindSwitch(document.querySelector('.framework [data-switch]'));
    setupViewer();
    setupCopy();
    setupNav();
})();

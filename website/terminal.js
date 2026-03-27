(function () {
  'use strict';

  var TYPING_SPEED = 35;
  var PAUSE_BETWEEN = 800;

  var DEMO_SEQUENCE = [
    {
      command: 'brain ingest https://github.com/acme/docs.git',
      output:
        '🔍 Scanning https://github.com/acme/docs.git...\n' +
        '   Found 32 documentation files\n' +
        '\n' +
        '✅ Ingested 24 entries from acme/docs\n' +
        '   ⚠ 8 skipped (duplicate slug)',
      pauseAfter: 2500,
    },
    {
      command: 'brain search "kubernetes"',
      output:
        'Found 3 results:\n' +
        '┌────────────────────────┬────────┬───────┬───────────┐\n' +
        '│ Title                  │ Author │ Type  │ Tags      │\n' +
        '├────────────────────────┼────────┼───────┼───────────┤\n' +
        '│ K8s Deployment Guide   │ bob    │ guide │ k8s       │\n' +
        '│ CI Pipeline            │ carol  │ guide │ ci, k8s   │\n' +
        '│ Helm Chart Patterns    │ alice  │ skill │ helm, k8s │\n' +
        '└────────────────────────┴────────┴───────┴───────────┘',
      pauseAfter: 2500,
    },
    {
      command: 'brain push ./guide.md',
      output:
        '✅ Pushed: Docker Multi-Stage Builds\n' +
        '   Tags: docker (auto-detected)',
      pauseAfter: 2000,
    },
    {
      command: 'brain trail kubernetes',
      output:
        'K8s Deployment Guide\n' +
        '  → Helm Chart Patterns (tags: k8s)\n' +
        '  → CI Pipeline (tags: k8s, ci)',
      pauseAfter: 2500,
    },
  ];

  var terminal = document.getElementById('hero-terminal');
  if (!terminal) return;

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isPaused = false;
  var animationTimer = null;

  if (prefersReduced) {
    showStaticDemos();
    return;
  }

  terminal.addEventListener('mouseenter', function () { isPaused = true; });
  terminal.addEventListener('mouseleave', function () { isPaused = false; });

  runSequence();

  function showStaticDemos() {
    var html = '';
    for (var i = 0; i < DEMO_SEQUENCE.length; i++) {
      var step = DEMO_SEQUENCE[i];
      html +=
        '<div><span class="prompt">$ </span><span class="command">' +
        escapeHtml(step.command) +
        '</span></div><div class="output" style="white-space:pre">' +
        escapeHtml(step.output) +
        '</div>';
      if (i < DEMO_SEQUENCE.length - 1) html += '<div>&nbsp;</div>';
    }
    terminal.innerHTML = html;
  }

  function runSequence() {
    var stepIndex = 0;

    function nextStep() {
      if (stepIndex >= DEMO_SEQUENCE.length) {
        animationTimer = setTimeout(function () {
          terminal.innerHTML = '';
          stepIndex = 0;
          nextStep();
        }, 3000);
        return;
      }

      var step = DEMO_SEQUENCE[stepIndex];
      typeCommand(step.command, function () {
        appendOutput(step.output);
        stepIndex++;
        animationTimer = setTimeout(function () {
          waitForUnpause(nextStep);
        }, step.pauseAfter);
      });
    }

    nextStep();
  }

  function waitForUnpause(callback) {
    if (!isPaused) {
      callback();
      return;
    }
    var check = setInterval(function () {
      if (!isPaused) {
        clearInterval(check);
        callback();
      }
    }, 100);
  }

  function typeCommand(text, callback) {
    var lineEl = document.createElement('div');
    var promptSpan = document.createElement('span');
    promptSpan.className = 'prompt';
    promptSpan.textContent = '$ ';
    lineEl.appendChild(promptSpan);

    var cmdSpan = document.createElement('span');
    cmdSpan.className = 'command';
    lineEl.appendChild(cmdSpan);

    var cursorSpan = document.createElement('span');
    cursorSpan.className = 'cursor';
    cursorSpan.innerHTML = '&nbsp;';
    lineEl.appendChild(cursorSpan);

    terminal.appendChild(lineEl);

    var charIndex = 0;

    function typeNext() {
      if (isPaused) {
        animationTimer = setTimeout(typeNext, 100);
        return;
      }
      if (charIndex < text.length) {
        cmdSpan.textContent += text[charIndex];
        charIndex++;
        animationTimer = setTimeout(typeNext, TYPING_SPEED);
      } else {
        cursorSpan.remove();
        animationTimer = setTimeout(callback, PAUSE_BETWEEN);
      }
    }

    typeNext();
  }

  function appendOutput(text) {
    var outputEl = document.createElement('div');
    outputEl.className = 'output';
    outputEl.textContent = text;
    outputEl.style.whiteSpace = 'pre';
    terminal.appendChild(outputEl);

    var spacer = document.createElement('div');
    spacer.innerHTML = '&nbsp;';
    terminal.appendChild(spacer);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '\n');
  }

  // Scroll reveal
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length > 0 && !prefersReduced) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('visible'); });
  }

  // Copy button
  var copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add('copied');
        btn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        }, 2000);
      });
    });
  });
})();

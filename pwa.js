/* Offline status (cloud icon), update banner and service-worker registration. */
(function () {
  'use strict';
  var btn = document.getElementById('offline-btn');
  var toast = document.getElementById('toast'), toastMsg = document.getElementById('toast-msg'),
      toastBtn = document.getElementById('toast-btn'), toastX = document.getElementById('toast-x');
  var state = 'checking', progress = { done: 0, total: 0 }, version = '', waiting = null, hideTimer = 0, reloading = false;

  function label() {
    if (state === 'ready') return 'Ready offline' + (version ? ' · version ' + version : '');
    if (state === 'downloading') return progress.total ? 'Saving for offline… ' + progress.done + ' of ' + progress.total + ' files' : 'Saving for offline…';
    if (state === 'unsupported') return 'Offline mode is not available in this browser';
    return 'Checking offline status…';
  }
  function setState(s) {
    state = s;
    btn.setAttribute('data-state', s);
    btn.setAttribute('aria-label', label());
    btn.title = label();
  }
  function showToast(msg, opts) {
    opts = opts || {};
    clearTimeout(hideTimer);
    toastMsg.textContent = msg;
    toastBtn.hidden = !opts.action;
    if (opts.action) { toastBtn.textContent = opts.action; toastBtn.onclick = opts.onAction; }
    toast.classList.add('show');
    if (!opts.persist) hideTimer = setTimeout(hideToast, opts.ms || 4200);
  }
  function hideToast() { toast.classList.remove('show'); }
  toastX.addEventListener('click', hideToast);

  function showUpdate(worker) {
    waiting = worker;
    showToast('Update ready.', { action: 'Reload', persist: true, onAction: function () { if (waiting) waiting.postMessage({ type: 'skipWaiting' }); } });
  }

  btn.addEventListener('click', function () {
    if (state === 'ready') showToast('Ready offline — the whole map is saved on this phone.' + (version ? ' Version ' + version + '.' : ''));
    else if (state === 'downloading') showToast(label() + ' Keep the app open until the cloud shows a tick.');
    else if (state === 'unsupported') showToast(label() + '. (Private browsing switches it off.)');
    else showToast(label());
  });

  window.sgToast = showToast;                                          // used by app.js (e.g. "Saved on this phone. Share")

  if (!('serviceWorker' in navigator) || !window.caches) { setState('unsupported'); return; }

  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'progress') {
      progress = { done: d.done, total: d.total };
      if (state !== 'ready') setState('downloading'); else btn.setAttribute('aria-label', label());
    } else if (d.type === 'ready') {
      version = d.version; setState('ready');
    } else if (d.type === 'status') {
      version = d.version; progress = { done: d.done, total: d.total };
      setState(d.ready ? 'ready' : 'downloading');
    }
  });
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }             // first install claiming this page: nothing to reload
    if (reloading) return; reloading = true; location.reload();      // a newer version took over: load it
  });

  navigator.serviceWorker.register('sw.js').then(function (reg) {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    // ask the active worker whether every file is saved
    navigator.serviceWorker.ready.then(function (r) { if (r.active) r.active.postMessage({ type: 'status' }); });
    if (!navigator.serviceWorker.controller) setState('downloading');
    // look for a newer version whenever the app is opened or comes back to the foreground
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
  }).catch(function () { setState('unsupported'); });
})();

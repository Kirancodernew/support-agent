/*
 * Support Agent widget loader. A business adds one line to its site:
 *   <script src="https://<our-site>/widget.js" data-key="pk_live_…" async></script>
 * This adds a chat bubble. The chat itself runs in an iframe served from our site, so the host
 * page's CSS can't break it and the host page's scripts can't read the conversation.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__supportAgentWidget) return; // load once, even if pasted twice
  window.__supportAgentWidget = true;

  var key = script.getAttribute('data-key') || '';
  var base = new URL(script.src).origin;
  var frame = null;

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open support chat');
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z"/></svg>';
  button.style.cssText =
    'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;' +
    'background:#2563eb;color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);' +
    'display:flex;align-items:center;justify-content:center;z-index:2147483646;';

  function open() {
    if (!frame) {
      // Created on first click, so the chat costs the host page nothing until someone uses it.
      frame = document.createElement('iframe');
      frame.src = base + '/widget?key=' + encodeURIComponent(key);
      frame.title = 'Support chat';
      frame.style.cssText =
        'position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 40px));' +
        'height:min(560px,calc(100vh - 120px));border:0;border-radius:14px;background:#fff;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483647;';
      document.body.appendChild(frame);
    }
    frame.style.display = 'block';
    button.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (frame) frame.style.display = 'none';
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', function () {
    if (frame && frame.style.display !== 'none') close();
    else open();
  });

  // The close button inside the iframe asks us to hide it. Only trust messages from our own site.
  window.addEventListener('message', function (event) {
    if (event.origin === base && event.data && event.data.type === 'support-agent:close') close();
  });

  document.body.appendChild(button);
})();

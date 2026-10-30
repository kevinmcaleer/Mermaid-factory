// The browser keeps a URL's #fragment through the redirect to the login page,
// but the server never sees it. Carry it on in `next`, so a diagram opened
// from another page (#source=…, see frontend/src/handoff.js) survives logging in.
(function () {
  var next = document.querySelector('input[name="next"]');
  if (next && next.value && location.hash && next.value.indexOf("#") === -1) {
    next.value += location.hash;
  }
})();

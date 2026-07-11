// ---- Netlify Identity links (invites, recoveries) land on the site root
// with a token in the URL hash; forward them to /admin/ where the widget
// can process them. ----
if (location.hash && /invite_token|recovery_token|confirmation_token|email_change_token/.test(location.hash)) {
  location.replace('/admin/' + location.hash);
}

// ---- Language toggle: remember the choice, then navigate ----
document.querySelectorAll('.lang-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var lang = btn.dataset.lang;
    document.cookie = 'thauma_lang=' + lang + ';path=/;max-age=31536000;samesite=lax';
    window.location.href = btn.dataset.target;
  });
});

// ---- Mobile menu ----
var menuBtn = document.querySelector('.menu-btn');
if (menuBtn) {
  menuBtn.addEventListener('click', function () {
    document.body.classList.toggle('menu-open');
  });
}

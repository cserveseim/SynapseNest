'use strict';

document.querySelector('#cta').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get('email');
  document.querySelector('#message').textContent = `Thanks — ${email} is on the list.`;
  event.currentTarget.reset();
});

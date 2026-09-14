'use strict';

document.querySelectorAll('[data-piece]').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelector('#focus').textContent = `Focusing ${card.querySelector('h2').textContent}.`;
  });
});

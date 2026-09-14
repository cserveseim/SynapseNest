'use strict';

const notes = {
  roots: { title: 'Roots', body: 'Capture the durable beliefs that should survive every rewrite.' },
  paths: { title: 'Paths', body: 'Map how notes connect — questions, replies, and unfinished bridges.' },
  seasons: { title: 'Seasons', body: 'Mark what is evergreen versus what is only true this month.' }
};

const article = document.querySelector('#note');
document.querySelectorAll('[data-note]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-note]').forEach((node) => node.classList.remove('active'));
    button.classList.add('active');
    const note = notes[button.dataset.note];
    article.innerHTML = `<h2>${note.title}</h2><p>${note.body}</p>`;
  });
});

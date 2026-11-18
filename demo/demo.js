document.getElementById('trap').addEventListener('click', () => window.open('offer.html'));
document.getElementById('trap').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') window.open('offer.html');
});
document.getElementById('legitimate').addEventListener('click', () => window.open('offer.html'));

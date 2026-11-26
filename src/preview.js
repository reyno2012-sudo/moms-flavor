const phone = document.querySelector('.phone-frame');
const phoneStyle = getComputedStyle(phone);
const phoneWidth = parseFloat(phoneStyle.getPropertyValue('--phone-width'));
const phoneHeight = parseFloat(phoneStyle.getPropertyValue('--phone-height'));
const bezel = parseFloat(phoneStyle.getPropertyValue('--phone-bezel'));
const keyWidth = parseFloat(phoneStyle.getPropertyValue('--phone-key-width'));
const frameWidth = phoneWidth + 2 * (bezel + keyWidth);
const frameHeight = phoneHeight + 2 * bezel;
const gutter = 12;

function fitPreview() {
  const availableWidth = Math.max(0, window.innerWidth - gutter * 2);
  const availableHeight = Math.max(0, window.innerHeight - gutter * 2);
  const scale = Math.min(availableWidth / frameWidth, availableHeight / frameHeight);
  phone.style.setProperty('--preview-scale', scale);
}

fitPreview();
window.addEventListener('resize', fitPreview);

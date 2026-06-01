// ===== XTECH_KE Pairing Website =====

const socket = io();

// ===== PARTICLES =====
function createParticles() {
  var container = document.getElementById('particles');
  if (!container) return;
  for (var i = 0; i < 30; i++) {
    var p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (Math.random() * 8 + 6) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    var size = (Math.random() * 3 + 1) + 'px';
    p.style.width = size;
    p.style.height = size;
    var colors = ['#00f0ff', '#8b5cf6', '#ff006e', '#00ff88'];
    var c = colors[Math.floor(Math.random() * colors.length)];
    p.style.background = c;
    p.style.boxShadow = '0 0 6px ' + c + ', 0 0 12px ' + c;
    container.appendChild(p);
  }
}

// ===== STATUS =====
function updateServerStatus(online) {
  var badge = document.getElementById('serverStatus');
  if (online) {
    badge.className = 'status-badge online';
    badge.innerHTML = '<span class="status-dot"></span><span>Online</span>';
  } else {
    badge.className = 'status-badge offline';
    badge.innerHTML = '<span class="status-dot"></span><span>Offline</span>';
  }
}

// ===== STEPS =====
function showStep(stepNum) {
  document.querySelectorAll('.step-content').forEach(function(el) {
    el.classList.remove('active');
  });
  var target = document.getElementById('step' + stepNum);
  if (target) target.classList.add('active');

  document.querySelectorAll('.step').forEach(function(el) {
    var s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s < stepNum) el.classList.add('completed');
    else if (s === stepNum) el.classList.add('active');
  });

  document.querySelectorAll('.step-line').forEach(function(el, i) {
    var lineStep = i + 1;
    if (lineStep < stepNum) el.classList.add('active');
    else el.classList.remove('active');
  });
}

// ===== START PAIRING =====
function startPairing() {
  var phoneInput = document.getElementById('phoneNumber');
  var phone = phoneInput.value.trim();
  if (!phone || phone.length < 9) {
    showToast('Enter a valid phone number');
    return;
  }
  var btn = document.getElementById('btnPair');
  btn.disabled = true;
  btn.innerHTML = '<span>Requesting...</span>';

  var fullPhone = '254' + phone.replace(/^0+/, '');
  showStep(2);
  document.getElementById('loadingBox').style.display = 'flex';
  document.getElementById('pairingCodeContainer').style.display = 'none';
  document.getElementById('loadingText').textContent = 'Requesting pairing code...';
  document.getElementById('pairStatus').textContent = '';
  socket.emit('start-pair', fullPhone);
}

function formatPhone(input) {
  input.value = input.value.replace(/[^0-9]/g, '');
}

// ===== GO BACK =====
function goBack() {
  showStep(1);
  document.getElementById('pairingCodeContainer').style.display = 'none';
  document.getElementById('loadingBox').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'Requesting pairing code...';
  document.getElementById('pairStatus').textContent = '';
  var btn = document.getElementById('btnPair');
  btn.disabled = false;
  btn.innerHTML = '<span>Get Pairing Code</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ===== COPY SESSION =====
function copySession() {
  var textarea = document.getElementById('sessionId');
  var text = textarea.value;
  if (!text) { showToast('No session ID to copy'); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.querySelector('.btn-copy');
      var copyText = document.getElementById('copyText');
      btn.classList.add('copied');
      copyText.textContent = 'Copied!';
      showToast('Session ID copied!');
      setTimeout(function() { btn.classList.remove('copied'); copyText.textContent = 'Copy Session ID'; }, 3000);
    }).catch(function() {
      textarea.select();
      document.execCommand('copy');
      showToast('Session ID copied!');
    });
  } else {
    textarea.select();
    document.execCommand('copy');
    showToast('Session ID copied!');
  }
}

// ===== NEW SESSION =====
function newSession() {
  document.getElementById('sessionId').value = '';
  showStep(1);
  document.getElementById('phoneNumber').value = '';
  document.getElementById('pairingCodeContainer').style.display = 'none';
  document.getElementById('loadingBox').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'Requesting pairing code...';
  document.getElementById('pairStatus').textContent = '';
  var btn = document.getElementById('btnPair');
  btn.disabled = false;
  btn.innerHTML = '<span>Get Pairing Code</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ===== TOAST =====
function showToast(message) {
  var toast = document.getElementById('toast');
  var toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = message;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

// ===== SOCKET EVENTS =====
socket.on('connect', function() {
  console.log('Connected to server');
  updateServerStatus(true);
});

socket.on('disconnect', function() {
  console.log('Disconnected from server');
  updateServerStatus(false);
});

socket.on('pairing-code', function(code) {
  console.log('Pairing code received:', code);
  var container = document.getElementById('pairingCodeContainer');
  var codeDisplay = document.getElementById('pairingCode');
  var loadingBox = document.getElementById('loadingBox');

  // Build pairing code display
  var html = '';
  for (var i = 0; i < code.length; i++) {
    if (i === 4) html += '<span class="code-separator">-</span>';
    html += '<span class="code-digit">' + code[i] + '</span>';
  }
  codeDisplay.innerHTML = html;

  loadingBox.style.display = 'none';
  container.style.display = 'block';
  document.getElementById('pairStatus').textContent = 'Enter this code in WhatsApp';
  document.getElementById('pairStatus').className = 'status-message';
});

socket.on('connected', function(sessionId) {
  console.log('Connected! Session ID received');
  document.getElementById('sessionId').value = sessionId;
  showStep(3);
  showToast('WhatsApp paired successfully!');
});

socket.on('status', function(msg) {
  console.log('Status update:', msg);
  var loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.textContent = msg;
  document.getElementById('pairStatus').textContent = msg;
});

socket.on('error', function(msg) {
  console.log('Error:', msg);
  document.getElementById('pairStatus').textContent = msg;
  document.getElementById('pairStatus').className = 'status-message error';
  var loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.textContent = msg;
  showToast(msg);
});

socket.on('connection-lost', function() {
  showToast('Connection lost. Please try again.');
  goBack();
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
  createParticles();
  fetch('/api/health').then(function(res) { return res.json(); }).then(function() {
    updateServerStatus(true);
  }).catch(function() {
    updateServerStatus(false);
  });
});

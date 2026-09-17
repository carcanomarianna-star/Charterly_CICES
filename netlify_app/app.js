/**
 * Netlify Identity Widget Event Wiring & UI Controller
 */

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userProfileChip = document.getElementById('userProfileChip');
const userEmailLabel = document.getElementById('userEmailLabel');
const publicView = document.getElementById('publicView');
const protectedDashboard = document.getElementById('protectedDashboard');
const dashUserEmail = document.getElementById('dashUserEmail');

/**
 * Update UI state based on authentication status
 * @param {object|null} user - Netlify Identity user object or null
 */
function updateAuthState(user) {
  if (user && user.email) {
    // Authenticated state
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userProfileChip.classList.remove('hidden');
    userEmailLabel.textContent = user.email;

    publicView.classList.add('hidden');
    protectedDashboard.classList.remove('hidden');
    dashUserEmail.textContent = user.user_metadata?.full_name || user.email;
  } else {
    // Logged out / unauthenticated state
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userProfileChip.classList.add('hidden');
    userEmailLabel.textContent = '';

    publicView.classList.remove('hidden');
    protectedDashboard.classList.add('hidden');
    dashUserEmail.textContent = 'Candidate';
  }
}

/**
 * Open the Netlify Identity modal
 */
function openLoginModal() {
  if (window.netlifyIdentity) {
    window.netlifyIdentity.open();
  } else {
    console.error('Netlify Identity widget is not loaded.');
    alert('Netlify Identity is initializing. Please try again in a moment.');
  }
}

/**
 * Trigger logout via Netlify Identity widget
 */
function handleLogout() {
  if (window.netlifyIdentity) {
    window.netlifyIdentity.logout();
  }
}

// ── Initialize Netlify Identity Listeners ──
document.addEventListener('DOMContentLoaded', () => {
  if (!window.netlifyIdentity) {
    console.warn('Netlify Identity widget script not detected on window.');
    return;
  }

  // 1. Initial status check
  window.netlifyIdentity.on('init', (user) => {
    console.log('[Netlify Identity] Initialized. Current user:', user?.email || 'None');
    updateAuthState(user);
  });

  // 2. Successful Login
  window.netlifyIdentity.on('login', (user) => {
    console.log('[Netlify Identity] Login event:', user.email);
    updateAuthState(user);
    // Automatically close the modal after login
    window.netlifyIdentity.close();
  });

  // 3. Logout
  window.netlifyIdentity.on('logout', () => {
    console.log('[Netlify Identity] Logout event');
    updateAuthState(null);
  });

  // 4. Error logging
  window.netlifyIdentity.on('error', (err) => {
    console.error('[Netlify Identity] Error occurred:', err);
  });
});

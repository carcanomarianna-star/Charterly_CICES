/**
 * Database layer for Charterly Release
 * Uses an atomic file-backed JSON store with crypto hashing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Default admin credentials: Admin PIN / password is 'admin123' upon first boot
const DEFAULT_SALT = crypto.randomBytes(16).toString('hex');
const DEFAULT_HASH = hashPassword('admin123', DEFAULT_SALT);

const initialData = {
  admin: {
    salt: DEFAULT_SALT,
    hash: DEFAULT_HASH,
    updatedAt: new Date().toISOString()
  },
  allowedEmails: [
    // Pre-seed sample email addresses or leave empty
    { email: 'demo@charterly.com', addedAt: new Date().toISOString(), notes: 'Demo preview user', active: true }
  ],
  users: {},
  // Format: { [userId]: { id, email, salt, hash, createdAt, lastLoginAt, active: true } }
  userData: {}
  // Format: { [userId]: { state: {}, updatedAt } }
};

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const check = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

class Store {
  constructor() {
    this._data = null;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(path.dirname(DB_FILE))) {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this._data = JSON.parse(raw);
        if (!this._data.admin) this._data.admin = initialData.admin;
        if (!this._data.allowedEmails) this._data.allowedEmails = [];
        if (!this._data.users) this._data.users = {};
        if (!this._data.userData) this._data.userData = {};
      } else {
        this._data = initialData;
        this.save();
      }
    } catch (err) {
      console.error('Error initializing db:', err);
      this._data = initialData;
    }
  }

  save() {
    try {
      const tempPath = DB_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this._data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {
      console.error('Error saving db:', err);
    }
  }

  // Admin methods
  verifyAdminPassword(password) {
    return verifyPassword(password, this._data.admin.salt, this._data.admin.hash);
  }

  setAdminPassword(newPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(newPassword, salt);
    this._data.admin = { salt, hash, updatedAt: new Date().toISOString() };
    this.save();
    return true;
  }

  // Allowed email methods
  normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
  }

  isEmailAllowed(email) {
    const norm = this.normalizeEmail(email);
    const item = this._data.allowedEmails.find(e => e.email === norm);
    return !!(item && item.active);
  }

  getAllowedEmails() {
    return this._data.allowedEmails.map(item => {
      const norm = item.email;
      const registeredUser = Object.values(this._data.users).find(u => u.email === norm);
      return {
        ...item,
        isRegistered: !!registeredUser,
        registeredAt: registeredUser ? registeredUser.createdAt : null,
        lastLoginAt: registeredUser ? registeredUser.lastLoginAt : null
      };
    });
  }

  addAllowedEmail(email, notes = '') {
    const norm = this.normalizeEmail(email);
    if (!norm || !norm.includes('@')) throw new Error('Invalid email format');
    
    let existing = this._data.allowedEmails.find(e => e.email === norm);
    if (existing) {
      existing.active = true;
      existing.notes = notes || existing.notes;
    } else {
      this._data.allowedEmails.push({
        email: norm,
        addedAt: new Date().toISOString(),
        notes,
        active: true
      });
    }
    this.save();
    return this.getAllowedEmails();
  }

  addAllowedEmailsBulk(emailsArray, defaultNotes = 'Bulk added') {
    const added = [];
    for (const raw of emailsArray) {
      const norm = this.normalizeEmail(raw);
      if (norm && norm.includes('@')) {
        let existing = this._data.allowedEmails.find(e => e.email === norm);
        if (existing) {
          existing.active = true;
        } else {
          this._data.allowedEmails.push({
            email: norm,
            addedAt: new Date().toISOString(),
            notes: defaultNotes,
            active: true
          });
        }
        added.push(norm);
      }
    }
    this.save();
    return added;
  }

  toggleAllowedEmail(email, active) {
    const norm = this.normalizeEmail(email);
    const item = this._data.allowedEmails.find(e => e.email === norm);
    if (item) {
      item.active = typeof active === 'boolean' ? active : !item.active;
      this.save();
    }
    return this.getAllowedEmails();
  }

  removeAllowedEmail(email) {
    const norm = this.normalizeEmail(email);
    this._data.allowedEmails = this._data.allowedEmails.filter(e => e.email !== norm);
    this.save();
    return this.getAllowedEmails();
  }

  // User auth methods
  registerUser(email, password) {
    const norm = this.normalizeEmail(email);
    if (!norm || !norm.includes('@')) throw new Error('Valid email required');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

    if (!this.isEmailAllowed(norm)) {
      throw new Error('This email address has not been invited. Please contact the administrator.');
    }

    const existing = Object.values(this._data.users).find(u => u.email === norm);
    if (existing) {
      throw new Error('An account already exists for this email. Please log in.');
    }

    const id = 'usr_' + crypto.randomBytes(8).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const now = new Date().toISOString();

    const user = {
      id,
      email: norm,
      salt,
      hash,
      createdAt: now,
      lastLoginAt: now,
      active: true
    };

    this._data.users[id] = user;
    this.save();

    return { id, email: norm };
  }

  authenticateUser(email, password) {
    const norm = this.normalizeEmail(email);
    if (!norm || !password) throw new Error('Email and password required');

    if (!this.isEmailAllowed(norm)) {
      throw new Error('Access is restricted or has been revoked for this email address.');
    }

    const user = Object.values(this._data.users).find(u => u.email === norm);
    if (!user) {
      throw new Error('No account found for this email. Please create a password first.');
    }

    if (!user.active) {
      throw new Error('This account has been deactivated.');
    }

    const ok = verifyPassword(password, user.salt, user.hash);
    if (!ok) {
      throw new Error('Incorrect password');
    }

    user.lastLoginAt = new Date().toISOString();
    this.save();

    return { id: user.id, email: user.email };
  }

  getUser(id) {
    const user = this._data.users[id];
    if (!user) return null;
    return { id: user.id, email: user.email, active: user.active };
  }

  // User state sync methods
  getUserState(userId) {
    return this._data.userData[userId]?.state || null;
  }

  saveUserState(userId, state) {
    if (!userId) return;
    this._data.userData[userId] = {
      state,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return true;
  }
}

const store = new Store();
module.exports = store;

/**
 * Database layer for Charterly Release
 * - Supports Netlify Blobs for persistent cloud storage when hosted on Netlify
 * - Supports ADMIN_PASSWORD and ALLOWED_EMAILS environment variables (never wiped on redeploy)
 * - Falls back to atomic local db.json when running on localhost
 * - Supports full database backup export and restore via JSON
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let getStoreFn = null;
try {
  getStoreFn = require('@netlify/blobs').getStore;
} catch (e) {}

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const BLOB_STORE_NAME = 'charterly_data';
const BLOB_KEY = 'db_state';

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

  // Generate initial database structure
  getInitialData() {
    // Default admin password: check environment variable ADMIN_PASSWORD first, fallback to 'admin123'
    const adminPw = process.env.ADMIN_PASSWORD || 'admin123';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(adminPw, salt);

    // Initial allowed emails from env ALLOWED_EMAILS (comma or space separated)
    const allowed = [];
    if (process.env.ALLOWED_EMAILS) {
      const list = process.env.ALLOWED_EMAILS.split(/[\r\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      list.forEach(em => {
        if (em.includes('@') && !allowed.find(a => a.email === em)) {
          allowed.push({ email: em, addedAt: new Date().toISOString(), notes: 'Configured via Environment Variable', active: true });
        }
      });
    }

    // Default demo email if none provided
    if (allowed.length === 0) {
      allowed.push({ email: 'demo@charterly.com', addedAt: new Date().toISOString(), notes: 'Demo preview candidate', active: true });
    }

    return {
      admin: {
        salt,
        hash,
        updatedAt: new Date().toISOString()
      },
      allowedEmails: allowed,
      users: {},
      userData: {}
    };
  }

  init() {
    try {
      if (!fs.existsSync(path.dirname(DB_FILE))) {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this._data = JSON.parse(raw);
        if (!this._data.admin) this._data.admin = this.getInitialData().admin;
        if (!this._data.allowedEmails) this._data.allowedEmails = [];
        if (!this._data.users) this._data.users = {};
        if (!this._data.userData) this._data.userData = {};
      } else {
        this._data = this.getInitialData();
        this.save();
      }
      this.ensureEnvVariablesMerged();
    } catch (err) {
      console.error('Error initializing db:', err);
      this._data = this.getInitialData();
    }
  }

  // Ensure any emails specified in ALLOWED_EMAILS or ADMIN_PASSWORD env vars are always active
  ensureEnvVariablesMerged() {
    if (!this._data) return;

    // Merge ALLOWED_EMAILS env if defined
    if (process.env.ALLOWED_EMAILS) {
      const list = process.env.ALLOWED_EMAILS.split(/[\r\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      list.forEach(em => {
        if (em.includes('@')) {
          let existing = this._data.allowedEmails.find(a => a.email === em);
          if (existing) {
            existing.active = true;
          } else {
            this._data.allowedEmails.push({
              email: em,
              addedAt: new Date().toISOString(),
              notes: 'Configured via Environment Variable',
              active: true
            });
          }
        }
      });
    }
  }

  // Netlify Blobs helper with automatic context or manual credentials support
  getBlobStore() {
    if (!getStoreFn) return null;
    try {
      // Support manual configuration via SITE_ID and NETLIFY_TOKEN if automatic context isn't set
      if (process.env.SITE_ID && process.env.NETLIFY_TOKEN) {
        return getStoreFn({
          name: BLOB_STORE_NAME,
          siteID: process.env.SITE_ID,
          token: process.env.NETLIFY_TOKEN
        });
      }
      return getStoreFn(BLOB_STORE_NAME);
    } catch (e) {
      return null;
    }
  }

  // Sync latest state from Netlify Blobs if available
  async syncFromCloud() {
    const blobStore = this.getBlobStore();
    if (!blobStore) return;
    try {
      const cloudJson = await blobStore.get(BLOB_KEY, { type: 'json' });
      if (cloudJson && typeof cloudJson === 'object' && cloudJson.admin) {
        this._data = cloudJson;
        this.ensureEnvVariablesMerged();
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
        } catch(e) {}
      }
    } catch (err) {
      // Blobs not provisioned or running offline
    }
  }

  // Save to both local file and Netlify Blobs
  async save() {
    try {
      const tempPath = DB_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this._data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {}

    const blobStore = this.getBlobStore();
    if (blobStore) {
      try {
        await blobStore.setJSON(BLOB_KEY, this._data);
      } catch (err) {}
    }
  }

  // Full backup export
  async exportBackup() {
    await this.syncFromCloud();
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      data: {
        admin: this._data.admin,
        allowedEmails: this._data.allowedEmails,
        users: this._data.users,
        userData: this._data.userData
      }
    };
  }

  // Full backup restore
  async importBackup(backupJson) {
    if (!backupJson || typeof backupJson !== 'object') {
      throw new Error('Invalid backup file format.');
    }
    const incoming = backupJson.data || backupJson;
    if (!incoming.admin || !Array.isArray(incoming.allowedEmails)) {
      throw new Error('Backup file missing essential admin or allowlist data.');
    }

    this._data = {
      admin: incoming.admin,
      allowedEmails: incoming.allowedEmails,
      users: incoming.users || {},
      userData: incoming.userData || {}
    };

    this.ensureEnvVariablesMerged();
    await this.save();
    return true;
  }

  // Admin methods
  async verifyAdminPassword(password) {
    await this.syncFromCloud();

    // Check if ADMIN_PASSWORD environment variable overrides or matches directly
    if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
      return true;
    }

    return verifyPassword(password, this._data.admin.salt, this._data.admin.hash);
  }

  async setAdminPassword(newPassword) {
    await this.syncFromCloud();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(newPassword, salt);
    this._data.admin = { salt, hash, updatedAt: new Date().toISOString() };
    await this.save();
    return true;
  }

  // Allowed email methods
  normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
  }

  async isEmailAllowed(email) {
    await this.syncFromCloud();
    const norm = this.normalizeEmail(email);
    const item = this._data.allowedEmails.find(e => e.email === norm);
    return !!(item && item.active);
  }

  async getAllowedEmails() {
    await this.syncFromCloud();
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

  async addAllowedEmail(email, notes = '') {
    await this.syncFromCloud();
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
    await this.save();
    return this.getAllowedEmails();
  }

  async addAllowedEmailsBulk(emailsArray, defaultNotes = 'Bulk added') {
    await this.syncFromCloud();
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
    await this.save();
    return added;
  }

  async toggleAllowedEmail(email, active) {
    await this.syncFromCloud();
    const norm = this.normalizeEmail(email);
    const item = this._data.allowedEmails.find(e => e.email === norm);
    if (item) {
      item.active = typeof active === 'boolean' ? active : !item.active;
      await this.save();
    }
    return this.getAllowedEmails();
  }

  async removeAllowedEmail(email) {
    await this.syncFromCloud();
    const norm = this.normalizeEmail(email);
    this._data.allowedEmails = this._data.allowedEmails.filter(e => e.email !== norm);
    await this.save();
    return this.getAllowedEmails();
  }

  // User auth methods
  async registerUser(email, password) {
    await this.syncFromCloud();
    const norm = this.normalizeEmail(email);
    if (!norm || !norm.includes('@')) throw new Error('Valid email required');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

    const allowed = await this.isEmailAllowed(norm);
    if (!allowed) {
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
    await this.save();

    return { id, email: norm };
  }

  async authenticateUser(email, password) {
    await this.syncFromCloud();
    const norm = this.normalizeEmail(email);
    if (!norm || !password) throw new Error('Email and password required');

    const allowed = await this.isEmailAllowed(norm);
    if (!allowed) {
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
    await this.save();

    return { id: user.id, email: user.email };
  }

  async getUser(id) {
    await this.syncFromCloud();
    const user = this._data.users[id];
    if (!user) return null;
    return { id: user.id, email: user.email, active: user.active };
  }

  // User state sync methods
  async getUserState(userId) {
    await this.syncFromCloud();
    return this._data.userData[userId]?.state || null;
  }

  async saveUserState(userId, state) {
    if (!userId) return;
    await this.syncFromCloud();
    this._data.userData[userId] = {
      state,
      updatedAt: new Date().toISOString()
    };
    await this.save();
    return true;
  }
}

const store = new Store();
module.exports = store;

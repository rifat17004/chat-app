const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    // Not required because Google Sign-In won't have a password
  },
  authProvider: {
    type: String,
    default: 'firebase-email',
  },
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  publicKey: {
    type: String, // Public key string exported as JSON/JWK or Base64
  },
  encryptedPrivateKey: {
    type: String, // Private key string encrypted by Master Password
  },
  keyIv: {
    type: String, // Initialization vector used for encrypting the private key
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', UserSchema);

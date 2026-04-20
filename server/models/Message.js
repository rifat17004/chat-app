const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  senderId: {
    type: String, // We use firebaseUid to make it easier to query
    required: true,
  },
  receiverId: {
    type: String,
    required: true,
  },
  // The sender's copy of the AES key, encrypted with sender's public key
  senderEncryptedAesKey: {
    type: String,
    required: true,
  },
  // The receiver's copy of the AES key, encrypted with receiver's public key
  receiverEncryptedAesKey: {
    type: String,
    required: true,
  },
  // The actual text message encrypted with the AES key
  encryptedContent: {
    type: String,
    required: true,
  },
  // Initialization vector for AES-GCM
  iv: {
    type: String,
    required: true,
  },
  read: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Message', MessageSchema);

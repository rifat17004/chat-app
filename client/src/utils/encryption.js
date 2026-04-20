/**
 * encryption.js
 * Handles all Web Crypto API logic for End-to-End Encryption
 */

// Helper to convert string to ArrayBuffer and vice versa
const enc = new TextEncoder();
const dec = new TextDecoder();

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// 1. PIN to AES Key Derivation (PBKDF2)
export async function deriveKeyFromPIN(pin, saltString = 'my_chat_app_salt') {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltString),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// 2. Generate RSA Key Pair for the User
export async function generateRSAKeyPair() {
  return window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

// 3. Encrypt the Private Key with the derived PIN Key
export async function encryptPrivateKey(privateKey, aesPinKey) {
  // Export to JWK
  const jwk = await window.crypto.subtle.exportKey('jwk', privateKey);
  const jwkString = JSON.stringify(jwk);
  
  // Encrypt with AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesPinKey,
    enc.encode(jwkString)
  );

  return {
    encryptedPrivateKeyBase64: arrayBufferToBase64(encrypted),
    ivBase64: arrayBufferToBase64(iv)
  };
}

// 4. Decrypt the Private Key
export async function decryptPrivateKey(encryptedPrivateKeyBase64, ivBase64, aesPinKey) {
  const encryptedBytes = base64ToArrayBuffer(encryptedPrivateKeyBase64);
  const iv = base64ToArrayBuffer(ivBase64);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    aesPinKey,
    encryptedBytes
  );

  const jwkString = dec.decode(decrypted);
  const jwk = JSON.parse(jwkString);

  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

// 5. Export Public Key to Base64 String
export async function exportPublicKey(publicKey) {
  const spki = await window.crypto.subtle.exportKey('spki', publicKey);
  return arrayBufferToBase64(spki);
}

// 6. Import Public Key from Base64 String
export async function importPublicKey(base64Key) {
  const spki = base64ToArrayBuffer(base64Key);
  return window.crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

// 7. Message Encryption (Hybrid AES + RSA)
export async function encryptMessage(text, receiverPublicKey, senderPublicKey) {
  // Generate random AES key for this specific message
  const msgAesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // Encrypt the text with the AES key
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    msgAesKey,
    enc.encode(text)
  );

  // Export AES key to raw bytes
  const rawAesKey = await window.crypto.subtle.exportKey('raw', msgAesKey);

  // Encrypt the AES key with Receiver's Public Key
  const receiverEncryptedAesKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    receiverPublicKey,
    rawAesKey
  );

  // Encrypt the AES key with Sender's Public Key (so sender can read history)
  const senderEncryptedAesKey = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    senderPublicKey,
    rawAesKey
  );

  return {
    encryptedContentBase64: arrayBufferToBase64(encryptedContent),
    ivBase64: arrayBufferToBase64(iv),
    receiverEncryptedAesKeyBase64: arrayBufferToBase64(receiverEncryptedAesKey),
    senderEncryptedAesKeyBase64: arrayBufferToBase64(senderEncryptedAesKey)
  };
}

// 8. Message Decryption
export async function decryptMessage(encryptedContentBase64, ivBase64, encryptedAesKeyBase64, myPrivateKey) {
  // Decrypt the AES key using my RSA Private Key
  const encryptedAesKeyBytes = base64ToArrayBuffer(encryptedAesKeyBase64);
  const rawAesKey = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    myPrivateKey,
    encryptedAesKeyBytes
  );

  // Import the decrypted AES key
  const msgAesKey = await window.crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt the message content
  const encryptedContentBytes = base64ToArrayBuffer(encryptedContentBase64);
  const ivBytes = base64ToArrayBuffer(ivBase64);

  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBytes) },
    msgAesKey,
    encryptedContentBytes
  );

  return dec.decode(decryptedContent);
}

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // For development
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Models
const User = require('./models/User');
const Message = require('./models/Message');

// MongoDB Connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    await mongoose.connect(mongoURI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
  }
};

connectDB();

// --- SOCKET.IO REAL-TIME LOGIC ---
const connectedUsers = new Map(); // Maps firebaseUid to socket.id

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // When a user logs in, they register their UID
  socket.on('register', async (uid) => {
    connectedUsers.set(uid, socket.id);
    console.log(`User ${uid} registered to socket ${socket.id}`);
    
    // Update online status in DB
    try {
      await User.findOneAndUpdate(
        { firebaseUid: uid },
        { isOnline: true, lastActive: new Date() }
      );
      // Broadcast status change to all connected clients
      io.emit('user_status_change', { uid, isOnline: true, lastActive: new Date() });
    } catch (err) {
      console.error('Error updating online status:', err);
    }
  });

  // When a user sends a message
  socket.on('send_message', async (messageData) => {
    try {
      // messageData should contain: senderId, receiverId, senderEncryptedAesKey, receiverEncryptedAesKey, encryptedContent, iv
      const newMessage = new Message(messageData);
      await newMessage.save();

      // If receiver is online, forward the message instantly
      const receiverSocketId = connectedUsers.get(messageData.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', newMessage);
      }

      // Also echo back to the sender so they can render it (or they can just render locally)
      socket.emit('message_sent', newMessage);
    } catch (err) {
      console.error('Error handling send_message:', err);
    }
  });

  // Mark messages as read
  socket.on('mark_read', async ({ currentUserId, chatFriendId }) => {
    try {
      // Update all unread messages sent BY the friend TO the current user
      await Message.updateMany(
        { senderId: chatFriendId, receiverId: currentUserId, read: false },
        { $set: { read: true } }
      );
      
      // Notify the friend that their messages were read
      const friendSocketId = connectedUsers.get(chatFriendId);
      if (friendSocketId) {
        io.to(friendSocketId).emit('messages_read', { readerId: currentUserId });
      }
    } catch (err) {
      console.error('Error marking messages as read:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    // Remove from connected users
    let disconnectedUid = null;
    for (const [uid, id] of connectedUsers.entries()) {
      if (id === socket.id) {
        disconnectedUid = uid;
        connectedUsers.delete(uid);
        break;
      }
    }

    if (disconnectedUid) {
      try {
        const lastActiveTime = new Date();
        await User.findOneAndUpdate(
          { firebaseUid: disconnectedUid },
          { isOnline: false, lastActive: lastActiveTime }
        );
        io.emit('user_status_change', { uid: disconnectedUid, isOnline: false, lastActive: lastActiveTime });
      } catch (err) {
        console.error('Error updating offline status:', err);
      }
    }
  });
});

// --- AUTH & USER ROUTES ---
app.post('/api/auth/sync', async (req, res) => {
  try {
    const { email, name, password, authProvider, firebaseUid } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(200).json({ msg: 'User already exists, synced.', user });
    }

    const newUser = new User({ email, name, authProvider, firebaseUid });
    if (password) {
      const salt = await bcrypt.genSalt(10);
      newUser.password = await bcrypt.hash(password, salt);
    }

    await newUser.save();
    res.status(201).json({ msg: 'User synced to MongoDB successfully', user: newUser });
  } catch (error) {
    console.error('Error syncing user:', error);
    res.status(500).json({ error: 'Server error while syncing user' });
  }
});

app.get('/api/users/search', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email query param required' });
    
    const user = await User.findOne({ email }).select('-password -encryptedPrivateKey -keyIv');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error searching user' });
  }
});

app.post('/api/users/add-friend', async (req, res) => {
  try {
    const { currentUserId, targetUserId } = req.body;
    
    const currentUser = await User.findOne({ firebaseUid: currentUserId });
    const targetUser = await User.findById(targetUserId);

    if (!currentUser || !targetUser) return res.status(404).json({ error: 'User not found' });
    if (currentUser.friends.includes(targetUserId)) return res.status(400).json({ error: 'Already friends' });

    currentUser.friends.push(targetUserId);
    targetUser.friends.push(currentUser._id);

    await currentUser.save();
    await targetUser.save();

    res.json({ msg: 'Friend added successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error adding friend' });
  }
});

app.get('/api/users/:uid/friends', async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.params.uid })
      .populate('friends', 'name email firebaseUid publicKey isOnline lastActive');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json(user.friends);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching friends' });
  }
});

// --- ENCRYPTION KEYS ROUTES ---
app.post('/api/keys/save', async (req, res) => {
  try {
    const { uid, publicKey, encryptedPrivateKey, keyIv } = req.body;
    
    const user = await User.findOne({ firebaseUid: uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.publicKey = publicKey;
    user.encryptedPrivateKey = encryptedPrivateKey;
    user.keyIv = keyIv;
    
    await user.save();
    res.json({ msg: 'Keys saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error saving keys' });
  }
});

app.get('/api/keys/:uid', async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.params.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      publicKey: user.publicKey,
      encryptedPrivateKey: user.encryptedPrivateKey,
      keyIv: user.keyIv
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching keys' });
  }
});

// --- MESSAGES ROUTE ---
app.get('/api/messages/:uid/:friendUid', async (req, res) => {
  try {
    const { uid, friendUid } = req.params;
    
    // Find all messages where sender is UID and receiver is friend, OR sender is friend and receiver is UID
    const messages = await Message.find({
      $or: [
        { senderId: uid, receiverId: friendUid },
        { senderId: friendUid, receiverId: uid }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching messages' });
  }
});

app.get('/', (req, res) => {
  res.send('Server is running and ready with Socket.io!');
});

// IMPORTANT: use server.listen, not app.listen to support WebSockets
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import { Search, Send, LogOut, MoreVertical, MessageCircle, UserPlus, Lock, Check, CheckCheck } from 'lucide-react';

const formatLastSeen = (dateString) => {
  if (!dateString) return 'Offline';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffMins < 1440) return `${Math.round(diffMins / 60)} hrs ago`;
  return date.toLocaleDateString();
};
import { onAuthStateChanged, signOut } from 'firebase/auth';
import io from 'socket.io-client';
import { 
  deriveKeyFromPIN, 
  generateRSAKeyPair, 
  encryptPrivateKey, 
  decryptPrivateKey, 
  exportPublicKey, 
  importPublicKey, 
  encryptMessage, 
  decryptMessage 
} from '../utils/encryption';

const ChatDashboard = () => {
  // Auth & UI State
  const [currentUser, setCurrentUser] = useState(null);
  const [friends, setFriends] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [activeFriend, setActiveFriend] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Encryption & Messaging State
  const [messages, setMessages] = useState({});
  const [newMessage, setNewMessage] = useState('');
  const [pin, setPin] = useState('');
  const [isLocked, setIsLocked] = useState(true);
  const [myKeys, setMyKeys] = useState(null); // { privateKey, publicKey }
  const [pinError, setPinError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checkingKeys, setCheckingKeys] = useState(true);
  
  const navigate = useNavigate();
  const socketRef = useRef();
  const messagesEndRef = useRef(null);
  const myKeysRef = useRef(null);
  const currentUserRef = useRef(null);

  useEffect(() => {
    myKeysRef.current = myKeys;
    currentUserRef.current = currentUser;
  }, [myKeys, currentUser]);

  // Initialize Socket and Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        
        // Connect Socket
        socketRef.current = io(import.meta.env.VITE_API_URL || 'http://localhost:5001');
        socketRef.current.emit('register', user.uid);

        // Listen for incoming messages
        socketRef.current.on('receive_message', (msg) => {
          handleIncomingMessage(msg);
        });

        socketRef.current.on('message_sent', (msg) => {
          handleIncomingMessage(msg); // Echo back to sender
        });

        // Listen for user status changes
        socketRef.current.on('user_status_change', ({ uid, isOnline, lastActive }) => {
          setFriends(prev => prev.map(f => f.id === uid ? { ...f, isOnline, lastActive } : f));
          setActiveFriend(prev => prev?.id === uid ? { ...prev, isOnline, lastActive } : prev);
        });

        // Listen for read receipts
        socketRef.current.on('messages_read', ({ readerId }) => {
          setMessages(prev => {
            const chatMessages = prev[readerId] || [];
            return {
              ...prev,
              [readerId]: chatMessages.map(m => (m.senderId === user.uid ? { ...m, read: true } : m))
            };
          });
        });

        await fetchFriends(user.uid);
        await checkKeyStatus(user.uid);
      } else {
        navigate('/login');
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [navigate]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeFriend]);

  // --- ENCRYPTION & PIN SETUP ---
  const checkKeyStatus = async (uid) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/keys/${uid}`);
      if (res.ok) {
        const data = await res.json();
        if (!data.publicKey) {
          setNeedsSetup(true);
        }
      } else {
        setNeedsSetup(true);
      }
    } catch (err) {
      console.error("Failed to check keys");
      setNeedsSetup(true);
    } finally {
      setCheckingKeys(false);
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    setPinError('');
    if (pin.length < 4) {
      setPinError('PIN must be at least 4 characters');
      return;
    }

    try {
      const aesPinKey = await deriveKeyFromPIN(pin);

      if (needsSetup) {
        // First time setup: Generate keys, encrypt, and save to DB
        const keyPair = await generateRSAKeyPair();
        const { encryptedPrivateKeyBase64, ivBase64 } = await encryptPrivateKey(keyPair.privateKey, aesPinKey);
        const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);

        await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/keys/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: currentUser.uid,
            publicKey: publicKeyBase64,
            encryptedPrivateKey: encryptedPrivateKeyBase64,
            keyIv: ivBase64
          })
        });

        setMyKeys(keyPair);
        setIsLocked(false);
        setNeedsSetup(false);
      } else {
        // Returning user: Fetch encrypted key, decrypt it
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/keys/${currentUser.uid}`);
        const data = await res.json();

        try {
          const privateKey = await decryptPrivateKey(data.encryptedPrivateKey, data.keyIv, aesPinKey);
          const publicKey = await importPublicKey(data.publicKey);
          setMyKeys({ privateKey, publicKey });
          setIsLocked(false);
        } catch (decryptErr) {
          console.error("Decryption Error:", decryptErr);
          setPinError(`Incorrect PIN. Error: ${decryptErr.message || decryptErr.name || 'Unknown'}`);
        }
      }
    } catch (err) {
      setPinError('Error processing PIN');
      console.error(err);
    }
  };

  // --- FRIENDS & MESSAGES LOGIC ---
  const fetchFriends = async (uid) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/users/${uid}/friends`);
      if (res.ok) {
        const data = await res.json();
        const friendsWithAvatars = data.map(f => ({
          ...f,
          id: f.firebaseUid, // Map _id/firebaseUid
          avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${f.name}`
        }));
        setFriends(friendsWithAvatars);
      }
    } catch (err) {
      console.error('Failed to fetch friends', err);
    }
  };

  const loadChatHistory = async (friend) => {
    if (isLocked || !myKeys) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/messages/${currentUser.uid}/${friend.id}`);
      if (res.ok) {
        const encryptedHistory = await res.json();
        const decryptedHistory = [];

        for (const msg of encryptedHistory) {
          try {
            const isMe = msg.senderId === currentUser.uid;
            // Determine which encrypted AES key to use
            const aesKeyToDecrypt = isMe ? msg.senderEncryptedAesKey : msg.receiverEncryptedAesKey;
            
            const decryptedText = await decryptMessage(
              msg.encryptedContent,
              msg.iv,
              aesKeyToDecrypt,
              myKeys.privateKey
            );

            decryptedHistory.push({
              _id: msg._id,
              text: decryptedText,
              senderId: msg.senderId,
              read: msg.read || false,
              timestamp: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          } catch (decErr) {
            console.error("Failed to decrypt a message in history", decErr);
            decryptedHistory.push({
              _id: msg._id,
              text: "🔒 [Message could not be decrypted]",
              senderId: msg.senderId,
              read: msg.read || false,
              timestamp: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
          }
        }
        
        setMessages(prev => ({
          ...prev,
          [friend.id]: decryptedHistory
        }));

        // Mark messages as read if there are unread messages from them
        const hasUnread = encryptedHistory.some(m => m.senderId === friend.id && !m.read);
        if (hasUnread && socketRef.current) {
          socketRef.current.emit('mark_read', { currentUserId: currentUser.uid, chatFriendId: friend.id });
          // Optimistically update local state for messages sent by them
          setMessages(prev => ({
            ...prev,
            [friend.id]: prev[friend.id].map(m => m.senderId === friend.id ? { ...m, read: true } : m)
          }));
        }
      }
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  // When active friend changes, load history
  useEffect(() => {
    if (activeFriend && !isLocked) {
      loadChatHistory(activeFriend);
    }
  }, [activeFriend, isLocked]);

  const handleIncomingMessage = async (msg) => {
    const currentKeys = myKeysRef.current;
    const user = currentUserRef.current;
    
    if (!currentKeys || !user) return;

    // Determine which chat this belongs to
    const isMe = msg.senderId === user.uid;
    const chatFriendId = isMe ? msg.receiverId : msg.senderId;

    try {
      const aesKeyToDecrypt = isMe ? msg.senderEncryptedAesKey : msg.receiverEncryptedAesKey;
      const decryptedText = await decryptMessage(
        msg.encryptedContent,
        msg.iv,
        aesKeyToDecrypt,
        currentKeys.privateKey
      );

      const displayMsg = {
        _id: msg._id,
        text: decryptedText,
        senderId: msg.senderId,
        read: msg.read || false,
        timestamp: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => ({
        ...prev,
        [chatFriendId]: [...(prev[chatFriendId] || []), displayMsg]
      }));

      // If we received a message from the active friend, mark it as read immediately
      if (!isMe && activeFriend?.id === msg.senderId && socketRef.current) {
        socketRef.current.emit('mark_read', { currentUserId: user.uid, chatFriendId: msg.senderId });
        setMessages(prev => ({
          ...prev,
          [chatFriendId]: prev[chatFriendId].map(m => m.senderId === msg.senderId ? { ...m, read: true } : m)
        }));
      }
    } catch (err) {
      console.error("Failed to decrypt incoming live message", err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeFriend || !myKeys) return;

    const textToSend = newMessage;
    setNewMessage(''); // Clear input instantly for UX

    try {
      // Import friend's public key
      const friendPubKey = await importPublicKey(activeFriend.publicKey);

      // Encrypt the message
      const encryptedPayload = await encryptMessage(textToSend, friendPubKey, myKeys.publicKey);

      const messageData = {
        senderId: currentUser.uid,
        receiverId: activeFriend.id,
        senderEncryptedAesKey: encryptedPayload.senderEncryptedAesKeyBase64,
        receiverEncryptedAesKey: encryptedPayload.receiverEncryptedAesKeyBase64,
        encryptedContent: encryptedPayload.encryptedContentBase64,
        iv: encryptedPayload.ivBase64
      };

      socketRef.current.emit('send_message', messageData);
    } catch (err) {
      console.error("Error encrypting/sending message", err);
      alert("Failed to securely encrypt message. Check console.");
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setSearchError('');
    setSearchResult(null);
    if (!searchQuery.trim()) return;
    if (searchQuery.toLowerCase() === currentUser.email.toLowerCase()) {
      setSearchError("You cannot add yourself."); return;
    }
    if (friends.some(f => f.email.toLowerCase() === searchQuery.toLowerCase())) {
      setSearchError("Already in friends list."); return;
    }
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/users/search?email=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (res.ok) {
        setSearchResult({ ...data, id: data.firebaseUid, avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${data.name}` });
      } else {
        setSearchError(data.error || 'User not found');
      }
    } catch (err) {
      setSearchError('Error searching');
    }
  };

  const handleAddFriend = async () => {
    if (!searchResult) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/users/add-friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUserId: currentUser.uid, targetUserId: searchResult._id })
      });
      if (res.ok) {
        setSearchQuery('');
        setSearchResult(null);
        fetchFriends(currentUser.uid);
      }
    } catch (err) {}
  };

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  if (loading || checkingKeys || !currentUser) {
    return <div className="min-h-screen bg-base-200 flex items-center justify-center"><span className="loading loading-spinner"></span></div>;
  }

  // --- RENDER PIN LOCK SCREEN ---
  if (isLocked) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex flex-col items-center mb-6">
              <div className="bg-primary/20 text-primary p-4 rounded-full mb-4">
                <Lock size={32} />
              </div>
              <h2 className="card-title text-2xl font-bold">{needsSetup ? 'Set Recovery PIN' : 'Enter Recovery PIN'}</h2>
              <p className="text-base-content/70 text-center mt-2">
                {needsSetup 
                  ? 'Your chats are End-to-End Encrypted. Set a PIN to secure your encryption keys. You will need this to read chats on other devices.'
                  : 'Enter your Recovery PIN to unlock your encrypted chats.'}
              </p>
            </div>
            {pinError && <div className="alert alert-error text-sm mb-4">{pinError}</div>}
            <form onSubmit={handlePinSubmit}>
              <div className="form-control w-full mb-6">
                <input 
                  type="password" 
                  placeholder="Enter PIN (min 4 chars)" 
                  className="input input-bordered w-full text-center tracking-[0.5em] font-bold text-lg" 
                  value={pin}
                  onChange={(e) => setPin(e.target.value.trim())}
                  maxLength={12}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                {needsSetup ? 'Secure My Chats' : 'Unlock Chats'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN CHAT UI ---
  return (
    <div className="flex h-screen bg-base-200 overflow-hidden">
      {/* Sidebar */}
      <div className={`w-full md:w-80 lg:w-96 bg-base-100 flex flex-col border-r border-base-300 ${activeFriend ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 border-b border-base-300 flex justify-between items-center bg-base-100">
          <div className="flex items-center gap-3">
            <div className="avatar placeholder">
              <div className="bg-neutral text-neutral-content rounded-full w-10">
                <span className="text-xl">{(currentUser.displayName || currentUser.email).charAt(0).toUpperCase()}</span>
              </div>
            </div>
            <div className="flex flex-col">
              <div className="font-semibold truncate max-w-[150px]">{currentUser.displayName || currentUser.email}</div>
              <div className="text-xs text-base-content/60">{friends.length} Friend{friends.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div className="dropdown dropdown-end">
            <div tabIndex={0} role="button" className="btn btn-ghost btn-circle">
              <MoreVertical size={20} />
            </div>
            <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
              <li><a onClick={handleLogout} className="text-error"><LogOut size={16} /> Logout</a></li>
            </ul>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-base-300">
          <form onSubmit={handleSearch} className="join w-full flex">
            <input 
              type="email" 
              placeholder="Find friends by email..." 
              className="input input-bordered w-full join-item" 
              value={searchQuery}
              onChange={(e) => {setSearchQuery(e.target.value); setSearchError(''); setSearchResult(null);}}
            />
            <button type="submit" className="btn btn-primary join-item"><Search size={18} /></button>
          </form>
          {searchError && <p className="text-error text-xs mt-2">{searchError}</p>}
        </div>

        {searchResult && (
          <div className="p-4 border-b border-base-300 bg-base-200">
            <h4 className="text-xs font-bold text-base-content/70 uppercase mb-3">Search Result</h4>
            <div className="flex items-center justify-between bg-base-100 p-3 rounded-xl shadow-sm">
              <div className="flex items-center gap-3">
                <div className="avatar"><div className="w-10 rounded-full"><img src={searchResult.avatar} alt="avatar" /></div></div>
                <div className="flex flex-col overflow-hidden">
                  <div className="font-semibold truncate">{searchResult.name}</div>
                  <div className="text-xs opacity-70 truncate">{searchResult.email}</div>
                </div>
              </div>
              <button onClick={handleAddFriend} className="btn btn-sm btn-primary btn-circle"><UserPlus size={16} /></button>
            </div>
          </div>
        )}

        {/* Friends */}
        <div className="flex-1 overflow-y-auto">
          {friends.length === 0 ? (
            <div className="p-8 text-center text-base-content/50">
              <UserPlus size={48} className="mx-auto mb-4 opacity-20" />
              <p>No friends yet. Search above!</p>
            </div>
          ) : (
            <ul className="menu w-full p-2">
              <li className="menu-title px-4 py-2 text-xs font-bold uppercase opacity-50">Contacts</li>
              {friends.map(friend => (
                <li key={friend.id}>
                  <a className={`flex items-center gap-4 py-3 rounded-xl ${activeFriend?.id === friend.id ? 'active' : ''}`}
                     onClick={() => setActiveFriend(friend)}>
                    <div className={`avatar ${friend.isOnline ? 'online' : ''}`}>
                      <div className="w-12 rounded-full"><img src={friend.avatar} alt="avatar" /></div>
                    </div>
                    <div className="flex flex-col flex-1">
                      <div className="font-semibold truncate">{friend.name}</div>
                      <div className="text-xs opacity-70 truncate">{friend.email}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Main Chat */}
      <div className={`flex-1 flex flex-col bg-base-200 relative ${!activeFriend ? 'hidden md:flex' : 'flex'}`}>
        {!activeFriend ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-base-content/50 bg-base-100 p-8 rounded-3xl shadow-sm border border-base-300 max-w-sm">
              <Lock size={40} className="text-primary mx-auto mb-6" />
              <h3 className="text-2xl font-bold text-base-content mb-2">End-to-End Encrypted</h3>
              <p>Select a friend to start chatting securely.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-base-300 bg-base-100 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center gap-4">
                <button className="btn btn-ghost btn-circle md:hidden" onClick={() => setActiveFriend(null)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className={`avatar ${activeFriend.isOnline ? 'online' : ''}`}>
                  <div className="w-10 rounded-full border border-base-300"><img src={activeFriend.avatar} alt="avatar" /></div>
                </div>
                <div>
                  <h3 className="font-bold">{activeFriend.name}</h3>
                  <div className="text-xs opacity-70 flex items-center gap-1">
                    {activeFriend.isOnline ? <span className="text-success font-semibold">Online</span> : <span>Last seen {formatLastSeen(activeFriend.lastActive)}</span>}
                    <span className="mx-1">•</span>
                    <Lock size={10}/> E2E Encrypted
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(messages[activeFriend.id] || []).length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-base-content/50">
                  <p>Send a secure message to start the conversation.</p>
                </div>
              ) : (
                (messages[activeFriend.id] || []).map((msg, i) => {
                  const isMe = msg.senderId === currentUser.uid;
                  return (
                    <div key={msg._id || i} className={`chat ${isMe ? 'chat-end' : 'chat-start'}`}>
                      <div className="chat-header mb-1">
                        {isMe ? 'Me' : activeFriend.name}
                        <time className="text-xs opacity-50 ml-2">{msg.timestamp}</time>
                      </div>
                      <div className={`chat-bubble ${isMe ? 'chat-bubble-primary' : ''}`}>
                        {msg.text}
                      </div>
                      {isMe && (
                        <div className="chat-footer opacity-50 mt-1 flex items-center gap-1">
                          {msg.read ? <CheckCheck size={14} className="text-info" /> : <Check size={14} />}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-base-100 border-t border-base-300">
              <form onSubmit={handleSendMessage} className="flex gap-2 max-w-4xl mx-auto">
                <input 
                  type="text" 
                  placeholder="Message..." 
                  className="input input-bordered flex-1 rounded-full bg-base-200" 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-circle shadow-sm" disabled={!newMessage.trim() || !activeFriend.publicKey}>
                  <Send size={18} className="ml-1" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatDashboard;

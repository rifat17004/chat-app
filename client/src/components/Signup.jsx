import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

const Signup = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Create user in Firebase
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Update Firebase profile with name
      await updateProfile(user, { displayName: name });

      // 2. Sync user to MongoDB backend
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/api/auth/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          name: name,
          password: password, // Sending raw password to be hashed by backend per request
          authProvider: 'firebase-email',
          firebaseUid: user.uid
        })
      });

      if (!response.ok) {
        throw new Error('Failed to sync user to database');
      }

      localStorage.setItem('currentUser', name);
      navigate('/chat');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create an account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="flex flex-col items-center mb-6">
            <div className="bg-primary text-primary-content p-3 rounded-full mb-4">
              <UserPlus size={32} />
            </div>
            <h2 className="card-title text-2xl font-bold">Create an Account</h2>
            <p className="text-base-content/70">Sign up to get started</p>
          </div>
          
          {error && <div className="alert alert-error text-sm mb-4">{error}</div>}

          <form onSubmit={handleSignup}>
            <div className="form-control w-full mb-4">
              <label className="label">
                <span className="label-text font-medium">Full Name</span>
              </label>
              <input 
                type="text" 
                placeholder="John Doe" 
                className="input input-bordered w-full" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-control w-full mb-4">
              <label className="label">
                <span className="label-text font-medium">Email</span>
              </label>
              <input 
                type="email" 
                placeholder="you@example.com" 
                className="input input-bordered w-full" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="form-control w-full mb-6">
              <label className="label">
                <span className="label-text font-medium">Password</span>
              </label>
              <input 
                type="password" 
                placeholder="••••••••" 
                className="input input-bordered w-full" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            
            <div className="form-control mt-2">
              <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                {loading ? <span className="loading loading-spinner"></span> : 'Sign Up'}
              </button>
            </div>
          </form>
          
          <div className="divider">OR</div>
          
          <div className="text-center text-sm">
            Already have an account? <Link to="/login" className="link link-primary">Login</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;

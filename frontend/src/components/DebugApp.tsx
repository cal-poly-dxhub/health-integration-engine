import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Simple debug component to test if the app loads without AWS Amplify
function DebugApp() {
  return (
    <Router>
      <div className="App" style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Debug App - Testing Basic Functionality</h1>
        <p>If you can see this, the React app is loading correctly!</p>
        
        <Routes>
          <Route 
            path="/" 
            element={
              <div>
                <h2>Home Page</h2>
                <p>Basic routing is working.</p>
                <p>Environment variables:</p>
                <ul>
                  <li>VITE_AWS_REGION: {import.meta.env.VITE_AWS_REGION}</li>
                  <li>VITE_API_BASE_URL: {import.meta.env.VITE_API_BASE_URL}</li>
                  <li>VITE_COGNITO_USER_POOL_ID: {import.meta.env.VITE_COGNITO_USER_POOL_ID}</li>
                </ul>
              </div>
            } 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default DebugApp;
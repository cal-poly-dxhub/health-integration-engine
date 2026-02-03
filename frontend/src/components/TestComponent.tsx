import React from 'react';

const TestComponent: React.FC = () => {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Test Component</h1>
      <p>If you can see this, React is working!</p>
      <p>Current URL: {window.location.href}</p>
    </div>
  );
};

export default TestComponent;
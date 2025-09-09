import React from 'react';
import ReactDOM from 'react-dom/client';
import TaskSphereApp from './TaskSphereApp.jsx';

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <TaskSphereApp />
  </React.StrictMode>
);

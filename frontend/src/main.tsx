import React from 'react';
import ReactDOM from 'react-dom/client';
import IndustrialDoctorApp from '../IndustrialDoctor';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <IndustrialDoctorApp />
    </React.StrictMode>
  );
}

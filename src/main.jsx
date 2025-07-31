import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // Optional: Create a CSS file for styling

const location = {
  latitude: 37.7749,
  longitude: -122.4194,
};

const sensorData = {
  particulateMatter: "25 μg/m³",
  gasSensor: "0.1 ppm",
  vocSensor: "0.02 ppm",
  humidity: "45%",
  temperature: "22°C",
  rainSensor: "Dry",
  windSpeed: "10 km/h",
  windDirection: "North",
  time: "12:00 PM",
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App location={location} sensorData={sensorData} />
  </React.StrictMode>
);
